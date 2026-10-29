// GET /api/support/tickets/[id]/messages — list the conversation thread for a ticket
//
// Layer 6 — AI Customer Support.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  // Verify ownership.
  const { data: ticket } = await db
    .from('support_tickets')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (!ticket) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: messages, error } = await db
    .from('support_messages')
    .select('*')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true })
    .limit(200 as never)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    messages: (messages ?? []).map((m: Record<string, unknown>) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      createdAt: new Date(m.created_at as string).toISOString(),
    })),
  })
}
