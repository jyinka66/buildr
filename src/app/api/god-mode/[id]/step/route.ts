// POST /api/god-mode/[id]/step — carry out the goal's next task.
//
// Runs at most ONE task and returns the updated goal, so the browser can keep
// calling it while the page is open and show live progress. If another request
// is already working on the goal the answer is { outcome: 'busy' } and nothing
// is run twice.
import { NextRequest, NextResponse } from 'next/server'
import { authenticate, migrationNeeded, tooManyRequests } from '@/lib/god-mode/http'
import { advanceGoal } from '@/lib/god-mode/runner'
import { toGoalDetail, type GoalRow } from '@/lib/god-mode/view'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params

  const limited = tooManyRequests(`godmode-step:${user.id}`, 120, 60_000)
  if (limited) return limited

  let result
  try {
    result = await advanceGoal(id, user.id)
  } catch (err) {
    const res = migrationNeeded(err)
    if (res) return res
    console.error('[Buildr] God Mode step failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'step_failed' }, { status: 500 })
  }

  const { data: row } = await db.from('god_mode_goals').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({
    outcome: result.outcome,
    ...(result.outcome === 'limit' ? { message: result.message } : {}),
    ...toGoalDetail(row as GoalRow),
  })
}
