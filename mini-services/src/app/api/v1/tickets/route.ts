// POST /api/v1/tickets — create a support ticket programmatically (public API)
//
// Layer 9 — Public API. Requires scope: tickets:write.
// Useful for: automated monitoring that opens tickets, CI/CD failure alerts,
// external forms that feed into the support system.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { authenticateApiKey } from '@/lib/api-key'
import { audit } from '@/lib/snapshot'
import { notify } from '@/lib/notify'
import { checkLimit, trackUsage } from '@/lib/billing'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import type { ChatMessage } from '@/lib/llm/router'

interface TicketBody {
  subject: string
  message: string
  customerEmail: string
  customerName?: string
  projectId?: string
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req, 'tickets:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rl = rateLimit(`api-ticket:${auth.userId}`, { limit: 20, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as TicketBody
  const subject = body.subject?.trim()
  const message = body.message?.trim()
  const customerEmail = body.customerEmail?.trim()

  if (!subject || !message || !customerEmail) {
    return NextResponse.json(
      { error: 'subject, message, and customerEmail are required.' },
      { status: 400 },
    )
  }

  // Plan limit check.
  const limit = await checkLimit(auth.userId!, 'projects')
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: `Ticket limit reached (${limit.limit}).` },
      { status: 402 },
    )
  }

  // ── AI auto-triage (same logic as the web UI endpoint) ────────────
  const triageMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are Buildr Support, an autonomous customer-support agent.',
        'A new support ticket has arrived via the public API. Triage it and draft a response.',
        'Return ONLY a JSON object:',
        '{',
        '  "category": "general" | "billing" | "bug" | "feature" | "how-to" | "account" | "other",',
        '  "priority": "low" | "normal" | "high" | "urgent",',
        '  "tags": [string] — 1-5 short tags',
        '  "suggestedStatus": "resolved" | "answering" | "escalated",',
        '  "response": string — the full reply to the customer',
        '  "confidence": number — 0.0 to 1.0',
        '  "reasoning": string — one sentence',
        '}',
        'Rules: Be concise but warm. Sign off as "The Support Team". Return ONLY JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Subject: ${subject}\nFrom: ${customerEmail}\n\nCustomer message:\n${message}\n\nTriage this ticket and draft a response as JSON.`,
    },
  ]

  const zai = await ZAI.create()
  let category = 'general'
  let priority = 'normal'
  let aiResponse = ''
  let aiConfidence: number | null = null
  let suggestedStatus = 'answering'
  let tags: string[] = []

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
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      category = String(parsed.category || 'general')
      priority = String(parsed.priority || 'normal')
      aiResponse = String(parsed.response || '')
      aiConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : null
      suggestedStatus = String(parsed.suggestedStatus || 'answering')
      tags = Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 5) : []
    }
  } catch {
    aiResponse = `Hi ${body.customerName || 'there'},\n\nThank you for reaching out. Our team will follow up within 24 hours.\n\nThe Support Team`
  }

  const { data: ticket, error } = await db
    .from('support_tickets')
    .insert({
      owner_id: auth.userId,
      project_id: body.projectId || null,
      subject,
      message,
      customer_email: customerEmail,
      customer_name: body.customerName || null,
      status: 'triaged',
      priority,
      category,
      ai_response: aiResponse,
      ai_confidence: aiConfidence,
      tags,
    })
    .select('*')
    .single()

  if (error || !ticket) {
    return NextResponse.json({ error: error?.message || 'create_failed' }, { status: 500 })
  }

  await db.from('support_messages').insert([
    { ticket_id: ticket.id, role: 'customer', content: message, metadata: JSON.stringify({ from: customerEmail, via: 'api' }) },
    { ticket_id: ticket.id, role: 'ai', content: aiResponse, metadata: JSON.stringify({ confidence: aiConfidence, via: 'api' }) },
  ])

  await trackUsage(auth.userId!, 'projects', 1, { ticketId: ticket.id, via: 'api' })
  await audit('api.ticket.create', { ticketId: ticket.id, subject }, auth.userId)

  return NextResponse.json({
    ok: true,
    ticket: {
      id: ticket.id,
      subject,
      status: 'triaged',
      priority,
      category,
      aiResponse,
      aiConfidence: aiConfidence,
      tags,
      createdAt: new Date(ticket.created_at as string).toISOString(),
    },
  }, { status: 201 })
}
