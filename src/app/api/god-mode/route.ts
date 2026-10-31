// GET  /api/god-mode — list the user's goals
// POST /api/god-mode — turn a goal into a PLAN (nothing is built yet)
//
// God Mode is the autonomous agent layer. The user sets a goal + timeframe and
// the AI breaks it into a task list. The plan is saved as status 'planned' so
// the person can review and edit it; building starts only when they approve it
// (PATCH /api/god-mode/[id] { action: 'approve' }) and then runs one task at a
// time (see lib/god-mode/runner.ts).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkLimit, releaseUsageReservation, trackUsage } from '@/lib/billing'
import { authenticate, readBody, tooManyRequests } from '@/lib/god-mode/http'
import { computeProgress, describeGoal } from '@/lib/god-mode/plan'
import { planGoal } from '@/lib/god-mode/runner'
import { toGoalDetail, toGoalSummary, type GoalRow } from '@/lib/god-mode/view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_GOAL_CHARS = 2_000
const MAX_PLANNED_GOALS = 20

export async function GET() {
  const user = await authenticate()
  if (user instanceof NextResponse) return user

  const { data, error } = await db
    .from('god_mode_goals')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: 'list_failed' }, { status: 500 })

  return NextResponse.json({ goals: (data ?? []).map((g: GoalRow) => toGoalSummary(g)) })
}

export async function POST(req: NextRequest) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user

  const limited = tooManyRequests(`godmode-plan:${user.id}`, 10, 60 * 60_000)
  if (limited) return limited

  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  const requested = typeof body.timeframeHours === 'number' ? body.timeframeHours : 24
  const timeframeHours = Math.min(Math.max(Math.round(requested) || 24, 1), 168)
  if (goal.length < 10) {
    return NextResponse.json(
      { error: 'Please describe your goal in detail (at least 10 characters).' },
      { status: 400 },
    )
  }
  if (goal.length > MAX_GOAL_CHARS) {
    return NextResponse.json({ error: `Please keep the goal under ${MAX_GOAL_CHARS} characters.` }, { status: 413 })
  }

  const { count } = await db
    .from('god_mode_goals')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
    .eq('status', 'planned')
  if ((count ?? 0) >= MAX_PLANNED_GOALS) {
    return NextResponse.json(
      { error: 'too_many_plans', message: 'You have many plans waiting. Start or delete some before making a new one.' },
      { status: 409 },
    )
  }

  // Planning is a model call, so it is metered like any other.
  const limit = await checkLimit(user.id, 'llm_tokens')
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: `LLM token limit reached (${limit.limit}). Upgrade your plan.` },
      { status: 402 },
    )
  }

  try {
    let planned
    try {
      planned = await planGoal(goal, timeframeHours)
    } catch (err) {
      const noProvider = err instanceof Error && /No configured LLM providers/i.test(err.message)
      return NextResponse.json(
        {
          error: noProvider ? 'no_provider' : 'plan_failed',
          message: noProvider
            ? 'No AI provider is configured. Add a provider key in Settings, then try again.'
            : 'Could not turn that goal into a plan. Try describing it a little more specifically.',
        },
        { status: noProvider ? 503 : 502 },
      )
    }

    await trackUsage(user.id, 'llm_tokens', Math.max(1, planned.tokens), {
      reservationId: limit.reservationId,
      via: 'god-mode-plan',
    })

    const { plan } = planned
    const progress = computeProgress(plan.tasks)
    const { data: row, error } = await db
      .from('god_mode_goals')
      .insert({
        owner_id: user.id,
        goal,
        timeframe_hours: timeframeHours,
        task_graph: JSON.stringify(plan.tasks),
        progress: JSON.stringify({
          ...progress,
          plan: { summary: plan.summary, deliverables: plan.deliverables, successCriteria: plan.successCriteria },
        }),
        current_task: progress.currentTask ?? '',
        status: 'planned',
        result_summary: describeGoal('planned', plan.tasks),
      })
      .select('*')
      .single()
    if (error || !row) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

    return NextResponse.json({ ok: true, goalId: row.id, ...toGoalDetail(row as GoalRow) }, { status: 201 })
  } finally {
    await releaseUsageReservation(user.id, limit.reservationId).catch(() => undefined)
  }
}
