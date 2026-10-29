// /api/leads
// ------------------------------------------------------------------
// GET  — list leads for the authenticated user. Supports ?status=&source= filters.
// POST — create a lead manually (auth required) OR from a public form submission
//        (source='form', no auth — but only when projectId is provided so we can
//        attribute the lead to the project's owner).
//
// Auth: requireSessionUser() for manual creation; no auth for form submissions.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const VALID_STATUSES = new Set(['new', 'contacted', 'qualified', 'converted', 'lost'])
const VALID_SOURCES = new Set(['organic', 'ad', 'social', 'referral', 'form'])

interface CreateBody {
  name?: string
  email?: string
  phone?: string
  company?: string
  source?: string
  requirements?: string
  budget?: number
  campaignId?: string
  trackingId?: string
  utmData?: Record<string, unknown>
  projectId?: string
}

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const source = url.searchParams.get('source')

  let query = db.from('leads').select('*').eq('owner_id', user.id)
  if (status && VALID_STATUSES.has(status)) {
    query = query.eq('status', status)
  }
  if (source && VALID_SOURCES.has(source)) {
    query = query.eq('source', source)
  }
  const { data: leads, error } = await query
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    leads: (leads ?? []).map((l: Record<string, unknown>) => mapLeadRow(l)),
  })
}

export async function POST(req: NextRequest) {
  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
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
  const utmData = body.utmData && typeof body.utmData === 'object' ? body.utmData : {}
  const sourceRaw = (body.source ?? '').trim().toLowerCase()
  const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw! : 'organic'
  const budget = Math.max(0, Math.floor(Number(body.budget) || 0)) || null

  if (!name || !email) {
    return NextResponse.json(
      { error: 'name and email are required.' },
      { status: 400 },
    )
  }

  // Determine the owner.
  // - Authenticated manual creation → owner is the session user.
  // - Public form submission (source='form') → owner is the project's owner.
  let ownerId: string | null = null

  if (source === 'form' && projectId) {
    // Public form submission — rate-limit by IP to avoid abuse.
    const ip = getClientIp(req)
    const rl = rateLimit(`lead-capture:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 })
    if (!rl.ok) return rateLimitedResponse(rl.resetMs)

    // Resolve the project's owner.
    const { data: project } = await db
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    }
    ownerId = (project as { owner_id?: string }).owner_id ?? null
  } else {
    // Manual creation by an authenticated user.
    let user
    try {
      user = await requireSessionUser()
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
      throw err
    }
    ownerId = user.id
  }

  if (!ownerId) {
    return NextResponse.json({ error: 'owner_unresolved' }, { status: 400 })
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
      source,
      campaign_id: campaignId,
      tracking_id: trackingId,
      utm_data: utmData,
      requirements,
      budget,
      status: 'new',
      notes: [],
    })
    .select('*')
    .single()

  if (error || !lead) {
    return NextResponse.json(
      { error: error?.message ?? 'insert_failed' },
      { status: 500 },
    )
  }

  // For public form submissions, don't leak owner info — only return the leadId.
  if (source === 'form' && projectId) {
    return NextResponse.json(
      { ok: true, leadId: (lead as { id: string }).id },
      { status: 201 },
    )
  }

  return NextResponse.json(
    { ok: true, lead: mapLeadRow(lead as Record<string, unknown>) },
    { status: 201 },
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

function mapLeadRow(row: Record<string, unknown>): Record<string, unknown> {
  const notesRaw = row.notes
  const notes = Array.isArray(notesRaw) ? notesRaw : []
  const utm = row.utm_data && typeof row.utm_data === 'object' ? row.utm_data : {}
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id ?? null,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    company: row.company ?? null,
    source: row.source ?? 'organic',
    campaignId: row.campaign_id ?? null,
    trackingId: row.tracking_id ?? null,
    utmData: utm,
    requirements: row.requirements ?? null,
    budget: typeof row.budget === 'number' ? row.budget : null,
    status: row.status ?? 'new',
    convertedJobId: row.converted_job_id ?? null,
    convertedAt: row.converted_at ? new Date(row.converted_at as string).toISOString() : null,
    notes,
    createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }
}
