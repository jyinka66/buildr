// Small helpers shared by the God Mode API routes.
import { NextResponse } from 'next/server'
import { requireSessionUser, type SessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import { GodModeMigrationNeeded } from '@/lib/god-mode/runner'

export async function authenticate(): Promise<SessionUser | NextResponse> {
  try {
    return await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
}

export function tooManyRequests(key: string, limit: number, windowMs: number): NextResponse | null {
  const rl = rateLimit(key, { limit, windowMs })
  if (rl.ok) return null
  return NextResponse.json(
    { error: 'rate_limited', retryAfterMs: rl.resetMs },
    { status: 429, headers: { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
  )
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// The runner needs the lease_until column; until the migration is applied the
// routes explain that instead of failing with a database error.
export function migrationNeeded(err: unknown): NextResponse | null {
  if (err instanceof GodModeMigrationNeeded) {
    return NextResponse.json(
      {
        error: 'god_mode_migration_needed',
        message: 'God Mode needs a database update before it can run. Apply migration 20261031010000_god_mode_runner.sql.',
      },
      { status: 503 },
    )
  }
  return null
}
