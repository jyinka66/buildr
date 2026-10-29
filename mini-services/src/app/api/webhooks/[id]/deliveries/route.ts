// GET /api/webhooks/[id]/deliveries — delivery history for a webhook.
// ------------------------------------------------------------------
// Query params: ?limit=50 &status= (success | failed | retrying | pending)
// Returns the most recent deliveries, newest first.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface DeliveryRow {
  id: string
  event_type: string
  status: string
  status_code: number | null
  response_body: string | null
  attempt: number
  delivered_at: string | null
  next_retry_at: string | null
  created_at: string
}

function serialize(row: DeliveryRow) {
  return {
    id: row.id,
    eventType: row.event_type,
    status: row.status,
    statusCode: row.status_code,
    responseBody: row.response_body,
    attempt: row.attempt,
    deliveredAt: row.delivered_at,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
  }
}

export async function GET(
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

  // Ensure the webhook exists and belongs to the user before listing
  // deliveries.
  const { data: webhook, error: webhookError } = await db
    .from('webhooks')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (webhookError || !webhook) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || undefined
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  let query: any = db.from('webhook_deliveries')
    .select('*')
    .eq('webhook_id', id)
    .eq('owner_id', user.id)
  if (status) query = query.eq('status', status)

  const { data: rows, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    deliveries: ((rows as DeliveryRow[] | null) ?? []).map(serialize),
  })
}
