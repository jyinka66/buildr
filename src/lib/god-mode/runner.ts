// God Mode runner: plans a goal, then carries it out one task at a time.
// ------------------------------------------------------------------
// Execution is a small state machine kept in the god_mode_goals row:
//
//   planned --approve--> running <--> waiting (a task needs the person)
//                           |-----> completed | failed | cancelled
//
// Only one request may advance a goal at a time: it takes a lease with a
// conditional update, runs ONE task, and releases it. Because each step is
// short and the state lives in the database, the goal can be advanced by the
// browser while the page is open, by a follow-on step after the response, or
// by an external scheduler (/api/god-mode/tick). If the server sleeps in the
// middle of a task, the lease expires and the task is retried.
//
// Automatic tasks change the project's files through the same generators the
// builder uses (generateInitialProject / generateIncremental). Publishing,
// images and manual work are never done unattended; they wait for the person.
import { db } from '@/lib/db'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { generateIncremental, generateInitialProject } from '@/lib/llm/code-generator'
import { checkLimit, releaseUsageReservation, trackUsage } from '@/lib/billing'
import { slugify } from '@/lib/helpers'
import type { DbConfig, StackKey, StylingKey } from '@/lib/types'
import {
  SCAFFOLD_ID,
  buildTaskInstruction,
  deriveGoalStatus,
  computeProgress,
  describeGoal,
  extractPlan,
  finishTask,
  pickNextStep,
  readJson,
  recoverStaleTasks,
  settleFailure,
  startTask,
  waitOnTask,
  type GoalStatus,
  type PlanTask,
} from '@/lib/god-mode/plan'
import { readPlanMeta, readTasks, type GoalRow, type PlanMeta } from '@/lib/god-mode/view'

// Longer than the slowest model call (120 s) plus saving, so a healthy step
// never loses its lease, yet a dead one is picked up again reasonably soon.
const LEASE_MS = 10 * 60_000

export class GodModeMigrationNeeded extends Error {
  constructor() {
    super('god_mode_migration_needed')
  }
}

const isMissingColumn = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /lease_until/i.test(e.message ?? ''))

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function plannerMessages(goal: string, timeframeHours: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are an autonomous AI agent planner for Buildr, a platform that builds web apps.',
        `Timeframe: ${timeframeHours} hours. Plan tasks that fit within it.`,
        '',
        'Break the goal into an ordered task list. The project is created and its first version is',
        'generated automatically before your tasks run, so do NOT include a scaffold or setup task.',
        '',
        'Return ONLY a JSON object:',
        '{',
        '  "summary": string,   one paragraph on what will be built',
        '  "tasks": [{',
        '    "id": number,      1, 2, 3, ... in order',
        '    "name": string,    short',
        '    "description": string,   what this task changes in the app',
        '    "tool": "code-generator" | "schema-design" | "seed" | "seo" | "code-review" | "image-generator" | "deploy" | "manual",',
        '    "dependencies": [number],   ids of EARLIER tasks only',
        '    "estimatedMinutes": number',
        '  }],',
        '  "deliverables": [string],',
        '  "successCriteria": [string]',
        '}',
        '',
        'Rules:',
        '- 4 to 12 tasks, ordered logically (data model, features, polish, review).',
        '- Use "code-generator" for building features, pages and APIs.',
        '- Use "image-generator", "deploy" or "manual" only for things a person must do or approve.',
        '- Return ONLY the JSON. No markdown.',
      ].join('\n'),
    },
    { role: 'user', content: `Goal: ${goal}\n\nReturn the task plan as JSON.` },
  ]
}

export async function planGoal(goal: string, timeframeHours: number) {
  let tokens = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await complete(plannerMessages(goal, timeframeHours), 'general', {
      temperature: 0.3,
      maxTokens: 3000,
    })
    tokens += result.tokens
    const plan = extractPlan(result.content)
    if (plan) return { plan, tokens }
  }
  throw new Error('plan_failed')
}

// ---------------------------------------------------------------------------
// Project creation (when a plan is approved)
// ---------------------------------------------------------------------------

