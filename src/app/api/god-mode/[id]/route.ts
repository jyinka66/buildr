// GET    /api/god-mode/[id] — one goal with its task plan and progress
// PATCH  /api/god-mode/[id] — act on a goal:
//          { action: 'update_plan', tasks, goal? }  edit the plan (before it starts)
//          { action: 'approve' }                    start building
//          { action: 'cancel' }                     stop for good
//          { action: 'task', taskId, op }           op: 'complete' | 'skip' | 'retry'
// DELETE /api/god-mode/[id] — remove a goal that is not running
//
// Every query matches both the goal id and the signed-in user.
import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { checkLimit, releaseUsageReservation, trackUsage } from '@/lib/billing'
import { authenticate, migrationNeeded, readBody, tooManyRequests } from '@/lib/god-mode/http'
import { applyPlanEdit, computeProgress, describeGoal, resolveTask } from '@/lib/god-mode/plan'
import {
  assertRunnerReady,
  createGoalProject,
  mutateGoal,
  runUntilPause,
} from '@/lib/god-mode/runner'
import { readPlanMeta, readTasks, toGoalDetail, type GoalRow } from '@/lib/god-mode/view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

const MAX_GOAL_CHARS = 2_000
// How long the follow-on run after a response may keep going.
const BACKGROUND_BUDGET_MS = 8 * 60_000

async function loadGoal(id: string, ownerId: string): Promise<GoalRow | null> {
  const { data } = await db.from('god_mode_goals').select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle()
  return (data as GoalRow | null) ?? null
}

