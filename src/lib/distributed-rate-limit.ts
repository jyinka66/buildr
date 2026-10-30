import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase-server'
import { rateLimit, type RateLimitOptions, type RateLimitResult } from './rate-limit'

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

