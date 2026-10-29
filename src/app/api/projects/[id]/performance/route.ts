// GET /api/projects/[id]/performance — aggregates API response time data
// from the audit_log (action='api_test') for this project. Returns average
// response time, p50/p95, error rate, and a timeline.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch API test entries from audit_log.
  const { data: logs, error } = await db
    .from('audit_log')
    .select('details, created_at')
    .eq('project_id', id)
    .eq('action', 'api_test')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const entries: { method: string; path: string; status: number; durationMs: number; time: string }[] = []
  for (const log of logs ?? []) {
    try {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details
      entries.push({
        method: details.method || 'GET',
        path: details.path || '/',
        status: details.status || 0,
        durationMs: details.durationMs || 0,
        time: new Date(log.created_at as string).toISOString(),
      })
    } catch { /* skip */ }
  }

  if (entries.length === 0) {
    return NextResponse.json({
      summary: { totalRequests: 0, avgResponseMs: 0, p50: 0, p95: 0, errorRate: 0 },
      byEndpoint: [],
      timeline: [],
    })
  }

  // Compute summary stats.
  const durations = entries.map(e => e.durationMs).sort((a, b) => a - b)
  const errors = entries.filter(e => e.status >= 400).length
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0

  // By endpoint.
  const endpointMap = new Map<string, { count: number; totalMs: number; errors: number; maxMs: number; minMs: number }>()
  for (const e of entries) {
    const key = `${e.method} ${e.path}`
    const entry = endpointMap.get(key) || { count: 0, totalMs: 0, errors: 0, maxMs: 0, minMs: Infinity }
    entry.count++
    entry.totalMs += e.durationMs
    entry.maxMs = Math.max(entry.maxMs, e.durationMs)
    entry.minMs = Math.min(entry.minMs, e.durationMs)
    if (e.status >= 400) entry.errors++
    endpointMap.set(key, entry)
  }
  const byEndpoint = Array.from(endpointMap.entries()).map(([endpoint, v]) => ({
    endpoint,
    count: v.count,
    avgMs: Math.round(v.totalMs / v.count),
    minMs: v.minMs,
    maxMs: v.maxMs,
    errorRate: v.errors / v.count,
  }))

  // Timeline (last 20 requests).
  const timeline = entries.slice(0, 20).reverse().map(e => ({
    time: e.time,
    endpoint: `${e.method} ${e.path}`,
    status: e.status,
    durationMs: e.durationMs,
  }))

  return NextResponse.json({
    summary: {
      totalRequests: entries.length,
      avgResponseMs: Math.round(avg),
      p50,
      p95,
      errorRate: errors / entries.length,
    },
    byEndpoint,
    timeline,
  })
}
