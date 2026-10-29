// Buildr API Runtime — local Node/Bun sidecar (port 3030)
// ------------------------------------------------------------------
// Executes generated Next.js API route handlers so the preview iframe's
// fetch('/api/...') calls actually get real responses. The preview
// iframe proxies requests with ?XTransformPort=3030&pid=<projectId>
// which the gateway forwards here.
//
// For each request:
//   1. Read `pid` from the query string (the project ID).
//   2. Fetch the project's route.ts files from Supabase (cached).
//   3. Match the request path to a route handler (Next.js App Router
//      convention: src/app/api/<path>/route.ts with GET/POST/PUT/
//      DELETE/PATCH exports).
//   4. Transpile the route.ts (TS→JS, strip types) with Bun's built-in
//      transpiler.
//   5. Execute the handler with a Request object, capture the Response.
//   6. Return the response body + status + headers.
//
// Module-level mocks are provided for common server imports (NextRequest,
// NextResponse, @supabase/supabase-js, stripe, resend, etc.) so generated
// integration code runs without real credentials.

import { createClient } from '@supabase/supabase-js'

const PORT = 3030

// ---- Supabase client (reads from env) ------------------------------------
// SECURITY: use the ANON key (public, RLS-scoped) — never the service
// role key. The service role bypasses RLS and would give any executed
// route handler full DB access. If only the service role is available,
// the sidecar runs without DB access (routes return 404).
const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_ANON_KEY || ''

const supabase =
  supabaseUrl && supabaseKey && supabaseUrl !== 'https://your-project.supabase.co'
    ? createClient(supabaseUrl, supabaseKey)
    : null

// ---- File cache: projectId → { path → content } + timestamp --------------
interface CacheEntry {
  files: Map<string, string>
  fetchedAt: number
}
const fileCache = new Map<string, CacheEntry>()
const CACHE_TTL = 10_000 // 10 seconds — short so regenerated code shows up fast

async function fetchProjectFiles(projectId: string): Promise<Map<string, string>> {
  const cached = fileCache.get(projectId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.files
  }
  if (!supabase) {
    return new Map()
  }
  const { data, error } = await supabase
    .from('project_files')
    .select('path, content')
    .eq('project_id', projectId)
  if (error || !data) return new Map()
  const files = new Map<string, string>()
  for (const f of data) {
    files.set(f.path, f.content)
  }
  fileCache.set(projectId, { files, fetchedAt: Date.now() })
  return files
}

// Invalidate cache when notified (the Next.js app calls /__invalidate after
// a generation).
function invalidateCache(projectId: string): void {
  fileCache.delete(projectId)
}

// ---- Route matching (Next.js App Router convention) ---------------------
function findRouteFile(
  requestPath: string,
  files: Map<string, string>,
): string | null {
  // Normalize: /api/checkout → src/app/api/checkout/route.ts
  const clean = requestPath.replace(/^\/+/, '')
  const candidates = [
    `src/app/${clean}/route.ts`,
    `src/app/${clean}/route.tsx`,
    `src/pages/api/${clean}.ts`,
    `src/pages/api/${clean}.tsx`,
  ]
  for (const c of candidates) {
    if (files.has(c)) return c
  }
  // Dynamic segments: [id] — match /api/users/abc to src/app/api/users/[id]/route.ts
  const parts = clean.split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    const dynParts = [...parts.slice(0, i), '[id]']
    const dynPath = `src/app/${dynParts.join('/')}/route.ts`
    if (files.has(dynPath)) return dynPath
  }
  return null
}

// ---- Transpile + execute a route handler --------------------------------
const transpiler = new Bun.Transpiler({
  loader: 'ts',
  target: 'bun',
  tsconfig: {
    compilerOptions: {
      jsx: 'react-jsx',
      strict: false,
      module: 'esnext',
      moduleResolution: 'bundler',
    },
  },
})