async function uniqueProjectSlug(base: string): Promise<string> {
  let candidate = base
  for (let i = 1; i < 200; i++) {
    const { data } = await db.from('projects').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

export async function createGoalProject(userId: string, goal: string, summary: string) {
  const { data, error } = await db
    .from('projects')
    .insert({
      name: goal.slice(0, 50),
      slug: await uniqueProjectSlug(slugify(goal.slice(0, 40))),
      description: summary || goal.slice(0, 280),
      prompt: goal,
      stack: 'nextjs',
      styling: 'tailwind',
      integrations: JSON.stringify(['nextauth']),
      db_config: JSON.stringify({ engine: 'sqlite', orm: 'prisma' }),
      status: 'draft',
      owner_id: userId,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error('project_create_failed')
  return data as { id: string }
}

// ---------------------------------------------------------------------------
// Changing state safely
// ---------------------------------------------------------------------------

export interface Mutation {
  tasks: PlanTask[]
  // Leave unset to derive the status from the tasks.
  status?: GoalStatus
}

// Applies `fn` to the goal's CURRENT tasks and saves the result. The write only
// lands if nobody else changed the row in between (compared on updated_at), and
// is retried on fresh data otherwise, so a person's decision and the runner's
// progress can never overwrite each other. A cancelled goal is never changed.
// Returns the saved row, or null if the goal is gone, cancelled, or `fn` returned null.
export async function mutateGoal(
  goalId: string,
  ownerId: string,
  fn: (tasks: PlanTask[], row: GoalRow) => Mutation | null,
): Promise<{ row: GoalRow; tasks: PlanTask[]; status: GoalStatus } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row } = await db
      .from('god_mode_goals')
      .select('*')
      .eq('id', goalId)
      .eq('owner_id', ownerId)
      .maybeSingle()
    if (!row || row.status === 'cancelled') return null
    const current = row as GoalRow
    const result = fn(readTasks(current), current)
    if (!result) return null

    const status = result.status ?? deriveGoalStatus(current.status as GoalStatus, result.tasks)
    const progress = computeProgress(result.tasks)
    const { data: saved } = await db
      .from('god_mode_goals')
      .update({
        task_graph: JSON.stringify(result.tasks),
        progress: JSON.stringify({ ...progress, plan: readPlanMeta(current) }),
        current_task: progress.currentTask ?? '',
        status,
        result_summary: describeGoal(status, result.tasks),
        updated_at: new Date().toISOString(),
      })
      .eq('id', goalId)
      .eq('owner_id', ownerId)
      .eq('updated_at', current.updated_at)
      .neq('status', 'cancelled')
      .select('*')
    if (saved && saved.length > 0) return { row: saved[0] as GoalRow, tasks: result.tasks, status }
  }
  throw new Error('goal_update_conflict')
}

// ---------------------------------------------------------------------------
// Running one step
// ---------------------------------------------------------------------------

export type StepOutcome =
  | { outcome: 'ran'; status: GoalStatus }
  | { outcome: 'idle'; status: GoalStatus }
  | { outcome: 'busy'; status: GoalStatus }
  | { outcome: 'limit'; status: GoalStatus; message: string }

async function acquireLease(goalId: string, ownerId: string): Promise<GoalRow | null> {
  const now = new Date()
  const { data, error } = await db
    .from('god_mode_goals')
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq('id', goalId)
    .eq('owner_id', ownerId)
    .eq('status', 'running')
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select('*')
  if (error) {
    if (isMissingColumn(error)) throw new GodModeMigrationNeeded()
    throw new Error('lease_failed')
  }
  return data && data.length > 0 ? (data[0] as GoalRow) : null
}

const releaseLease = async (goalId: string) => {
  await db.from('god_mode_goals').update({ lease_until: null }).eq('id', goalId)
}

// Runs the automatic task. Returns the tokens it used and a short summary, or
// throws with the reason it failed.
async function runAutoTask(
  row: GoalRow,
  task: PlanTask,
  tasks: PlanTask[],
  meta: PlanMeta,
  ownerId: string,
): Promise<{ note: string; tokens: number }> {
  if (!row.project_id) throw new Error('This goal has no project yet.')
  const { data: project } = await db
    .from('projects')
    .select('*')
    .eq('id', row.project_id)
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (!project) throw new Error('The project for this goal no longer exists.')

  const stack = String(project.stack || 'nextjs') as StackKey
  const styling = String(project.styling || 'tailwind') as StylingKey
  const integrations = readJson<string[]>(project.integrations, [])
  const dbConfig = readJson<DbConfig>(project.db_config, { engine: 'sqlite', orm: 'prisma' } as DbConfig)

  if (task.id === SCAFFOLD_ID) {
    const prompt = meta.summary ? `${row.goal}\n\n${meta.summary}` : row.goal
    const result = await generateInitialProject({
      projectId: row.project_id,
      name: String(project.name || row.goal.slice(0, 50)),
      prompt,
      stack,
      styling,
      integrations,
      dbConfig,
    })
    if (!result.files || result.files.length === 0) throw new Error('The model returned no files.')
    return { note: `Generated ${result.files.length} files.`, tokens: result.tokens }
  }

  const { data: fileRows } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', row.project_id)
    .limit(300)
  const result = await generateIncremental({
    projectId: row.project_id,
    message: buildTaskInstruction(row.goal, meta.summary, task, tasks),
    stack,
    styling,
    integrations,
    dbConfig,
    history: [],
    existingFiles: (fileRows ?? []).map((f: { path: string; content: string }) => ({
      path: f.path,
      content: f.content,
    })),
  })
  if (!result.fileOps || result.fileOps.length === 0) throw new Error('The model returned no file changes.')
  const names = result.fileOps.map((o) => o.path)
  const shown = names.slice(0, 6).join(', ')
  return {
    note: `Changed ${names.length} file${names.length === 1 ? '' : 's'}: ${shown}${names.length > 6 ? ', ...' : ''}.`,
    tokens: result.tokens,
  }
}

// Advances a goal by at most one task.
export async function advanceGoal(goalId: string, ownerId: string): Promise<StepOutcome> {
  const row = await acquireLease(goalId, ownerId)
  if (!row) {
    const { data } = await db.from('god_mode_goals').select('status').eq('id', goalId).eq('owner_id', ownerId).maybeSingle()
    const status = (data?.status ?? 'cancelled') as GoalStatus
    return { outcome: status === 'running' ? 'busy' : 'idle', status }
  }

  const meta = readPlanMeta(row)
  const now = () => new Date().toISOString()
  let reservationId: string | undefined

  try {
    // A task still marked running while the lease was free belongs to a request
    // that died; it is retried (or failed after too many attempts).
    if (readTasks(row).some((t) => t.status === 'running')) {
      await mutateGoal(goalId, ownerId, (tasks) => ({ tasks: recoverStaleTasks(tasks, now()) }))
    }

    const fresh = await mutateGoal(goalId, ownerId, (tasks) => ({ tasks }))
    if (!fresh) return { outcome: 'idle', status: 'cancelled' }
    const next = pickNextStep(fresh.tasks)

    if (next.kind === 'needs_user') {
      const saved = await mutateGoal(goalId, ownerId, (tasks) => ({ tasks: waitOnTask(tasks, next.task.id) }))
      return { outcome: 'idle', status: saved?.status ?? 'cancelled' }
    }
    if (next.kind !== 'run') return { outcome: 'idle', status: fresh.status }

    // Token budget: each model call is metered like a builder generation.
    const limit = await checkLimit(ownerId, 'llm_tokens')
    if (!limit.ok) {
      return {
        outcome: 'limit',
        status: fresh.status,
        message: `LLM token limit reached (${limit.limit}). Upgrade your plan, then continue.`,
      }
    }
    reservationId = limit.reservationId

    const task = next.task
    const started = await mutateGoal(goalId, ownerId, (tasks) => ({ tasks: startTask(tasks, task.id, now()) }))
    if (!started) return { outcome: 'idle', status: 'cancelled' }

    let outcomeTasks: (tasks: PlanTask[]) => PlanTask[]
    try {
      const result = await runAutoTask(row, task, started.tasks, meta, ownerId)
      await trackUsage(ownerId, 'llm_tokens', Math.max(1, result.tokens), {
        projectId: row.project_id ?? undefined,
        reservationId,
        via: 'god-mode',
      })
      outcomeTasks = (tasks) => finishTask(tasks, task.id, result.note, now())
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'task_failed'
      outcomeTasks = (tasks) => settleFailure(tasks, task.id, reason, now())
    }

    const done = await mutateGoal(goalId, ownerId, (tasks) => ({ tasks: outcomeTasks(tasks) }))
    return { outcome: 'ran', status: done?.status ?? 'cancelled' }
  } finally {
    await releaseUsageReservation(ownerId, reservationId).catch(() => undefined)
    await releaseLease(goalId).catch(() => undefined)
  }
}

// Keeps advancing until the goal pauses, finishes, or the time budget is used.
// Used for follow-on steps after a response and by the scheduled tick.
export async function runUntilPause(goalId: string, ownerId: string, budgetMs: number): Promise<StepOutcome> {
  const startedAt = Date.now()
  let outcome: StepOutcome = await advanceGoal(goalId, ownerId)
  while (outcome.outcome === 'ran' && outcome.status === 'running' && Date.now() - startedAt < budgetMs) {
    outcome = await advanceGoal(goalId, ownerId)
  }
  return outcome
}

// Throws GodModeMigrationNeeded until the lease_until column exists, so the
// routes can say so up front instead of leaving a goal that can never run.
export async function assertRunnerReady(): Promise<void> {
  const { error } = await db.from('god_mode_goals').select('lease_until').limit(1)
  if (error) {
    if (isMissingColumn(error)) throw new GodModeMigrationNeeded()
    throw new Error('god_mode_unavailable')
  }
}
