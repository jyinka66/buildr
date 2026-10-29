// GET /api/v1/notifications — list the authenticated user's notifications (public API)
//
// Layer 9 — Public API. Requires scope: notifications:read.
// Query: ?unread=true  &limit=20

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey } from '@/lib/api-key'

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req, 'notifications:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === 'true'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)

  let query = db
    .from('notifications')
    .select('*')
    .eq('owner_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(limit as never)
  if (unreadOnly) query = query.is('read_at', null) as typeof query

  const { data: notifications, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    notifications: (notifications ?? []).map((n: Record<string, unknown>) => ({
      id: n.id,
      source: n.source,
      severity: n.severity,
      title: n.title,
      message: n.message,
      readAt: n.read_at ? new Date(n.read_at as string).toISOString() : null,
      createdAt: new Date(n.created_at as string).toISOString(),
    })),
  })
}
