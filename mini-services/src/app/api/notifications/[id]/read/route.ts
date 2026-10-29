// POST /api/notifications/[id]/read — mark a single notification as read.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params

  // Ensure the notification exists and belongs to the user before mutating.
  const { data: existing } = await db
    .from('notifications')
    .select('owner_id, read_at')
    .eq('id', id)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!existing.read_at) {
    await db.from('notifications').update({ read_at: new Date() }).eq('id', id)
  }

  return NextResponse.json({ ok: true })
}
