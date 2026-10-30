// Simple in-memory rate limiter.
// ------------------------------------------------------------------
// Per-key token-bucket limiter. Used to throttle auth + generation
// endpoints per user. In-memory only (resets on server restart) —
// adequate for a single-instance deployment. For multi-instance, swap
// for a Redis-backed limiter.

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
