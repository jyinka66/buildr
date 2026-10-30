import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase-server'

// Local in-memory token bucket for low-risk/dev paths. Security-sensitive
// routes should use distributedRateLimit(), backed by atomic Postgres counters.

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()
const CLEANUP_INTERVAL = 60_000 // prune idle buckets every minute

// Prune stale entries to avoid unbounded memory growth.
let lastCleanup = Date.now()
function maybeCleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > CLEANUP_INTERVAL) buckets.delete(k)
  }
}

export interface RateLimitOptions {
  /** Maximum tokens (requests) allowed in the window. */
  limit: number
  /** Refill window in ms. */
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetMs: number
}

/** Check + consume 1 token for the given key. Returns ok=false if exceeded. */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  maybeCleanup()
  const now = Date.now()
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: opts.limit, lastRefill: now }
    buckets.set(key, b)
  }
  // Refill proportionally to elapsed time.
  const elapsed = now - b.lastRefill
  const refill = (elapsed / opts.windowMs) * opts.limit
  b.tokens = Math.min(opts.limit, b.tokens + refill)
  b.lastRefill = now

  if (b.tokens >= 1) {
    b.tokens -= 1
    return { ok: true, remaining: Math.floor(b.tokens), resetMs: opts.windowMs }
  }
  // In a token bucket, one request becomes available after enough time
  // to refill one token (not after an entire fixed window).
  const resetMs = Math.ceil(((1 - b.tokens) / opts.limit) * opts.windowMs)
  return { ok: false, remaining: 0, resetMs }
}


/**
 * Shared Postgres-backed fixed-window limiter for security-sensitive endpoints.
 * Raw emails/IPs are never stored; the database receives only a SHA-256 key.
 * Production fails closed when the RPC/database is unavailable.
 */
export async function distributedRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  if (!isSupabaseConfigured && process.env.NODE_ENV !== 'production') {
    return rateLimit(key, opts)
  }
  try {
    const keyHash = createHash('sha256').update(key).digest('hex')
    const { data, error } = await db.rpc('consume_rate_limit', {
      p_key_hash: keyHash,
      p_limit: opts.limit,
      p_window_seconds: Math.max(1, Math.ceil(opts.windowMs / 1000)),
    })
    const row = (Array.isArray(data) ? data[0] : data) as {
      allowed?: boolean
      remaining?: number
      reset_ms?: number | string
    } | null
    if (error || !row || typeof row.allowed !== 'boolean') {
      console.error('[Buildr] distributed rate limiter unavailable:', error?.message || 'missing RPC result')
      return { ok: false, remaining: 0, resetMs: opts.windowMs }
    }
    return {
      ok: row.allowed,
      remaining: Math.max(0, Number(row.remaining ?? 0)),
      resetMs: Math.max(1, Number(row.reset_ms ?? opts.windowMs)),
    }
  } catch (error) {
    console.error('[Buildr] distributed rate limiter failed:', error instanceof Error ? error.message : 'unknown')
    return { ok: false, remaining: 0, resetMs: opts.windowMs }
  }
}

/** Build a rate-limit response with standard headers. */
export function rateLimitedResponse(resetMs: number): Response {
  return new Response(
    JSON.stringify({ error: 'rate_limited', retryAfterMs: resetMs }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil(resetMs / 1000)),
      },
    },
  )
}

export function trustedClientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return process.env.NODE_ENV === 'production' ? 'unknown' : 'development'
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim()
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : 'unknown'
}
