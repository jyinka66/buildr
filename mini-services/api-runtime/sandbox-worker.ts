/** Executes one generated route inside a disposable, network-isolated container. */
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  routePath: string; files: Record<string, string>; method: string; url: string;
  body: string | null; headers: [string, string][]
}
const files = new Map(Object.entries(input.files || {}))
const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun', tsconfig: { compilerOptions: { jsx: 'react-jsx', strict: false, module: 'esnext', moduleResolution: 'bundler' } } })

function buildRequire(routePath: string) {
  const mocks: Record<string, any> = {
    'next/server': { NextRequest: class extends Request {}, NextResponse: class { body: any; init: any; constructor(body?: any, init: any = {}) { this.body = body; this.init = init } static json(v: any, init: any = {}) { return new this(JSON.stringify(v), { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } }) } static redirect(url: string, status = 307) { return new this(null, { status, headers: { location: url } }) } } },
    'next/headers': { cookies: () => ({ get: () => null, getAll: () => [] }), headers: () => new Headers() },
    'next/navigation': { redirect: () => { throw new Error('redirect_not_supported_in_api_runtime') }, notFound: () => { throw new Error('not_found') } },
    '@supabase/supabase-js': { createClient: () => ({ from: () => { const q: any = {}; for (const method of ['select','eq','order','limit','insert','update','delete','upsert']) q[method] = () => q; q.single = async () => ({ data: null, error: { message: 'External integrations are disabled in the sandbox' } }); q.maybeSingle = q.single; q.then = (resolve: any) => resolve({ data: [], error: { message: 'External integrations are disabled in the sandbox' } }); return q }, auth: { getUser: async () => ({ data: { user: null }, error: null }), getSession: async () => ({ data: { session: null }, error: null }) } }) },
    stripe: { default: class { checkout = { sessions: { create: async () => { throw new Error('Stripe is disabled in the sandbox') } } } } },
    resend: { Resend: class { emails = { send: async () => { throw new Error('Email is disabled in the sandbox') } } } },
    '@sendgrid/mail': { default: { setApiKey: () => {}, send: async () => { throw new Error('Email is disabled in the sandbox') } } },
    twilio: { default: class { messages = { create: async () => { throw new Error('SMS is disabled in the sandbox') } } } },
    razorpay: { default: class { orders = { create: async () => { throw new Error('Payments are disabled in the sandbox') } } } },
    bcryptjs: { compare: async () => false, hash: async () => { throw new Error('Credential operations are disabled in the sandbox') } },
    uuid: { v4: () => crypto.randomUUID() },
  }
  const cache = new Map<string, any>()
  function resolve(spec: string, from: string): string | null {
    let target: string
    if (spec.startsWith('@/')) target = 'src/' + spec.slice(2)
    else if (spec.startsWith('.')) {
      const base = from.slice(0, from.lastIndexOf('/'))
      const stack: string[] = []
      for (const part of `${base}/${spec}`.split('/')) { if (!part || part === '.') continue; if (part === '..') stack.pop(); else stack.push(part) }
      target = stack.join('/')
    } else return null
    return [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}/index.ts`, `${target}/index.tsx`].find(p => files.has(p)) || null
  }
  function localRequire(spec: string, from = routePath): any {
    if (Object.prototype.hasOwnProperty.call(mocks, spec)) return mocks[spec]
    if (/\.(css|scss|svg|png|jpe?g|gif|webp|woff2?)$/i.test(spec)) return {}
    const path = resolve(spec, from)
    if (path) {
      if (cache.has(path)) return cache.get(path)
      const mod = { exports: {} as any }; cache.set(path, mod.exports)
      const js = transpiler.transformSync(files.get(path)!)
      new Function('module', 'exports', 'require', js)(mod, mod.exports, (s: string) => localRequire(s, path))
      cache.set(path, mod.exports); return mod.exports
    }
    // Deny unknown external modules rather than resolving host packages.
    throw new Error(`Module is not permitted in sandbox: ${spec}`)
  }
  return localRequire
}

try {
  if (!input.routePath || !files.has(input.routePath)) throw new Error('route_not_found')
  const js = transpiler.transformSync(files.get(input.routePath)!)
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, buildRequire(input.routePath))
  const handler = mod.exports[input.method.toUpperCase()]
  if (typeof handler !== 'function') {
    process.stdout.write(JSON.stringify({ status: 405, body: JSON.stringify({ error: 'method_not_allowed' }), headers: { allow: 'GET, POST, PUT, DELETE, PATCH' } }))
  } else {
    const req = new Request(input.url, { method: input.method.toUpperCase(), headers: input.headers, body: input.body || undefined })
    const result = await handler(req)
    if (result instanceof Response) {
      const headers: Record<string, string> = {}; result.headers.forEach((v, k) => { headers[k] = v })
      process.stdout.write(JSON.stringify({ status: result.status, body: await result.text(), headers }))
    } else if (result && typeof result === 'object' && 'body' in result) {
      const r = result as any; process.stdout.write(JSON.stringify({ status: r.init?.status || 200, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body), headers: r.init?.headers || { 'content-type': 'application/json' } }))
    } else process.stdout.write(JSON.stringify({ status: 200, body: JSON.stringify(result), headers: { 'content-type': 'application/json' } }))
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 500, body: JSON.stringify({ error: 'route_execution_error', message: error instanceof Error ? error.message : 'unknown_error' }), headers: { 'content-type': 'application/json' } }))
}
