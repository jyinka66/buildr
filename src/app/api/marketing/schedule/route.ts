// GET  /api/marketing/schedule — list scheduled posts for the authenticated user.
// POST /api/marketing/schedule — create a scheduled post.
// ------------------------------------------------------------------
// GET query params:
//   ?status=scheduled&from=2024-01-01&to=2024-12-31
//   (status filters by exact status; from/to are inclusive date-range filters
//   on scheduled_at using gte/lte on ISO strings.)
//
// POST body:
//   { title, content, platforms: string[], scheduledAt, mediaUrls?,
//     hashtags?, campaignId? }
// Inserts into `scheduled_posts` table.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const VALID_STATUSES = new Set(['scheduled', 'posting', 'posted', 'failed', 'draft'])
const VALID_PLATFORMS = new Set(['meta', 'x', 'linkedin', 'instagram', 'tiktok'])

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
    } catch {
      return []
    }
  }
  return []
}

function toPostView(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    platforms: parseJsonArray(row.platforms),
    mediaUrls: parseJsonArray(row.media_urls),
    hashtags: parseJsonArray(row.hashtags),
    scheduledAt: row.scheduled_at,
    status: row.status,
    campaignId: row.campaign_id ?? null,
    postedAt: row.posted_at ?? null,
    results: row.post_results && typeof row.post_results === 'object' ? row.post_results : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// GET — list scheduled posts (optionally filtered by status / date range).
export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || ''
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''

  let query = db
    .from('scheduled_posts')
    .select('*')
    .eq('owner_id', user.id)

  if (status && VALID_STATUSES.has(status)) {
    query = query.eq('status', status)
  }
  if (from) {
    query = query.gte('scheduled_at', new Date(from).toISOString())
  }
  if (to) {
    // Include the entire `to` day — push to end-of-day so the bound is inclusive.
    const toDate = new Date(to)
    toDate.setUTCHours(23, 59, 59, 999)
    query = query.lte('scheduled_at', toDate.toISOString())
  }

  const { data, error } = await query.order('scheduled_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const posts = (data || []).map((row: Record<string, unknown>) => toPostView(row))
  return NextResponse.json({ posts })
}

interface CreateBody {
  title?: string
  content?: string
  platforms?: string[]
  scheduledAt?: string
  mediaUrls?: string[]
  hashtags?: string[]
  campaignId?: string
}

// POST — create a scheduled post.
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as CreateBody

  const title = (body.title || '').trim()
  const content = (body.content || '').trim()
  const scheduledAt = (body.scheduledAt || '').trim()
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((p) => typeof p === 'string' && VALID_PLATFORMS.has(p))
    : []

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (platforms.length === 0) {
    return NextResponse.json({ error: 'at least one platform is required' }, { status: 400 })
  }
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ error: 'scheduledAt must be a valid ISO date' }, { status: 400 })
  }

  const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls.filter((u) => typeof u === 'string') : []
  const hashtags = Array.isArray(body.hashtags)
    ? body.hashtags
        .filter((h) => typeof h === 'string')
        .map((h) => h.replace(/^#/, '').trim())
        .filter(Boolean)
    : []

  const { data, error } = await db
    .from('scheduled_posts')
    .insert({
      owner_id: user.id,
      title,
      content,
      platforms: JSON.stringify(platforms),
      media_urls: JSON.stringify(mediaUrls),
      hashtags: JSON.stringify(hashtags),
      scheduled_at: new Date(scheduledAt).toISOString(),
      status: 'scheduled',
      campaign_id: body.campaignId || null,
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json(
    { ok: true, post: toPostView(data as Record<string, unknown>) },
    { status: 201 },
  )
}
