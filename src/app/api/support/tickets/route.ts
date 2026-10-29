// GET  /api/support/tickets — list the signed-in user's support tickets.
// POST /api/support/tickets — create a ticket with AI auto-triage.
// ------------------------------------------------------------------
// The POST flow:
//   1. Validate the inbound customer message.
//   2. ZAI triages it: classifies category, priority, confidence, tags.
//   3. ZAI drafts an initial AI response.
//   4. Persist SupportTicket + 2 SupportMessages (customer + ai).
//   5. Emit a 'support' notification.
//
// The model status flow is: new → triaged → answering → resolved/escalated.
// We set status='answering' after triage so the inbox shows the AI reply.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

const VALID_CATEGORIES = ['general', 'billing', 'bug', 'feature', 'how-to', 'account', 'other']
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent']

interface TriageResponse {
  category?: string
  priority?: string
  confidence?: number
  tags?: string[]
  aiResponse?: string
}

interface CreateTicketBody {
  subject?: string
  message?: string
  customerEmail?: string
  customerName?: string
  projectId?: string
  businessId?: string
}

interface TicketRow {
  id: string
  subject: string
  message: string
  customer_email: string
  customer_name: string | null
  status: string
  priority: string
  category: string
  ai_response: string
  ai_confidence: number | null
  csat_rating: number | null
  csat_comment: string | null
  tags: string
  project_id: string | null
  business_id: string | null
  resolved_at: string | null
  escalated_at: string | null
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  ticket_id: string
  role: string
  content: string
  metadata: string
  created_at: string
}

function normalizeCategory(s: string): string {
  const c = s.toLowerCase().trim()
  return VALID_CATEGORIES.includes(c) ? c : 'general'
}

function normalizePriority(s: string): string {
  const p = s.toLowerCase().trim()
  return VALID_PRIORITIES.includes(p) ? p : 'normal'
}

function clampConfidence(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(Math.max(n, 0), 1)
}

// ---------------------------------------------------------------------------
// GET — list tickets (newest first, paginated).
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || undefined
  const priority = searchParams.get('priority') || undefined
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  let query: any = db.from('support_tickets').select('*').eq('owner_id', user.id)
  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)

  const { data: rows, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const ticketRows = (rows as TicketRow[] | null) ?? []
  if (ticketRows.length === 0) {
    return NextResponse.json({ tickets: [] })
  }

  // Fetch messages for all tickets in a single query.
  const ticketIds = ticketRows.map((t) => t.id)
  const { data: messages, error: msgError } = await db
    .from('support_messages')
    .select('*')
    .in('ticket_id', ticketIds)
    .order('created_at', { ascending: true })

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 })
  }

  const messagesByTicket = new Map<string, MessageRow[]>()
  for (const m of (messages as MessageRow[] | null) ?? []) {
    const list = messagesByTicket.get(m.ticket_id ?? '') ?? []
    list.push(m)
    messagesByTicket.set(m.ticket_id ?? '', list)
  }

  const tickets = ticketRows.map((t) => ({
    id: t.id,
    subject: t.subject,
    message: t.message,
    customerEmail: t.customer_email,
    customerName: t.customer_name,
    status: t.status,
    priority: t.priority,
    category: t.category,
    aiResponse: t.ai_response,
    aiConfidence: t.ai_confidence,
    csatRating: t.csat_rating,
    csatComment: t.csat_comment,
    tags: JSON.parse(t.tags || '[]') as string[],
    projectId: t.project_id,
    businessId: t.business_id,
    resolvedAt: t.resolved_at,
    escalatedAt: t.escalated_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages: (messagesByTicket.get(t.id) ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: JSON.parse(m.metadata || '{}') as Record<string, unknown>,
      createdAt: m.created_at,
    })),
  }))

  return NextResponse.json({ tickets })
}