// Mock module registry — provides stubs for imports the generated code uses.
function buildRequireShim(projectId: string, routePath: string) {
  const mocks: Record<string, unknown> = {
    'next/server': {
      NextRequest: class NextRequest extends Request {},
      NextResponse: class NextResponse {
        body: unknown
        init: { status?: number; headers?: Record<string, string> }
        constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
          this.body = body
          this.init = init || {}
        }
        static json(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
          return new NextResponse(JSON.stringify(data), {
            ...init,
            headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
          })
        }
        static redirect(url: string, status = 307) {
          return new NextResponse(null, { status, headers: { location: url } })
        }
      },
    },
    'next/headers': {
      cookies: () => ({ get: () => null, getAll: () => [] }),
      headers: () => new Map(),
    },
    'next/navigation': {
      redirect: () => {},
      notFound: () => {},
    },
    '@supabase/supabase-js': {
      createClient: () => ({
        from: () => ({
          select: function () {
            return this
          },
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'mock' }, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => this }) }),
          delete: () => ({ eq: () => this }),
          eq: function () {
            return this
          },
          order: function () {
            return this
          },
          limit: function () {
            return this
          },
          single: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        }),
        auth: {
          getUser: () => Promise.resolve({ data: { user: null }, error: null }),
          getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        },
      }),
    },
    stripe: { default: function () { return { checkout: { sessions: { create: () => Promise.resolve({ url: 'https://mock-stripe.example/checkout' }) } } } } },
    resend: { Resend: class { emails = { send: () => Promise.resolve({ id: 'mock' }) } } },
    '@sendgrid/mail': { default: { setApiKey: () => {}, send: () => Promise.resolve([{}]) } },
    twilio: { default: function () { return { messages: { create: () => Promise.resolve({ sid: 'mock' }) } } } },
    razorpay: { default: function () { return { orders: { create: () => Promise.resolve({ id: 'mock' }) } } } },
    bcryptjs: { compare: () => Promise.resolve(true), hash: (v: string) => Promise.resolve('hashed:' + v) },
    uuid: { v4: () => 'mock-uuid-' + Math.random().toString(36).slice(2) },
    zod: { z: new Proxy({}, { get: () => () => ({ parse: (v: unknown) => v, safeParse: (v: unknown) => ({ success: true, data: v }) }) }) },
  }

  // Local file resolver — for @/ and relative imports, fetch from the
  // project's file cache and transpile+eval recursively.
  function resolveLocal(spec: string): string | null {
    let target = spec
    if (target.startsWith('@/')) {
      target = 'src/' + target.slice(2)
    } else if (target.startsWith('.')) {
      const dir = routePath.includes('/') ? routePath.slice(0, routePath.lastIndexOf('/')) : ''
      const parts = (dir + '/' + spec).split('/')
      const out: string[] = []
      for (const p of parts) {
        if (p === '.' || p === '') continue
        if (p === '..') { out.pop(); continue }
        out.push(p)
      }
      target = out.join('/')
    } else {
      return null
    }
    const candidates = [target, target + '.ts', target + '.tsx', target + '.js', target + '/index.ts']
    return candidates[0] // caller checks existence
  }

  const moduleCache = new Map<string, unknown>()

  function localRequire(spec: string): unknown {
    if (mocks[spec]) return mocks[spec]

    // CSS / assets → empty object
    if (/\.(css|scss|svg|png|jpe?g|gif|webp|woff2?)$/i.test(spec)) return {}

    // Local file?
    if (spec.startsWith('@/') || spec.startsWith('.')) {
      const resolved = resolveLocal(spec)
      if (resolved) {
        const candidates = [resolved, resolved + '.ts', resolved + '.tsx', resolved + '.js', resolved + '/index.ts']
        const files = fileCache.get(projectId)?.files
        let foundPath: string | null = null
        for (const c of candidates) {
          if (files?.has(c)) { foundPath = c; break }
        }
        if (foundPath && files) {
          if (moduleCache.has(foundPath)) return moduleCache.get(foundPath)
          const src = files.get(foundPath)!
          const js = transpiler.transformSync(src)
          const mod = { exports: {} as Record<string, unknown> }
          const factory = new Function('module', 'exports', 'require', js)
          factory(mod, mod.exports, localRequire)
          moduleCache.set(foundPath, mod.exports)
          return mod.exports
        }
      }
    }

    // Unknown → empty proxy so destructured imports don't crash
    return new Proxy({}, { get: () => () => null })
  }

  return localRequire
}

