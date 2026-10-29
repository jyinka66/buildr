// /api/operations/monitoring — 24/7 Operations: monitoring.
// ------------------------------------------------------------------
//   GET  — list recent MonitoringEvents + a per-project health summary
//   POST — probe a project's deployment URL (real HTTP fetch, 10s timeout),
//          persist a MonitoringEvent, and return the result
//
// All handlers are session-gated via requireSessionUser().

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { safeFetch } from '@/lib/ssrf'

const PROBE_TIMEOUT_MS = 10_000

function classify(status: number | null, ok: boolean, timedOut: boolean): 'ok' | 'degraded' | 'down' {
  if (timedOut || !ok) return 'down'
  if (status === null) return 'down'
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 500) return 'degraded'
  return 'down'
}

interface EventRow {
  id: string
  project_id: string | null
  kind: string
  status: string
  message: string
  response_ms: number | null
  status_code: number | null
  url: string | null
  checked_at: string
}

interface ProjectRow {
  id: string
  name: string
  slug: string
  status: string
  deployment_url: string | null
  preview_url: string | null
  updated_at: string
}

function serializeEvent(row: EventRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    status: row.status,
    message: row.message,
    responseMs: row.response_ms,
    statusCode: row.status_code,
    url: row.url,
    checkedAt: row.checked_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list events + per-project health.
// ---------------------------------------------------------------------------

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

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') || undefined
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  let eventsQuery: any = db.from('monitoring_events').select('*').eq('owner_id', user.id)
  if (projectId) eventsQuery = eventsQuery.eq('project_id', projectId)

  const [eventsRes, projectsRes] = await Promise.all([
    eventsQuery.order('checked_at', { ascending: false }).limit(limit),
    db.from('projects')
      .select('id, name, slug, status, deployment_url, preview_url, updated_at')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false }),
  ])

  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })
  }

  const events = (eventsRes.data as EventRow[] | null) ?? []
  const projects = (projectsRes.data as ProjectRow[] | null) ?? []

  // Per-project health: derive from the most recent event of kind 'ping' or 'cron'.
  const latestByProject = new Map<string, EventRow>()
  for (const ev of events) {
    if (!ev.project_id) continue
    if (!latestByProject.has(ev.project_id)) {
      latestByProject.set(ev.project_id, ev)
    }
  }

  const health = projects.map((p) => {
    const latest = latestByProject.get(p.id)
    const url = p.deployment_url || p.preview_url || null
    let state: 'unknown' | 'ok' | 'degraded' | 'down' = 'unknown'
    if (latest) {
      if (latest.status === 'ok') state = 'ok'
      else if (latest.status === 'degraded') state = 'degraded'
      else if (latest.status === 'down') state = 'down'
      else state = 'unknown'
    }
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      projectStatus: p.status,
      url,
      health: state,
      lastCheckedAt: latest?.checked_at ?? null,
      lastStatusCode: latest?.status_code ?? null,
      lastResponseMs: latest?.response_ms ?? null,
      lastMessage: latest?.message ?? '',
      updatedAt: p.updated_at,
    }
  })

  return NextResponse.json({
    events: events.map(serializeEvent),
    health,
  })
}

// ---------------------------------------------------------------------------
// POST — probe a project's deployment URL.
// ---------------------------------------------------------------------------

interface ProbeBody {
  projectId?: string
  url?: string
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

  const body = (await req.json().catch(() => ({}))) as ProbeBody

  // Resolve target URL: explicit body.url, otherwise project's deployment URL.
  let url: string | null = body.url?.trim() || null
  let projectId: string | null = null
  if (!url && body.projectId) {
    const { data: project } = await db
      .from('projects')
      .select('id, deployment_url, preview_url')
      .eq('id', body.projectId)
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    }
    projectId = project.id
    url = project.deployment_url || project.preview_url || null
  } else if (body.projectId) {
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', body.projectId)
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    }
    projectId = project.id
  }

  if (!url) {
    return NextResponse.json(
      { error: 'No URL to probe. Provide a url or a projectId with a deployment URL.' },
      { status: 400 },
    )
  }

  // Strip non-http(s) schemes for safety.
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: 'URL must start with http:// or https://' },
      { status: 400 },
    )
  }


  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  const startedAt = Date.now()
  let statusCode: number | null = null
  let ok = false
  let timedOut = false
  let errorMsg: string | null = null

  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'user-agent': 'Buildr-Monitor/1.0' },
      cache: 'no-store',
    }, { timeoutMs: PROBE_TIMEOUT_MS, maxRedirects: 3 })
    statusCode = res.status
    ok = res.ok
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      timedOut = true
      errorMsg = `timeout after ${PROBE_TIMEOUT_MS}ms`
    } else {
      errorMsg = err instanceof Error ? err.message : 'fetch_failed'
    }
  } finally {
    clearTimeout(timeout)
  }

  const responseMs = Date.now() - startedAt
  const status = classify(statusCode, ok, timedOut)

  // Persist the monitoring event.
  const { data: event, error: eventError } = await db
    .from('monitoring_events')
    .insert({
      owner_id: user.id,
      project_id: projectId,
      kind: 'ping',
      status,
      message: timedOut
        ? `Probe timed out after ${PROBE_TIMEOUT_MS}ms.`
        : ok
          ? `Probe succeeded — HTTP ${statusCode} in ${responseMs}ms.`
          : `Probe failed — ${errorMsg || `HTTP ${statusCode ?? 'unknown'}`}`,
      url,
      response_ms: responseMs,
      status_code: statusCode,
      metadata: JSON.stringify({
        ok,
        timedOut,
        error: errorMsg,
      }),
    })
    .select('*')
    .single()

  if (eventError || !event) {
    return NextResponse.json({ error: eventError?.message || 'event_create_failed' }, { status: 500 })
  }

  // If degraded/down and a project is linked, emit a notification.
  if (status !== 'ok' && projectId) {
    try {
      await db.from('notifications').insert({
        owner_id: user.id,
        source: 'monitoring',
        severity: status === 'down' ? 'error' : 'warning',
        title: `Project health ${status}`,
        message: `${url} responded ${statusCode ?? 'no response'} in ${responseMs}ms.`,
        link_type: 'project',
        link_id: projectId,
        metadata: JSON.stringify({ url, statusCode, responseMs, status }),
      })
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({
    ok: status === 'ok',
    status,
    url,
    statusCode,
    responseMs,
    timedOut,
    event: serializeEvent(event as EventRow),
  })
}
