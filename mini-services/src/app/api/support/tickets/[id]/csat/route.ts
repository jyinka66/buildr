// POST /api/support/tickets/[id]/csat — rate the ticket 1-5.
// ------------------------------------------------------------------
// Body: { rating: number (1-5), comment?: string }
// Persists csatRating + csatComment. Appends a 'system' SupportMessage
// noting the rating. Idempotent: re-rating updates the existing value.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface CsatBody {
  rating?: number
  comment?: string
}

interface TicketRow {
  id: string
  csat_rating: number | null
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
    .select('id, csat_rating')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const ticketRow = ticket as TicketRow

  const body = (await req.json().catch(() => ({}))) as CsatBody
  const rating = Math.round(Number(body.rating))
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: 'rating must be an integer between 1 and 5.' },
      { status: 400 },
    )
  }
  const comment = body.comment?.trim() || ''
  const wasRated = ticketRow.csat_rating !== null

  // Record a 'system' message so the conversation trail shows the rating.
  await db.from('support_messages').insert({
    ticket_id: ticketRow.id,
    role: 'system',
    content: `CSAT rating: ${rating}/5${comment ? ` — "${comment}"` : ''}`,
    metadata: JSON.stringify({ action: 'csat', rating, comment, previousRating: ticketRow.csat_rating }),
  })

  const { data: updated, error: updateError } = await db
    .from('support_tickets')
    .update({ csat_rating: rating, csat_comment: comment || null })
    .eq('id', ticketRow.id)
    .select('id, subject, csat_rating, csat_comment, updated_at')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
  }

  try {
    await db.from('notifications').insert({
      owner_id: user.id,
      source: 'support',
      severity: rating >= 4 ? 'success' : rating === 3 ? 'info' : 'warning',
      title: `CSAT ${rating}/5 on: ${updated.subject}`,
      message: comment || `Customer rated this ticket ${rating}/5.`,
      link_type: 'support',
      link_id: updated.id,
      action_url: `/support?id=${updated.id}`,
      metadata: JSON.stringify({ ticketId: updated.id, action: 'csat', rating }),
    })
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    ok: true,
    wasRated,
    ticket: {
      id: updated.id,
      csatRating: updated.csat_rating,
      csatComment: updated.csat_comment,
      updatedAt: updated.updated_at,
    },
  })
}
