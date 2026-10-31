// PATCH  /api/marketing/schedule/[id] — update a scheduled post (reschedule, edit content)
// DELETE /api/marketing/schedule/[id] — cancel (delete) a scheduled post
// ------------------------------------------------------------------
// Auth: requireSessionUser() + verify ownership (owner_id === user.id).
//
// PATCH body (any subset):
//   { title?, content?, platforms?, scheduledAt?, mediaUrls?, hashtags?, status? }
//   status must be one of: scheduled | posted | failed | draft

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const VALID_STATUSES = new Set(['scheduled', 'posted', 'failed', 'draft'])
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

interface PatchBody {
  title?: string
  content?: string
  platforms?: string[]
  scheduledAt?: string
  mediaUrls?: string[]
  hashtags?: string[]
  status?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { id } = await params

  // Verify ownership.
  const { data: existing } = await db
    .from('scheduled_posts')
    .select('owner_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // While the publisher is sending a post, changing it (or putting it back to "scheduled")
  // could make it go out twice. Wait for it to finish.
  if (existing.status === 'posting') {
    return NextResponse.json({ error: 'post_is_publishing', message: 'This post is being published right now. Try again in a minute.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const patch: Record<string, unknown> = {}

  if (typeof body.title === 'string' && body.title.trim()) {
    patch.title = body.title.trim()
  }
  if (typeof body.content === 'string' && body.content.trim()) {
    patch.content = body.content.trim()
  }
  if (Array.isArray(body.platforms)) {
    const platforms = body.platforms.filter((p) => typeof p === 'string' && VALID_PLATFORMS.has(p))
    if (platforms.length > 0) patch.platforms = JSON.stringify(platforms)
  }
  if (Array.isArray(body.mediaUrls)) {
    patch.media_urls = JSON.stringify(body.mediaUrls.filter((u) => typeof u === 'string'))
  }
  if (Array.isArray(body.hashtags)) {
    patch.hashtags = JSON.stringify(
      body.hashtags
        .filter((h) => typeof h === 'string')
        .map((h) => h.replace(/^#/, '').trim())
        .filter(Boolean),
    )
  }
  if (typeof body.scheduledAt === 'string' && body.scheduledAt.trim()) {
    if (Number.isNaN(Date.parse(body.scheduledAt))) {
      return NextResponse.json({ error: 'scheduledAt must be a valid ISO date' }, { status: 400 })
    }
    patch.scheduled_at = new Date(body.scheduledAt).toISOString()
  }
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    patch.status = body.status
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const { error } = await db.from('scheduled_posts').update(patch).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: freshRow } = await db
    .from('scheduled_posts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  return NextResponse.json({ ok: true, post: toPostView(freshRow as Record<string, unknown>) })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { id } = await params

  const { data: existing } = await db
    .from('scheduled_posts')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { error } = await db.from('scheduled_posts').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
