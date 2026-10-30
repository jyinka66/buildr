// Supabase server-side client (service role — bypasses RLS).
// Used by all API routes via `import { db } from '@/lib/db'`.
//
// Requires these env vars in .env:
//   SUPABASE_URL=https://your-project.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...
//
// When not configured, the db proxy returns mock responses ({ data: null, error: { message } })
// instead of throwing — so API routes gracefully return errors instead of crashing 500.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function isPlaceholder(url: string, key: string): boolean {
  return (
    !url || !key ||
    url === 'https://your-project.supabase.co' ||
    key === 'your-service-role-key-here'
  )
}

export const isSupabaseConfigured = !isPlaceholder(supabaseUrl, supabaseServiceKey)

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client
  if (!isSupabaseConfigured) {
    throw new SupabaseNotConfiguredError()
  }
  _client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _client
}

export class SupabaseNotConfiguredError extends Error {
  status = 503
  constructor() {
    super(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. ' +
        'Create a free project at https://supabase.com, then run the SQL in supabase/schema.sql.',
    )
    this.name = 'SupabaseNotConfiguredError'
  }
}

// Mock error response for when Supabase isn't configured.
// Returns { data: null, error: { message, code } } — the same shape as a failed Supabase query.
function mockErrorResponse() {
  return Promise.resolve({
    data: null,
    error: { message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.', code: 'NOT_CONFIGURED' },
    count: null,
    status: 503,
    statusText: 'Service Unavailable',
  })
}

// Build a chainable mock that always returns { data: null, error } for any query.
function createMockChain(): unknown {
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(_target, prop) {
      // Terminal methods that resolve the query.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        // Make it thenable — resolves to { data: null, error }.
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'Supabase not configured', code: 'NOT_CONFIGURED' }, count: null })
        }
        if (prop === 'catch') return (_fn: unknown) => createMockChain()
        if (prop === 'finally') return (_fn: unknown) => createMockChain()
        return undefined
      }
      // Any method call returns another mock chain (so .select().eq().order() etc. all chain).
      return () => createMockChain()
    },
  }
  return new Proxy({}, handler)
}

// Convenient alias — code throughout the app imports `db` to access data.
// When configured: real Supabase client.
// When NOT configured: delegates to the local in-memory store (localDb)
//   so the entire app works without a database for local dev / demos.
import { localDb } from '@/lib/local-store'

export const db = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!isSupabaseConfigured) {
      // Local storage is a development/demo fallback only. Never let a
      // production deployment silently accept writes into process memory.
      if (process.env.NODE_ENV === 'production') {
        throw new SupabaseNotConfiguredError()
      }
      const localVal = (localDb as unknown as Record<string | symbol, unknown>)[prop]
      return localVal
    }
    const client = getSupabase()
    const val = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof val === 'function' ? val.bind(client) : val
  },
})

export async function checkSupabase(): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error:
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, then run supabase/schema.sql.',
    }
  }
  try {
    const client = getSupabase()
    const { error } = await client.from('users').select('id').limit(1)
    if (error) {
      return {
        ok: false,
        error: `Supabase query failed: ${error.message}. Run the schema SQL in supabase/schema.sql against your project.`,
      }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'supabase_unreachable'
    return { ok: false, error: message }
  }
}
