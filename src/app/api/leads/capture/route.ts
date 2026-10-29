// POST /api/leads/capture — public lead capture endpoint (no auth required).
// ------------------------------------------------------------------
// This is what AI-generated landing pages would POST to. Creates a lead with
// source='form' attributed to the project's owner.
//
// Body: { name, email, phone?, company?, requirements?, projectId }
// Rate-limited per IP (20/hour) to prevent abuse.
// Returns: { ok, leadId } — does not leak owner info.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const VALID_UTM_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
])

interface CaptureBody {
  name?: string
  email?: string
  phone?: string
  company?: string
  requirements?: string
  projectId?: string
  campaignId?: string
  trackingId?: string
  utm?: Record<string, unknown>
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

// Pull UTM params out of the Referer / query string if not explicitly provided.
function extractUtm(req: NextRequest, body: Record<string, unknown>): Record<string, unknown> {
  if (body.utm && typeof body.utm === 'object') {
    const utm = body.utm as Record<string, unknown>
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(utm)) {
      if (VALID_UTM_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number')) {
        filtered[k] = String(v)
      }
    }
    return filtered
  }
  // Fall back to query string.
  const url = new URL(req.url)
  const utm: Record<string, unknown> = {}
  for (const key of VALID_UTM_KEYS) {
    const v = url.searchParams.get(key)
    if (v) utm[key] = v
  }
  return utm
}

export async function POST(req: NextRequest) {
  // Rate-limit by IP — 20 submissions per hour per IP.
  const ip = getClientIp(req)
  const rl = rateLimit(`lead-capture:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  let body: CaptureBody
  try {
    body = (await req.json()) as CaptureBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const phone = (body.phone ?? '').trim() || null
  const company = (body.company ?? '').trim() || null
  const requirements = (body.requirements ?? '').trim() || null
  const projectId = (body.projectId ?? '').trim() || null
  const campaignId = (body.campaignId ?? '').trim() || null
  const trackingId = (body.trackingId ?? '').trim() || null
  const utmData = extractUtm(req, body as Record<string, unknown>)

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required.' }, { status: 400 })
  }
  // Basic email format check.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!projectId) {
    // Without a project context we can't attribute the lead to an owner.
    return NextResponse.json(
      { error: 'projectId is required for public capture.' },
      { status: 400 },
    )
  }

  // Resolve the project's owner so we can attribute the lead.
  const { data: project, error: projectErr } = await db
    .from('projects')
    .select('id, owner_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projectErr || !project) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
  }
  const ownerId = (project as { owner_id?: string }).owner_id ?? null
  if (!ownerId) {
    return NextResponse.json({ error: 'project_has_no_owner' }, { status: 500 })
  }

  const { data: lead, error } = await db
    .from('leads')
    .insert({
      owner_id: ownerId,
      project_id: projectId,
      name,
      email,
      phone,
      company,
      source: 'form',
      campaign_id: campaignId,
      tracking_id: trackingId,
      utm_data: utmData,
      requirements,
      budget: null,
      status: 'new',
      notes: [],
    })
    .select('id')
    .single()

  if (error || !lead) {
    return NextResponse.json(
      { error: 'capture_failed' }, // Don't leak internal error details publicly.
      { status: 500 },
    )
  }

  return NextResponse.json(
    { ok: true, leadId: (lead as { id: string }).id },
    { status: 201 },
  )
}
