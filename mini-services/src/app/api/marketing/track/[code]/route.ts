// GET /api/marketing/track/[code] — tracking stats for a specific short code.
// ------------------------------------------------------------------
// Auth: requireSessionUser() + verify the row's owner_id matches the
// session user. Returns clicks, conversions, revenue (kobo), destination
// URL, and the stored UTM object.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
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

  const { code } = await params

  const { data: row, error } = await db
    .from('campaign_tracking')
    .select('*')
    .eq('short_code', code)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Ownership check.
  if ((row as { owner_id?: string }).owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const r = row as {
    clicks?: number
    conversions?: number
    revenue_kobo?: number
    destination_url?: string
    utm?: { source?: string; medium?: string; campaign?: string; content?: string } | null
  }

  return NextResponse.json({
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
    revenueKobo: Number(r.revenue_kobo ?? 0),
    destinationUrl: r.destination_url ?? '',
    utm: r.utm ?? { source: '', medium: '', campaign: '', content: '' },
  })
}
