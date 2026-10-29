// GET /api/marketing/analytics — returns marketing performance analytics.
// Aggregates data from marketing_campaigns table + computes per-channel metrics.
//
// Returns:
//   - Campaign count per channel
//   - Total campaigns generated
//   - Per-type breakdown (ads/social/email/seo)
//   - Per-platform breakdown
//   - Recent campaigns list
//   - AI optimization suggestions

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET() {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  // Fetch all campaigns for the user
  const { data: campaigns, error } = await db.from('marketing_campaigns')
    .select('*').eq('owner_id', user.id).order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const allCampaigns = campaigns || []

  // Compute breakdowns
  const byType: Record<string, number> = { ads: 0, social: 0, email: 0, seo: 0, ad_creatives: 0, email_flows: 0 }
  const byPlatform: Record<string, number> = {}
  const byStatus: Record<string, number> = { draft: 0, generated: 0, scheduled: 0, published: 0 }

  for (const c of allCampaigns) {
    const type = c.campaign_type as string
    byType[type] = (byType[type] || 0) + 1
    const platform = c.platform as string
    byPlatform[platform] = (byPlatform[platform] || 0) + 1
    const status = c.status as string
    byStatus[status] = (byStatus[status] || 0) + 1
  }

  // Recent campaigns (last 10)
  const recent = allCampaigns.slice(0, 10).map((c) => ({
    id: c.id,
    type: c.campaign_type,
    platform: c.platform,
    status: c.status,
    createdAt: new Date(c.created_at as string).toISOString(),
  }))

  // AI optimization suggestions (rule-based)
  const suggestions: string[] = []
  if (byType.ads === 0 && byType.ad_creatives === 0) suggestions.push('You haven\'t generated any ad campaigns yet. Start with Meta ads for broadest reach.')
  if (byType.email === 0 && byType.email_flows === 0) suggestions.push('No email campaigns detected. Email has the highest ROI — generate a welcome flow.')
  if (byType.seo === 0) suggestions.push('No SEO content generated. Long-form blog posts drive organic traffic for months.')
  if (byType.social > 5) suggestions.push('You have strong social content. Consider repurposing top posts as ads.')
  if (byStatus.draft > 3) suggestions.push(`${byStatus.draft} campaigns are still in draft. Publish them to start seeing results.`)
  if (suggestions.length === 0) suggestions.push('Great coverage across channels! Focus on A/B testing your best-performing content.')

  return NextResponse.json({
    totalCampaigns: allCampaigns.length,
    byType,
    byPlatform,
    byStatus,
    recent,
    suggestions,
  })
}