async function executeRoute(
  filePath: string,
  files: Map<string, string>,
  projectId: string,
  method: string,
  url: URL,
  body: string | null,
  headers: Headers,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const src = files.get(filePath)
  if (!src) return { status: 404, body: JSON.stringify({ error: 'route_not_found' }), headers: {} }

  const localRequire = buildRequireShim(projectId, filePath)
  const js = transpiler.transformSync(src)
  const mod = { exports: {} as Record<string, unknown> }
  const factory = new Function('module', 'exports', 'require', js)
  factory(mod, mod.exports, localRequire)

  const handler = mod.exports[method.toUpperCase()] as
    | ((req: Request) => Promise<Response>)
    | undefined
  if (typeof handler !== 'function') {
    return {
      status: 405,
      body: JSON.stringify({ error: `method_${method.toLowerCase()}_not_allowed` }),
      headers: { allow: 'GET, POST, PUT, DELETE, PATCH' },
    }
  }

  // Build a Request object for the handler.
  const req = new Request(url, {
    method: method.toUpperCase(),
    headers,
    body: body || undefined,
  })

  try {
    // SECURITY: execution timeout (10s) to prevent infinite loops from
    // killing the sidecar. The promise rejects on timeout.
    const result = await Promise.race([
      handler(req),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('execution_timeout')), 10_000),
      ),
    ])
    // NextResponse or Response
    if (result instanceof Response) {
      const text = await result.text()
      const respHeaders: Record<string, string> = {}
      result.headers.forEach((v, k) => { respHeaders[k] = v })
      return { status: result.status, body: text, headers: respHeaders }
    }
    // Some handlers return a plain object (NextResponse.json static)
    if (result && typeof result === 'object' && 'body' in result) {
      const r = result as { body: unknown; init: { status?: number; headers?: Record<string, string> } }
      const bodyStr = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
      return {
        status: r.init?.status || 200,
        body: bodyStr,
        headers: r.init?.headers || { 'content-type': 'application/json' },
      }
    }
    return {
      status: 200,
      body: JSON.stringify(result),
      headers: { 'content-type': 'application/json' },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg === 'execution_timeout'
    return {
      status: isTimeout ? 504 : 500,
      body: JSON.stringify({
        error: isTimeout ? 'execution_timeout' : 'route_execution_error',
        message: isTimeout ? 'Route handler did not complete within 10 seconds.' : msg,
      }),
      headers: { 'content-type': 'application/json' },
    }
  }
}

// ---- Auth helper ---------------------------------------------------------
// The sidecar is called by the gateway (XTransformPort=3030). Auth is
// verified via a shared secret (SIDECAR_AUTH_TOKEN). In production, the
// token MUST be set — the sidecar refuses to start otherwise. In dev,
// the token is optional (open mode) for local testing.
const SIDECAR_AUTH_TOKEN = process.env.SIDECAR_AUTH_TOKEN || ''
const isProduction = process.env.NODE_ENV === 'production'

// SECURITY: refuse to run in production without an auth token.
if (isProduction && SIDECAR_AUTH_TOKEN.length < 32) {
  console.error('[Buildr API Runtime] FATAL: SIDECAR_AUTH_TOKEN must be at least 32 characters in production.')
  console.error('Set it in your environment before starting the sidecar.')
  process.exit(1)
}

function checkAuth(req: Request): boolean {
  if (!SIDECAR_AUTH_TOKEN) return true // dev mode (token not set)
  const authHeader = req.headers.get('x-buildr-auth') || ''
  // Constant-time comparison to prevent timing attacks.
  if (authHeader.length !== SIDECAR_AUTH_TOKEN.length) return false
  let diff = 0
  for (let i = 0; i < authHeader.length; i++) {
    diff |= authHeader.charCodeAt(i) ^ SIDECAR_AUTH_TOKEN.charCodeAt(i)
  }
  return diff === 0
}