// ---------------------------------------------------------------------------
// POST — create a ticket with AI auto-triage.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json()) as CreateTicketBody

  const subject = body.subject?.trim() || ''
  const message = body.message?.trim() || ''
  const customerEmail = body.customerEmail?.trim() || ''
  const customerName = body.customerName?.trim() || null

  if (subject.length < 3) {
    return NextResponse.json(
      { error: 'Please provide a subject (at least 3 characters).' },
      { status: 400 },
    )
  }
  if (message.length < 10) {
    return NextResponse.json(
      { error: 'Please describe the issue in at least a sentence.' },
      { status: 400 },
    )
  }
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return NextResponse.json(
      { error: 'A valid customer email is required.' },
      { status: 400 },
    )
  }

  const zai = await ZAI.create()

  // ── Step 1: AI triage — classify category, priority, tags + draft response ──
  const triageMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an AI support triage agent for a SaaS product.',
        'Classify the incoming customer ticket and draft a helpful response.',
        '',
        'Return ONLY this JSON shape:',
        '{',
        '  "category": "general" | "billing" | "bug" | "feature" | "how-to" | "account" | "other",',
        '  "priority": "low" | "normal" | "high" | "urgent",',
        '  "confidence": number — 0.0 to 1.0 — how confident you are in the classification',
        '  "tags": [string] — 1-5 short descriptive tags',
        '  "aiResponse": string — a polite, helpful, specific reply to the customer',
        '}',
        '',
        'Rules:',
        '- Priority "urgent" is reserved for outages, data loss, or security issues.',
        '- Priority "high" for blocking bugs affecting paid customers.',
        '- The aiResponse should acknowledge the issue, give a concrete next step, and be 2-4 short paragraphs.',
        '- If the ticket is clearly outside what AI can resolve (refund requests, account deletion), set priority="high" and suggest escalation in the response.',
        '- Return ONLY the JSON object. No markdown fences.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Subject: ${subject}`,
        `Customer email: ${customerEmail}`,
        customerName ? `Customer name: ${customerName}` : '',
        body.projectId ? `Project ID: ${body.projectId}` : '',
        body.businessId ? `Business ID: ${body.businessId}` : '',
        '',
        'Ticket message:',
        message,
        '',
        'Triage this ticket and draft a response as JSON.',
      ].filter(Boolean).join('\n'),
    },
  ]

  let triage: TriageResponse = {}
  let triageRaw = ''
  let triageParseError: string | null = null

  try {
    const completion = await zai.chat.completions.create({
      messages: triageMessages.map((m) =>
        m.role === 'system'
          ? { role: 'assistant' as const, content: m.content }
          : { role: 'user' as const, content: m.content },
      ),
      thinking: { type: 'disabled' },
    })
    triageRaw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = triageRaw.indexOf('{')
    const jsonEnd = triageRaw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) {
      triage = JSON.parse(triageRaw.slice(jsonStart, jsonEnd + 1)) as TriageResponse
    } else {
      triageParseError = 'no_json_in_response'
    }
  } catch (err) {
    triageParseError = err instanceof Error ? err.message : 'triage_failed'
  }

  // Fall back to safe defaults if triage failed.
  const category = normalizeCategory(triage.category || 'general')
  const priority = normalizePriority(triage.priority || 'normal')
  const confidence = clampConfidence(triage.confidence)
  const tags = Array.isArray(triage.tags)
    ? triage.tags.map((t) => String(t)).filter(Boolean).slice(0, 5)
    : []
  const aiResponse =
    typeof triage.aiResponse === 'string' && triage.aiResponse.trim().length > 0
      ? triage.aiResponse.trim()
      : [
          `Hi${customerName ? ` ${customerName}` : ''},`,
          '',
          `Thanks for reaching out about "${subject}".`,
          'I\'ve logged your ticket and our team will review it shortly.',
          'If this is urgent, please reply with "escalate" and we\'ll prioritize it.',
          '',
          '— Buildr Support',
        ].join('\n')

  // ── Step 2: Persist the ticket + initial messages ──────────────────────────
  // Sequential inserts (replaces Prisma $transaction; non-atomic but
  // preserves the same observable behavior on the happy path).
  const { data: ticket, error: ticketError } = await db
    .from('support_tickets')
    .insert({
      owner_id: user.id,
      subject,
      message,
      customer_email: customerEmail,
      customer_name: customerName,
      project_id: body.projectId || null,
      business_id: body.businessId || null,
      status: 'answering',
      priority,
      category,
      ai_response: aiResponse,
      ai_confidence: confidence,
      tags: JSON.stringify(tags),
    })
    .select('*')
    .single()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: ticketError?.message || 'ticket_create_failed' }, { status: 500 })
  }

  // Insert the customer message + ai reply.
  await db.from('support_messages').insert([
    {
      ticket_id: ticket.id,
      role: 'customer',
      content: message,
      metadata: JSON.stringify({ customerEmail, customerName }),
    },
    {
      ticket_id: ticket.id,
      role: 'ai',
      content: aiResponse,
      metadata: JSON.stringify({
        confidence,
        category,
        priority,
        tags,
        parseError: triageParseError,
      }),
    },
  ])

  // ── Step 3: Notification + usage tracking ─────────────────────────────────
  try {
    await db.from('notifications').insert({
      owner_id: user.id,
      source: 'support',
      severity: priority === 'urgent' ? 'error' : priority === 'high' ? 'warning' : 'info',
      title: `New support ticket: ${subject}`,
      message: `Category: ${category} · Priority: ${priority}`,
      link_type: 'support',
      link_id: ticket.id,
      action_url: `/support?id=${ticket.id}`,
      metadata: JSON.stringify({ ticketId: ticket.id, category, priority }),
    })
  } catch {
    /* non-fatal */
  }

  await trackUsage(user.id, 'llm_tokens', 1, { via: 'support', ticketId: ticket.id, category })

  return NextResponse.json(
    {
      ok: true,
      ticket: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        aiResponse: ticket.ai_response,
        aiConfidence: ticket.ai_confidence,
        tags,
        createdAt: ticket.created_at,
      },
      triage: {
        category,
        priority,
        confidence,
        tags,
        parseError: triageParseError,
      },
      message: triageParseError
        ? 'Ticket created but AI triage had issues — review the response.'
        : 'Ticket created and AI response sent.',
    },
    { status: 201 },
  )
}
