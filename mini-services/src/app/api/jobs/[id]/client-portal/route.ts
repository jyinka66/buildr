// GET /api/jobs/[id]/client-portal — public client portal (no auth, uses a share token).
// Shows the job scope, task progress, deliverables, and allows file download.
//
// Query: ?token=<shareToken> — only the SHA-256 hash is stored on the job row.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function safeTokenEqual(provided: string, expectedHash: string | null | undefined): boolean {
  if (!expectedHash || !/^[A-Za-z0-9_-]{43}$/.test(provided) || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false
  const actual = Buffer.from(tokenHash(provided), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Authenticated owners mint a high-entropy share token. Only its SHA-256 hash
// is persisted; generating a new link revokes the previous link.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
  const { id } = await ctx.params
  const rl = rateLimit(`client-portal-create:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: job, error } = await db.from('jobs').select('id, owner_id').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const token = randomBytes(32).toString('base64url')
  const { error: updateError } = await db.from('jobs').update({ client_portal_token_hash: tokenHash(token) }).eq('id', id).eq('owner_id', user.id)
  if (updateError) return NextResponse.json({ error: 'portal_token_persist_failed' }, { status: 500 })

  return NextResponse.json({ ok: true, token }, { headers: { 'cache-control': 'no-store' } })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 400 })

  // Fetch the job (no auth — client portal is public with token)
  const { data: job, error } = await db.from('jobs').select('id, title, description, job_type, status, client_name, budget, created_at, scope, tasks, deliverables, project_id, client_portal_token_hash').eq('id', id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (!safeTokenEqual(token, job.client_portal_token_hash as string | null)) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 403 })
  }

  const parseJson = <T,>(value: unknown, fallback: T): T => {
    if (value == null) return fallback
    if (typeof value !== 'string') return value as T
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  const deliverables = parseJson<Record<string, unknown>[]>(job.deliverables, [])
  const scope = parseJson<Record<string, unknown>>(job.scope, {})
  const tasks = parseJson<Record<string, unknown>[]>(job.tasks, [])

  return NextResponse.json({
    job: {
      title: job.title,
      description: job.description,
      jobType: job.job_type,
      status: job.status,
      clientName: job.client_name,
      budget: job.budget,
      createdAt: new Date(job.created_at as string).toISOString(),
    },
    scope: {
      summary: scope.summary,
      stack: scope.stack,
      estimatedHours: scope.estimatedHours,
      complexity: scope.complexity,
      deliverables: scope.deliverables,
      features: scope.features,
      pages: scope.pages,
      integrations: scope.integrations,
    },
    tasks: tasks.map((t) => ({
      id: t.id, name: t.name, description: t.description,
      tool: t.tool, estimatedMinutes: t.estimatedMinutes, status: t.status || 'pending',
    })),
    deliverables: deliverables,
    projectId: job.project_id,
  }, { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}
