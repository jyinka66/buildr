// GET /api/notifications — list the signed-in user's notifications.
// Query params: ?unread=true &source= &limit=50
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

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
  const unread = searchParams.get('unread') === 'true'
  const source = searchParams.get('source') || undefined
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  let query = db.from('notifications').select('*').eq('owner_id', user.id)
  if (unread) query = query.is('read_at', null)
  if (source) query = query.eq('source', source)
  const { data: rows } = await query.order('created_at', { ascending: false }).limit(limit)

  const notifications = (rows ?? []).map((n) => ({
    id: n.id,
    source: n.source,
    severity: n.severity,
    title: n.title,
    message: n.message,
    linkType: n.link_type,
    linkId: n.link_id,
    actionUrl: n.action_url,
    readAt: n.read_at ? new Date(n.read_at).toISOString() : null,
    createdAt: new Date(n.created_at).toISOString(),
  }))

  return NextResponse.json({ notifications })
}
