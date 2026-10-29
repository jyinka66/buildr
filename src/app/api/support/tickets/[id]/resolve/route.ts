// POST /api/support/tickets/[id]/resolve — mark a ticket resolved.
// ------------------------------------------------------------------
// Body: { comment?: string }
// Sets status='resolved', resolvedAt=now, appends an optional 'system'
// SupportMessage noting the resolution.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface ResolveBody {
  comment?: string
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
    .select('id, status, subject')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as ResolveBody
  const comment = body.comment?.trim() || ''

  if (ticket.status === 'resolved') {
    return NextResponse.json({ ok: true, alreadyResolved: true })
  }

  const now = new Date().toISOString()

  if (comment) {
    await db.from('support_messages').insert({
      ticket_id: ticket.id,
      role: 'system',
      content: `Ticket marked as resolved${comment ? `: ${comment}` : '.'}`,
      metadata: JSON.stringify({ action: 'resolve', comment }),
    })
  }

  const { data: updated, error: updateError } = await db
    .from('support_tickets')
    .update({ status: 'resolved', resolved_at: now })
    .eq('id', ticket.id)
    .select('id, subject, status, resolved_at, updated_at')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
  }

  try {
    await db.from('notifications').insert({
      owner_id: user.id,
      source: 'support',
      severity: 'success',
      title: `Ticket resolved: ${updated.subject}`,
      message: comment || 'Marked as resolved.',
      link_type: 'support',
      link_id: updated.id,
      action_url: `/support?id=${updated.id}`,
      metadata: JSON.stringify({ ticketId: updated.id, action: 'resolve' }),
    })
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    ok: true,
    ticket: {
      id: updated.id,
      status: updated.status,
      resolvedAt: updated.resolved_at,
      updatedAt: updated.updated_at,
    },
  })
}