function keepRunning(goalId: string, ownerId: string) {
  after(async () => {
    try {
      await runUntilPause(goalId, ownerId, BACKGROUND_BUDGET_MS)
    } catch (err) {
      console.error('[Buildr] God Mode background run failed:', err instanceof Error ? err.message : err)
    }
  })
}

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })
const conflict = (message: string) => NextResponse.json({ error: 'not_allowed', message }, { status: 409 })

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const row = await loadGoal(id, user.id)
  if (!row) return notFound()
  return NextResponse.json(toGoalDetail(row))
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params

  const limited = tooManyRequests(`godmode-write:${user.id}`, 60, 60_000)
  if (limited) return limited
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

  const row = await loadGoal(id, user.id)
  if (!row) return notFound()
  const now = new Date().toISOString()

  switch (body.action) {
    // ── Edit the plan before anything is built ─────────────────────
    case 'update_plan': {
      if (row.status !== 'planned') return conflict('The plan can only be edited before it starts.')
      const tasks = applyPlanEdit(body.tasks)
      if (!tasks) return NextResponse.json({ error: 'The plan needs at least one task.' }, { status: 400 })
      const update: Record<string, unknown> = {}
      if (body.goal !== undefined) {
        const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
        if (goal.length < 10 || goal.length > MAX_GOAL_CHARS) {
          return NextResponse.json({ error: `The goal must be 10 to ${MAX_GOAL_CHARS} characters.` }, { status: 400 })
        }
        update.goal = goal
      }
      const progress = computeProgress(tasks)
      const { data } = await db
        .from('god_mode_goals')
        .update({
          ...update,
          task_graph: JSON.stringify(tasks),
          progress: JSON.stringify({ ...progress, plan: readPlanMeta(row) }),
          current_task: progress.currentTask ?? '',
          result_summary: describeGoal('planned', tasks),
          updated_at: now,
        })
        .eq('id', id)
        .eq('owner_id', user.id)
        .eq('status', 'planned')
        .select('*')
      if (!data || data.length === 0) return conflict('The plan can only be edited before it starts.')
      return NextResponse.json(toGoalDetail(data[0] as GoalRow))
    }

    // ── Approve: create the project and start running ──────────────
    case 'approve': {
      if (row.status !== 'planned') return conflict('This plan has already been started.')
      try {
        await assertRunnerReady()
      } catch (err) {
        const res = migrationNeeded(err)
        if (res) return res
        return NextResponse.json({ error: 'god_mode_unavailable' }, { status: 503 })
      }

      const goalLimit = await checkLimit(user.id, 'godmode_goals')
      if (!goalLimit.ok) {
        return NextResponse.json(
          { error: 'plan_limit_exceeded', message: `God Mode goal limit reached (${goalLimit.limit}). Upgrade your plan.` },
          { status: 402 },
        )
      }
      const projectLimit = await checkLimit(user.id, 'projects')
      try {
        if (!projectLimit.ok) {
          return NextResponse.json(
            { error: 'plan_limit_exceeded', message: `Project limit reached (${projectLimit.limit}). Upgrade your plan.` },
            { status: 402 },
          )
        }

        // Claim the plan first so a double tap cannot start it twice.
        const { data: claimed } = await db
          .from('god_mode_goals')
          .update({ status: 'running', lease_until: null, updated_at: now })
          .eq('id', id)
          .eq('owner_id', user.id)
          .eq('status', 'planned')
          .select('*')
        if (!claimed || claimed.length === 0) return conflict('This plan has already been started.')

        let projectId: string
        try {
          projectId = (await createGoalProject(user.id, row.goal, readPlanMeta(row).summary)).id
        } catch {
          await db.from('god_mode_goals').update({ status: 'planned', updated_at: now }).eq('id', id).eq('owner_id', user.id)
          return NextResponse.json({ error: 'project_create_failed' }, { status: 500 })
        }
        await db.from('god_mode_goals').update({ project_id: projectId }).eq('id', id).eq('owner_id', user.id)
        await trackUsage(user.id, 'godmode_goals', 1, { goalId: id, reservationId: goalLimit.reservationId })
        await trackUsage(user.id, 'projects', 1, { projectId, via: 'god-mode', reservationId: projectLimit.reservationId })

        keepRunning(id, user.id)
        const fresh = await loadGoal(id, user.id)
        return NextResponse.json(toGoalDetail((fresh ?? claimed[0]) as GoalRow))
      } finally {
        await releaseUsageReservation(user.id, goalLimit.reservationId).catch(() => undefined)
        await releaseUsageReservation(user.id, projectLimit.reservationId).catch(() => undefined)
      }
    }

    // ── Cancel ──────────────────────────────────────────────────────
    case 'cancel': {
      const { data } = await db
        .from('god_mode_goals')
        .update({
          status: 'cancelled',
          result_summary: describeGoal('cancelled', readTasks(row)),
          updated_at: now,
        })
        .eq('id', id)
        .eq('owner_id', user.id)
        .in('status', ['planned', 'running', 'waiting', 'failed'])
        .select('*')
      if (!data || data.length === 0) return conflict('This goal has already finished or been cancelled.')
      return NextResponse.json(toGoalDetail(data[0] as GoalRow))
    }

    // ── A decision about one task ───────────────────────────────────
    case 'task': {
      const taskId = body.taskId
      const op = body.op
      if (typeof taskId !== 'number' || !Number.isInteger(taskId) || (op !== 'complete' && op !== 'skip' && op !== 'retry')) {
        return NextResponse.json({ error: 'taskId and op (complete, skip or retry) are required' }, { status: 400 })
      }
      if (!['running', 'waiting', 'failed'].includes(row.status)) {
        return conflict('Tasks can only be changed while the goal is active.')
      }
      try {
        await assertRunnerReady()
      } catch (err) {
        const res = migrationNeeded(err)
        if (res) return res
        return NextResponse.json({ error: 'god_mode_unavailable' }, { status: 503 })
      }
      const saved = await mutateGoal(id, user.id, (tasks) => {
        const next = resolveTask(tasks, taskId, op, new Date().toISOString())
        return next ? { tasks: next } : null
      })
      if (!saved) return conflict('That cannot be done to this task right now.')
      if (saved.status === 'running') keepRunning(id, user.id)
      return NextResponse.json(toGoalDetail(saved.row))
    }

    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params
  const row = await loadGoal(id, user.id)
  if (!row) return notFound()
  if (row.status === 'running') return conflict('Cancel this goal before deleting it.')

  const { error } = await db.from('god_mode_goals').delete().eq('id', id).eq('owner_id', user.id)
  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
