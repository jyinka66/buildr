// GET /api/marketing/roi — ROI dashboard data for the authenticated user.
// ------------------------------------------------------------------
// Aggregates the user's campaign_tracking rows into:
//   - totals (clicks, conversions, revenueKobo, conversionRate)
//   - byCampaign  — grouped by campaign_id (name from UTM campaign / marketing_campaigns)
//   - byPlatform  — grouped by utm.source
//   - topPerforming — top 5 links by conversions
//   - recentClicks  — last 10 clicked links
//
// If no tracking rows exist, returns zeros + empty arrays (never crashes).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface TrackingRow {
  id: string
  short_code: string
  destination_url: string
  utm?: { source?: string; medium?: string; campaign?: string; content?: string } | null
  campaign_id?: string | null
  post_id?: string | null
  clicks?: number
  conversions?: number
  revenue_kobo?: number
  last_clicked_at?: string | null
  created_at?: string
}

interface MarketingCampaign {
  id: string
  campaign_type?: string
  platform?: string
  content?: Record<string, unknown> | string
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

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

  // Fetch all tracking rows owned by the user.
  const { data: rows, error } = await db
    .from('campaign_tracking')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const trackingRows = (rows ?? []) as unknown as TrackingRow[]

  // Empty-state: return zeros so the dashboard renders cleanly.
  if (trackingRows.length === 0) {
    return NextResponse.json({
      totalClicks: 0,
      totalConversions: 0,
      totalRevenueKobo: 0,
      conversionRate: 0,
      byCampaign: [],
      byPlatform: [],
      topPerforming: [],
      recentClicks: [],
    })
  }

  // ── Aggregate totals ────────────────────────────────────────────
  let totalClicks = 0
  let totalConversions = 0
  let totalRevenueKobo = 0

  // Maps for grouping.
  const campaignMap = new Map<
    string,
    { campaignId: string; campaignName: string; clicks: number; conversions: number; revenue: number }
  >()
  const platformMap = new Map<
    string,
    { platform: string; clicks: number; conversions: number; revenue: number }
  >()

  for (const r of trackingRows) {
    const clicks = num(r.clicks)
    const conversions = num(r.conversions)
    const revenue = num(r.revenue_kobo)
    totalClicks += clicks
    totalConversions += conversions
    totalRevenueKobo += revenue

    // Group by campaign_id (fall back to UTM campaign string, then 'uncategorized').
    const utm = r.utm ?? {}
    const campaignId = r.campaign_id || utm.campaign || 'uncategorized'
    const campaignName = utm.campaign || 'Uncategorized'
    const c = campaignMap.get(campaignId) ?? {
      campaignId,
      campaignName,
      clicks: 0,
      conversions: 0,
      revenue: 0,
    }
    c.clicks += clicks
    c.conversions += conversions
    c.revenue += revenue
    campaignMap.set(campaignId, c)

    // Group by platform (utm.source). Unknown → 'direct'.
    const platform = utm.source || 'direct'
    const p = platformMap.get(platform) ?? { platform, clicks: 0, conversions: 0, revenue: 0 }
    p.clicks += clicks
    p.conversions += conversions
    p.revenue += revenue
    platformMap.set(platform, p)
  }

  const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0

  // ── byCampaign ─────────────────────────────────────────────────
  // Try to enrich campaignName from marketing_campaigns if available.
  const campaignIds = [...campaignMap.keys()].filter((id) => id !== 'uncategorized')
  const campaignNameLookup = new Map<string, string>()
  if (campaignIds.length > 0) {
    const { data: mCampaigns } = await db
      .from('marketing_campaigns')
      .select('id,campaign_type,platform,content')
      .in('id', campaignIds)
    for (const mc of (mCampaigns ?? []) as unknown as MarketingCampaign[]) {
      // marketing_campaigns has no `name` column — derive from content or platform.
      let derivedName = ''
      if (mc.content) {
        const c = typeof mc.content === 'string' ? safeParse(mc.content) : mc.content
        const obj = (c ?? {}) as Record<string, unknown>
        derivedName =
          (typeof obj.name === 'string' && obj.name) ||
          (typeof obj.title === 'string' && obj.title) ||
          (typeof obj.subject === 'string' && obj.subject) ||
          ''
      }
      if (!derivedName) derivedName = mc.campaign_type ? `${mc.campaign_type} (${mc.platform ?? 'all'})` : ''
      if (derivedName) campaignNameLookup.set(mc.id, derivedName)
    }
  }

  const byCampaign = [...campaignMap.values()]
    .map((c) => ({
      campaignId: c.campaignId,
      campaignName: campaignNameLookup.get(c.campaignId) || c.campaignName,
      clicks: c.clicks,
      conversions: c.conversions,
      revenue: c.revenue,
      ctr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks)

  // ── byPlatform ─────────────────────────────────────────────────
  const byPlatform = [...platformMap.values()]
    .map((p) => ({
      platform: p.platform,
      clicks: p.clicks,
      conversions: p.conversions,
      revenue: p.revenue,
    }))
    .sort((a, b) => b.clicks - a.clicks)

  // ── topPerforming ──────────────────────────────────────────────
  const topPerforming = [...trackingRows]
    .sort((a, b) => num(b.conversions) - num(a.conversions) || num(b.revenue_kobo) - num(a.revenue_kobo))
    .slice(0, 5)
    .map((r) => ({
      trackingId: r.id,
      shortCode: r.short_code,
      clicks: num(r.clicks),
      conversions: num(r.conversions),
      revenue: num(r.revenue_kobo),
    }))

  // ── recentClicks ───────────────────────────────────────────────
  const recentClicks = [...trackingRows]
    .filter((r) => r.last_clicked_at)
    .sort((a, b) => {
      const aT = a.last_clicked_at ? new Date(a.last_clicked_at).getTime() : 0
      const bT = b.last_clicked_at ? new Date(b.last_clicked_at).getTime() : 0
      return bT - aT
    })
    .slice(0, 10)
    .map((r) => ({
      trackingId: r.id,
      clickedAt: r.last_clicked_at as string,
      source: r.utm?.source || 'direct',
    }))

  return NextResponse.json({
    totalClicks,
    totalConversions,
    totalRevenueKobo,
    conversionRate: Math.round(conversionRate * 100) / 100,
    byCampaign,
    byPlatform,
    topPerforming,
    recentClicks,
  })
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}
