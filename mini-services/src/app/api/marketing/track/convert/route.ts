// POST /api/marketing/track/convert — record a conversion.
// ------------------------------------------------------------------
// Called when a lead converts or a payment is made. Increments the
// conversions counter on the matching tracking row and adds revenue_kobo.
//
// Auth: requireSessionUser() (server-to-server in practice, but still gated).
// Body: { trackingId?: string, shortCode?: string, revenueKobo?: number }
// Either trackingId or shortCode must be provided. Returns { ok: true }.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface ConvertBody {
  trackingId?: string
  shortCode?: string
  revenueKobo?: number
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  let body: ConvertBody
  try {
    body = (await req.json()) as ConvertBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const revenueKobo = Math.max(0, Math.floor(Number(body.revenueKobo) || 0))

  // Resolve the tracking row by id OR short_code.
  let query
  if (body.trackingId?.trim()) {
    query = db
      .from('campaign_tracking')
      .select('*')
      .eq('id', body.trackingId.trim())
  } else if (body.shortCode?.trim()) {
    query = db
      .from('campaign_tracking')
      .select('*')
      .eq('short_code', body.shortCode.trim())
  } else {
    return NextResponse.json(
      { error: 'trackingId or shortCode is required' },
      { status: 400 },
    )
  }

  const { data: row, error } = await query.maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Only the owner can record conversions for their links.
  if ((row as { owner_id?: string }).owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const r = row as {
    id: string
    conversions?: number
    revenue_kobo?: number
  }

  await db
    .from('campaign_tracking')
    .update({
      conversions: Number(r.conversions ?? 0) + 1,
      revenue_kobo: Number(r.revenue_kobo ?? 0) + revenueKobo,
      updated_at: new Date().toISOString(),
    })
    .eq('id', r.id)

  return NextResponse.json({ ok: true })
}
