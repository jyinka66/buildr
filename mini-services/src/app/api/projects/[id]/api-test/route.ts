// POST /api/projects/[id]/api-test — sends a custom HTTP request to a
// generated route via the API runtime sidecar (port 3030). Returns the
// response status, headers, body, and timing.
//
// This is the "Postman built into Buildr" — users can test their generated
// API routes with any method, path, headers, and body without leaving the IDE.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface TestBody {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}

export async function POST(
  req: NextRequest,
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

  const body = await req.json().catch(() => null) as TestBody | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  if (body.method !== undefined && typeof body.method !== 'string') {
    return NextResponse.json({ error: 'invalid_method' }, { status: 400 })
  }
  if (body.path !== undefined && typeof body.path !== 'string') {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 })
  }
  const method = (body.method || 'GET').toUpperCase()
  const path = body.path || '/'
  const headers = body.headers || {}
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return NextResponse.json({ error: 'unsupported_method' }, { status: 400 })
  }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 50 || Object.entries(headers).some(([key, value]) => typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n]/.test(value))) {
    return NextResponse.json({ error: 'invalid_headers' }, { status: 400 })
  }
  if (typeof body.body === 'string' && Buffer.byteLength(body.body, 'utf8') > 1_048_576) {
    return NextResponse.json({ error: 'request_body_too_large' }, { status: 413 })
  }
  const requestBody = body.body || undefined

  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path) || path.includes('#')) {
    return NextResponse.json({ error: 'path must start with /' }, { status: 400 })
  }

  // Send the request to the sidecar. The gateway forwards ?XTransformPort=3030
  // to port 3030 where the generated route handler executes.
  const sidecarBase = new URL((process.env.SIDECAR_URL || 'http://localhost:3030').replace(/\/$/, ''))
  const sidecarTarget = new URL(path, sidecarBase)
  if (sidecarTarget.origin !== sidecarBase.origin) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 })
  }
  sidecarTarget.searchParams.set('XTransformPort', '3030')
  sidecarTarget.searchParams.set('pid', id)
  const sidecarUrl = sidecarTarget.toString()
  const sidecarToken = process.env.SIDECAR_AUTH_TOKEN || ''
  if (process.env.NODE_ENV === 'production' && sidecarToken.length < 32) {
    return NextResponse.json({ error: 'api_runtime_not_configured' }, { status: 503 })
  }
  const startTime = Date.now()

  try {
    const sidecarRes = await fetch(sidecarUrl, {
      method,
      headers: {
        'content-type': headers['content-type'] || 'application/json',
        ...headers,
        ...(sidecarToken ? { 'x-buildr-auth': sidecarToken } : {}),
      },
      body: ['GET', 'HEAD'].includes(method) ? undefined : requestBody,
      signal: AbortSignal.timeout(15000),
    })

    const durationMs = Date.now() - startTime
    const responseText = await sidecarRes.text()
    let responseBody: unknown = responseText
    try {
      responseBody = JSON.parse(responseText)
    } catch {
      /* keep as text */
    }

    // Collect response headers.
    const responseHeaders: Record<string, string> = {}
    sidecarRes.headers.forEach((v, k) => { responseHeaders[k] = v })

    // Record performance data.
    await db.from('audit_log').insert({
      user_id: user.id,
      project_id: id,
      action: 'api_test',
      details: JSON.stringify({ method, path, status: sidecarRes.status, durationMs }),
    })

    return NextResponse.json({
      ok: sidecarRes.ok,
      status: sidecarRes.status,
      statusText: sidecarRes.statusText,
      headers: responseHeaders,
      body: responseBody,
      durationMs,
      request: { method, path, headers, body: requestBody },
    })
  } catch (err) {
    const durationMs = Date.now() - startTime
    const msg = err instanceof Error ? err.message : 'sidecar_unreachable'
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        durationMs,
        hint: 'Make sure the API runtime sidecar is running (port 3030) and the route exists.',
      },
      { status: 502 },
    )
  }
}
