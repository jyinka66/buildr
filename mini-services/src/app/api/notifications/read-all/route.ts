// POST /api/notifications/read-all — mark all unread notifications as read.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function POST() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const now = new Date()
  await db.from('notifications').update({ read_at: now }).eq('owner_id', user.id).is('read_at', null)

  return NextResponse.json({ ok: true })
}
