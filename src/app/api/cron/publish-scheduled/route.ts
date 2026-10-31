// POST|GET /api/cron/publish-scheduled
// Publishes scheduled social posts that are due. Called every few minutes by the
// "Publish scheduled posts" GitHub Actions workflow (or any scheduler that can send a
// bearer token). Fails closed: without CRON_SECRET configured the endpoint refuses to run.

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runDuePosts } from '@/lib/social/run-due'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorize(req: NextRequest): 'ok' | 'unconfigured' | 'denied' {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || secret.length < 16) return 'unconfigured'
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  // Compare fixed-length digests so neither length nor content leaks through timing.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b) ? 'ok' : 'denied'
}

async function handle(req: NextRequest) {
  const auth = authorize(req)
  if (auth === 'unconfigured') return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 })
  if (auth === 'denied') return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const summary = await runDuePosts()
    return NextResponse.json({ ok: true, ...summary }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('[Buildr] publish-scheduled run failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'run_failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
