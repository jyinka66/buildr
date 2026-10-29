// /api/marketing/track
// ------------------------------------------------------------------
// GET  ?c={shortCode}  — public redirect: lookup, increment clicks, 302 → destination+UTM
// POST                 — create a new tracking link (auth required)
//
// The POST handler is used by the ROI dashboard's "Create Tracking Link"
// dialog. It calls createTrackingLink() from @/lib/utm to generate the
// short code + insert the row.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import {
  SHORT_URL_BASE,
  buildRedirectUrl,
  createTrackingLink,
} from '@/lib/utm'

// ── GET: public redirect ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('c')

  if (!code) {
    return NextResponse.redirect(new URL('/?track=missing_code', SHORT_URL_BASE), 302)
  }

  // Look up the tracking row by short_code.
  const { data: row } = await db
    .from('campaign_tracking')
    .select('*')
    .eq('short_code', code)
    .maybeSingle()

  if (!row) {
    return NextResponse.redirect(new URL('/?track=not_found', SHORT_URL_BASE), 302)
  }

  // Increment clicks counter + update last_clicked_at.
  // For Supabase this would ideally be an RPC; for the local store we read+write.
  const currentClicks = Number((row as { clicks?: number }).clicks ?? 0)
  await db
    .from('campaign_tracking')
    .update({
      clicks: currentClicks + 1,
      last_clicked_at: new Date().toISOString(),
    })
    .eq('short_code', code)

  const redirectUrl = buildRedirectUrl(row as Parameters<typeof buildRedirectUrl>[0])
  return NextResponse.redirect(redirectUrl, 302)
}

// ── POST: create tracking link (auth required) ────────────────────
interface CreateBody {
  destinationUrl?: string
  source?: string
  medium?: string
  campaign?: string
  content?: string
  campaignId?: string | null
  postId?: string | null
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

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const destinationUrl = body.destinationUrl?.trim()
  const source = body.source?.trim() || ''
  const medium = body.medium?.trim() || ''
  const campaign = body.campaign?.trim() || ''

  if (!destinationUrl) {
    return NextResponse.json({ error: 'destinationUrl is required' }, { status: 400 })
  }
  // Normalize destination to an absolute URL so buildRedirectUrl works.
  const normalizedDest = /^https?:\/\//i.test(destinationUrl)
    ? destinationUrl
    : `https://${destinationUrl}`

  try {
    const result = await createTrackingLink({
      ownerId: user.id,
      destinationUrl: normalizedDest,
      utm: { source, medium, campaign, content: body.content?.trim() || undefined },
      campaignId: body.campaignId ?? null,
      postId: body.postId ?? null,
    })
    return NextResponse.json({ ok: true, ...result }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'create_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
