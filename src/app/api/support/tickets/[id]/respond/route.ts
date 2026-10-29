// POST /api/support/tickets/[id]/respond — add a reply + regenerate AI response.
// ------------------------------------------------------------------
// Body: { message?: string, role?: 'human' | 'customer', regenerate?: boolean }
//
// Two modes:
//   1. Send a human reply: body.message is provided. The message is appended
//      to the conversation and a fresh AI response is generated in reply.
//   2. Regenerate AI response: body.regenerate === true (no message). The
//      existing conversation is sent back to the LLM and a new response is
//      produced and appended.
//
// Either mode results in: a new 'ai' SupportMessage + aiResponse/aiConfidence
// updated on the ticket. Status moves to 'answering' if it was 'new'.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

interface RespondBody {
  message?: string
  role?: 'human' | 'customer'
  regenerate?: boolean
}

interface TicketRow {
  id: string
  subject: string
  category: string
  priority: string
  status: string
}

interface MessageRow {
  id: string
  role: string
  content: string
  metadata: string
  created_at: string
}

function clampConfidence(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(Math.max(n, 0), 1)
}

interface AiDraft {
  aiResponse?: string
  confidence?: number
  summary?: string
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  // Ownership check.
  const { data: ticket, error: ticketError } = await db
    .from('support_tickets')
    .select('id, subject, category, priority, status')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const ticketRow = ticket as TicketRow

  const body = (await req.json().catch(() => ({}))) as RespondBody
  const role = body.role === 'customer' ? 'customer' : 'human'
  const message = body.message?.trim() || ''
  const regenerateOnly = body.regenerate === true && !message

  if (!message && !regenerateOnly) {
    return NextResponse.json(
      { error: 'Please provide a message or set regenerate=true.' },
      { status: 400 },
    )
  }

  // Optionally append the inbound human/customer message before regenerating.
  if (message) {
    await db.from('support_messages').insert({
      ticket_id: ticketRow.id,
      role,
      content: message,
      metadata: JSON.stringify({ via: 'respond' }),
    })
  }

  // Re-fetch the latest conversation (including any newly appended message).
  const { data: conversationRows, error: msgError } = await db
    .from('support_messages')
    .select('*')
    .eq('ticket_id', ticketRow.id)
    .order('created_at', { ascending: true })

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 })
  }
  const conversation = (conversationRows as MessageRow[] | null) ?? []

  const zai = await ZAI.create()

  // Build a transcript string for the LLM. We collapse the system prompt +
  // history into a single user turn since the ZAI SDK expects system prompts
  // delivered as 'assistant' role messages per project convention.
  const transcript = conversation
    .map((m) => {
      const label =
        m.role === 'customer'
          ? 'Customer'
          : m.role === 'human'
            ? 'Support Agent'
            : m.role === 'ai'
              ? 'AI Assistant'
              : 'System'
      return `${label}: ${m.content}`
    })
    .join('\n\n')

  const triageMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an AI support assistant embedded in a SaaS help desk.',
        'A conversation transcript follows. Draft the next assistant reply.',
        '',
        'Return ONLY this JSON shape:',
        '{',
        '  "aiResponse": string — the next reply to send to the customer',
        '  "confidence": number — 0.0 to 1.0',
        '  "summary": string — one-line summary of the ticket state after this reply',
        '}',
        '',
        'Rules:',
        '- Be specific to what the customer asked — reference the prior messages.',
        '- If the agent has already replied, your draft should complement, not contradict.',
        '- If the issue is resolved, mention CSAT in the reply.',
        '- If you cannot confidently resolve, set confidence < 0.6 and suggest escalation.',
        '- Return ONLY JSON. No markdown fences.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Ticket subject: ${ticketRow.subject}`,
        `Category: ${ticketRow.category} · Priority: ${ticketRow.priority}`,
        '',
        'Conversation so far:',
        transcript || '(no prior messages)',
        '',
        regenerateOnly
          ? 'Regenerate the AI assistant\'s next reply as JSON.'
          : `A new ${role} message was just added. Draft the AI assistant's next reply as JSON.`,
      ].join('\n'),
    },
  ]

  let draft: AiDraft = {}
  let parseError: string | null = null
  try {
    const completion = await zai.chat.completions.create({
      messages: triageMessages.map((m) =>
        m.role === 'system'
          ? { role: 'assistant' as const, content: m.content }
          : { role: 'user' as const, content: m.content },
      ),
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) {
      draft = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as AiDraft
    } else {
      parseError = 'no_json_in_response'
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'regenerate_failed'
  }

  const aiText =
    typeof draft.aiResponse === 'string' && draft.aiResponse.trim().length > 0
      ? draft.aiResponse.trim()
      : regenerateOnly
        ? "Thanks for your patience — could you share a bit more detail so I can help?"
        : "Thanks for the update. I've noted this and will follow up with concrete next steps."

  const confidence = clampConfidence(draft.confidence)

  // Persist the new AI message and update the ticket.
  const { data: aiMessage, error: aiMsgError } = await db
    .from('support_messages')
    .insert({
      ticket_id: ticketRow.id,
      role: 'ai',
      content: aiText,
      metadata: JSON.stringify({
        confidence,
        regenerated: regenerateOnly,
        summary: draft.summary,
        parseError,
      }),
    })
    .select('*')
    .single()

  if (aiMsgError || !aiMessage) {
    return NextResponse.json({ error: aiMsgError?.message || 'message_create_failed' }, { status: 500 })
  }

  const newStatus = ticketRow.status === 'new' ? 'answering' : ticketRow.status
  const { data: updatedTicket, error: ticketUpdateError } = await db
    .from('support_tickets')
    .update({
      ai_response: aiText,
      ai_confidence: confidence,
      status: newStatus,
    })
    .eq('id', ticketRow.id)
    .select('id, status, ai_response, ai_confidence, updated_at')
    .single()

  if (ticketUpdateError || !updatedTicket) {
    return NextResponse.json({ error: ticketUpdateError?.message || 'ticket_update_failed' }, { status: 500 })
  }

  await trackUsage(user.id, 'llm_tokens', 1, { via: 'support-respond', ticketId: ticketRow.id })

  return NextResponse.json({
    ok: true,
    message: {
      id: aiMessage.id,
      role: aiMessage.role,
      content: aiMessage.content,
      metadata: JSON.parse(aiMessage.metadata || '{}') as Record<string, unknown>,
      createdAt: aiMessage.created_at,
    },
    ticket: {
      id: updatedTicket.id,
      status: updatedTicket.status,
      aiResponse: updatedTicket.ai_response,
      aiConfidence: updatedTicket.ai_confidence,
      updatedAt: updatedTicket.updated_at,
    },
    parseError,
  })
}
