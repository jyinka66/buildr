// GET /api/notifications/unread-count — return the user's unread count.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { count: unread } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
    .is('read_at', null)

  return NextResponse.json({ unread })
}
