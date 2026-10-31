// POST /api/god-mode/tick — advance every running goal that is not being worked on.
//
// For an external scheduler (a Render cron job, an uptime pinger) so goals keep
// moving when nobody has the page open and the server was asleep. Disabled
// unless GOD_MODE_CRON_SECRET is set; send it as `x-cron-secret` or as a Bearer token.
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { migrationNeeded } from '@/lib/god-mode/http'
import { assertRunnerReady, runUntilPause } from '@/lib/god-mode/runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_GOALS_PER_TICK = 5
const PER_GOAL_BUDGET_MS = 90_000
const TOTAL_BUDGET_MS = 240_000

function secretMatches(req: NextRequest, secret: string): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const given = req.headers.get('x-cron-secret') ?? bearer ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const secret = process.env.GOD_MODE_CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!secretMatches(req, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    await assertRunnerReady()
  } catch (err) {
    const res = migrationNeeded(err)
    if (res) return res
    return NextResponse.json({ error: 'god_mode_unavailable' }, { status: 503 })
  }

  const nowIso = new Date().toISOString()
  const { data: due } = await db
    .from('god_mode_goals')
    .select('id, owner_id')
    .eq('status', 'running')
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .order('updated_at', { ascending: true })
    .limit(MAX_GOALS_PER_TICK)

  const startedAt = Date.now()
  const results: { goalId: string; outcome: string; status: string }[] = []
  for (const g of due ?? []) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) break
    try {
      const r = await runUntilPause(g.id, g.owner_id, PER_GOAL_BUDGET_MS)
      results.push({ goalId: g.id, outcome: r.outcome, status: r.status })
    } catch (err) {
      console.error('[Buildr] God Mode tick failed for a goal:', err instanceof Error ? err.message : err)
      results.push({ goalId: g.id, outcome: 'error', status: 'running' })
    }
  }
  return NextResponse.json({ ok: true, checked: (due ?? []).length, results })
}
