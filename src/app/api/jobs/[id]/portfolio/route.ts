// GET /api/jobs/[id]/portfolio — generates a public portfolio entry for a completed job.
// Returns: job details + scope + client review (if any) + tech stack + timeline.
// This is public (no auth) so it can be shared as a portfolio link.

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  // Fetch the job — only return portfolio data if it's delivered
  const { data: job, error } = await db.from('jobs').select('*').eq('id', id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Only show delivered or reviewing jobs in portfolio
  if (!['delivered', 'reviewing'].includes(job.status as string)) {
    return NextResponse.json({ error: 'job_not_delivered' }, { status: 400 })
  }

  let scope: Record<string, unknown> = {}
  try { scope = JSON.parse(job.scope || '{}') } catch { scope = {} }

  let deliverables: Record<string, unknown>[] = []
  try { deliverables = JSON.parse(job.deliverables || '[]') } catch { deliverables = [] }

  return NextResponse.json({
    portfolio: {
      title: job.title,
      description: job.description,
      jobType: job.job_type,
      clientName: job.client_name || 'Anonymous Client',
      status: job.status,
      budget: job.budget,
      createdAt: new Date(job.created_at as string).toISOString(),
      scope: {
        summary: scope.summary,
        stack: scope.stack,
        estimatedHours: scope.estimatedHours,
        complexity: scope.complexity,
        deliverables: scope.deliverables,
        features: scope.features,
      },
      deliverables: deliverables.map((d) => ({
        type: d.type,
        name: d.name || d.path,
        url: d.url,
      })),
      projectId: job.project_id,
    },
  })
}

// POST — allow a client holding the valid portal token to leave a review + rating
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  const { rating, review, clientName, token } = body
  if (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5) {
    return NextResponse.json({ error: 'rating_must_be_1_to_5' }, { status: 400 })
  }
  if (typeof review !== 'string' || review.trim().length < 1 || review.length > 4000) {
    return NextResponse.json({ error: 'review_must_be_between_1_and_4000_characters' }, { status: 400 })
  }
  if (clientName !== undefined && (typeof clientName !== 'string' || clientName.length > 120)) {
    return NextResponse.json({ error: 'invalid_client_name' }, { status: 400 })
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return NextResponse.json({ error: 'valid_client_portal_token_required' }, { status: 403 })
  }

  const { data: job, error: jobErr } = await db.from('jobs')
    .select('id, status, scope, client_portal_token_hash')
    .eq('id', id)
    .maybeSingle()
  if (jobErr || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['delivered', 'reviewing'].includes(String(job.status))) {
    return NextResponse.json({ error: 'job_not_delivered' }, { status: 409 })
  }

  const expectedHash = String(job.client_portal_token_hash || '')
  const actualHash = createHash('sha256').update(token, 'utf8').digest()
  const expected = /^[a-f0-9]{64}$/i.test(expectedHash) ? Buffer.from(expectedHash, 'hex') : Buffer.alloc(0)
  if (actualHash.length !== expected.length || !timingSafeEqual(actualHash, expected)) {
    return NextResponse.json({ error: 'invalid_client_portal_token' }, { status: 403 })
  }

  const scope = job.scope && typeof job.scope === 'object'
    ? { ...(job.scope as Record<string, unknown>) }
    : (() => { try { return JSON.parse(String(job.scope || '{}')) as Record<string, unknown> } catch { return {} } })()
  scope.clientReview = {
    rating: Number(rating),
    review: review.trim(),
    clientName: typeof clientName === 'string' && clientName.trim() ? clientName.trim() : 'Anonymous',
    date: new Date().toISOString(),
  }

  const { error: updateErr } = await db.from('jobs').update({ scope }).eq('id', id)
  if (updateErr) return NextResponse.json({ error: 'review_save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, review: scope.clientReview }, { headers: { 'cache-control': 'no-store' } })
}
