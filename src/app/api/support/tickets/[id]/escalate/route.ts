// POST /api/support/tickets/[id]/escalate — escalate a ticket.
// ------------------------------------------------------------------
// Body: { reason?: string }
// Sets status='escalated', escalatedAt=now, bumps priority to 'high' or
// 'urgent' (urgent if it was already high/urgent). Appends a 'system'
// SupportMessage noting the escalation reason.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface EscalateBody {
  reason?: string
}

interface TicketRow {
  id: string
  status: string
  priority: string
}

function nextPriority(current: string): 'high' | 'urgent' {
  if (current === 'urgent') return 'urgent'
  if (current === 'high') return 'urgent'
  return 'high'
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

  const { data: ticket, error: ticketError } = await db
    .from('support_tickets')
    .select('id, status, priority')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const ticketRow = ticket as TicketRow

  if (ticketRow.status === 'escalated') {
    return NextResponse.json({ ok: true, alreadyEscalated: true })
  }

  const body = (await req.json().catch(() => ({}))) as EscalateBody
  const reason = body.reason?.trim() || ''
  const newPriority = nextPriority(ticketRow.priority)
  const now = new Date().toISOString()

  if (reason) {
    await db.from('support_messages').insert({
      ticket_id: ticketRow.id,
      role: 'system',
      content: `Ticket escalated${reason ? `: ${reason}` : '.'}`,
      metadata: JSON.stringify({ action: 'escalate', reason, fromPriority: ticketRow.priority }),
    })
  }

  const { data: updated, error: updateError } = await db
    .from('support_tickets')
    .update({
      status: 'escalated',
      escalated_at: now,
      priority: newPriority,
    })
    .eq('id', ticketRow.id)
    .select('id, subject, status, priority, escalated_at, updated_at')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
  }

  try {
    await db.from('notifications').insert({
      owner_id: user.id,
      source: 'support',
      severity: 'error',
      title: `Ticket escalated: ${updated.subject}`,
      message: reason || `Priority bumped to ${newPriority}.`,
      link_type: 'support',
      link_id: updated.id,
      action_url: `/support?id=${updated.id}`,
      metadata: JSON.stringify({
        ticketId: updated.id,
        action: 'escalate',
        priority: newPriority,
      }),
    })
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    ok: true,
    ticket: {
      id: updated.id,
      status: updated.status,
      priority: updated.priority,
      escalatedAt: updated.escalated_at,
      updatedAt: updated.updated_at,
    },
  })
}