// ---- HTTP server ---------------------------------------------------------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Health check (no auth required)
    if (url.pathname === '/__health') {
      return Response.json({ ok: true, port: PORT, supabase: !!supabase }, { headers: { 'cache-control': 'no-store' } })
    }

    // Auth check for all other endpoints.
    if (!checkAuth(req)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }

    // Cache invalidation (called by the Next.js app after a generation)
    if (url.pathname === '/__invalidate') {
      const pid = url.searchParams.get('pid')
      if (pid) invalidateCache(pid)
      return Response.json({ ok: true })
    }

    const projectId = url.searchParams.get('pid')
    if (!projectId) {
      return Response.json(
        { error: 'missing_pid', message: 'The pid query parameter (project ID) is required.' },
        { status: 400 },
      )
    }

    // In production, all untrusted generated code must execute in a disposable,
    // network-isolated container. Never fall back to in-process evaluation.
    if (isProduction && (!process.env.SANDBOX_RUNNER_URL || (process.env.SANDBOX_RUNNER_TOKEN || '').length < 32)) {
      return Response.json({ error: 'sandbox_not_configured' }, { status: 503, headers: { 'cache-control': 'no-store' } })
    }


    // SECURITY: verify the project exists and is in a preview-ready or
    // deployed state before executing any route handlers. This prevents
    // the sidecar from executing code for draft/error projects, and
    // ensures only vetted code runs here.
    if (supabase) {
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .select('status')
        .eq('id', projectId)
        .maybeSingle()
      if (projErr || !project) {
        return Response.json(
          { error: 'project_not_found', message: 'The project does not exist.' },
          { status: 404 },
        )
      }
      const allowedStatuses = ['preview-ready', 'deployed']
      if (!allowedStatuses.includes(project.status)) {
        return Response.json(
          { error: 'project_not_ready', message: `Project status is "${project.status}". Only preview-ready or deployed projects can execute routes.` },
          { status: 403 },
        )
      }
    }

    // Fetch project files (cached)
    const files = await fetchProjectFiles(projectId)
    if (files.size === 0) {
      return Response.json(
        { error: 'no_files', message: 'No files found for this project. Generate code first.' },
        { status: 404 },
      )
    }

    // Match route
    const routePath = findRouteFile(url.pathname, files)
    if (!routePath) {
      return Response.json(
        {
          error: 'route_not_found',
          path: url.pathname,
          message: `No route handler found for ${url.pathname}. Create src/app${url.pathname}/route.ts.`,
        },
        { status: 404 },
      )
    }

    // Bound request bodies before buffering them in memory.
    let body: string | null = null
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const contentLength = Number(req.headers.get('content-length') || 0)
      if (contentLength > 1_048_576) {
        return Response.json({ error: 'request_body_too_large' }, { status: 413 })
      }
      body = await req.text()
      if (new TextEncoder().encode(body).byteLength > 1_048_576) {
        return Response.json({ error: 'request_body_too_large' }, { status: 413 })
      }
    }

    let result: { status: number; body: string; headers: Record<string, string> }
    if (isProduction) {
      const runnerUrl = process.env.SANDBOX_RUNNER_URL!.replace(/\/$/, '')
      const payload = JSON.stringify({
        routePath,
        files: Object.fromEntries(files),
        method: req.method,
        url: url.toString(),
        body,
        headers: Array.from(req.headers.entries()).filter(([k]) => !['x-buildr-auth', 'host', 'connection', 'content-length'].includes(k.toLowerCase())),
      })
      if (new TextEncoder().encode(payload).byteLength > 5 * 1024 * 1024) {
        return Response.json({ error: 'project_code_too_large_for_sandbox' }, { status: 413 })
      }
      let sandboxResponse: Response
      try {
        sandboxResponse = await fetch(`${runnerUrl}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-buildr-sandbox-token': process.env.SANDBOX_RUNNER_TOKEN! },
          body: payload,
          signal: AbortSignal.timeout(15_000),
        })
      } catch {
        return Response.json({ error: 'sandbox_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
      }
      const sandboxResult = await sandboxResponse.json().catch(() => null) as any
      if (!sandboxResponse.ok || !sandboxResult || !Number.isInteger(sandboxResult.status) || typeof sandboxResult.body !== 'string') {
        return Response.json({ error: sandboxResult?.error || 'sandbox_execution_failed' }, { status: sandboxResponse.status || 502, headers: { 'cache-control': 'no-store' } })
      }
      result = { status: sandboxResult.status, body: sandboxResult.body, headers: sandboxResult.headers || { 'content-type': 'application/json' } }
    } else {
      result = await executeRoute(routePath, files, projectId, req.method, url, body, req.headers)
    }

    return new Response(result.body, { status: result.status, headers: result.headers })
  },
})

console.log(`Buildr API Runtime running on http://localhost:${PORT}`)
console.log(`  Supabase: ${supabase ? 'connected' : 'NOT configured (preview API routes will return 404)'}`)

export { server }
