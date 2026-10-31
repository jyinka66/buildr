// God Mode planning rules: pure functions with no imports, so they can be
// unit-tested directly. The runner (runner.ts) and the API routes build on
// these; nothing here touches the database or an LLM.
//
// A goal is a list of tasks in dependency order. Every task depends on the
// scaffold task (id 0), which creates the project, so a project always exists
// before any other task runs. A task's dependencies may only point at tasks
// that come EARLIER in the list, which makes cycles impossible by construction.

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting'
export type GoalStatus = 'planned' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
export type TaskTool =
  | 'scaffold'
  | 'code-generator'
  | 'schema-design'
  | 'seed'
  | 'seo'
  | 'code-review'
  | 'image-generator'
  | 'deploy'
  | 'manual'

export interface PlanTask {
  id: number
  name: string
  description: string
  tool: TaskTool
  dependencies: number[]
  estimatedMinutes: number
  status: TaskStatus
  // Times the runner has started this task (a task is tried at most MAX_ATTEMPTS times).
  attempts?: number
  // Short result of the task once it finished (what changed, or why it failed).
  note?: string
  startedAt?: string
  finishedAt?: string
}

export const SCAFFOLD_ID = 0
export const MAX_TASKS = 20
export const MAX_ATTEMPTS = 2
const MAX_NAME_CHARS = 80
const MAX_DESCRIPTION_CHARS = 400
const MAX_NOTE_CHARS = 500

// Tools the runner performs itself by changing the project's files.
const AUTO_TOOLS: ReadonlySet<TaskTool> = new Set([
  'scaffold',
  'code-generator',
  'schema-design',
  'seed',
  'seo',
  'code-review',
])
// Tools that need the person: publishing, image work and anything manual is
// never done unattended, so the task waits until the user marks it done or skips it.
const USER_TOOLS: ReadonlySet<TaskTool> = new Set(['image-generator', 'deploy', 'manual'])
const ALL_TOOLS: ReadonlySet<string> = new Set([...AUTO_TOOLS, ...USER_TOOLS])

export const isAutoTool = (tool: TaskTool): boolean => AUTO_TOOLS.has(tool)

// Tools a person may pick when editing a plan (scaffold is fixed).
export const EDITABLE_TOOLS: TaskTool[] = [
  'code-generator',
  'schema-design',
  'seed',
  'seo',
  'code-review',
  'image-generator',
  'deploy',
  'manual',
]

// jsonb columns in this codebase are written with JSON.stringify, so they come
// back as a string; accept both that and an already-parsed value.
export function readJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return (JSON.parse(value) as T) ?? fallback
    } catch {
      return fallback
    }
  }
  return value as T
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

export function scaffoldTask(): PlanTask {
  return {
    id: SCAFFOLD_ID,
    name: 'Scaffold the project',
    description: 'Create the project and generate the first working version of the app from the goal.',
    tool: 'scaffold',
    dependencies: [],
    estimatedMinutes: 5,
    status: 'pending',
  }
}

// Turns untrusted task data (model output or a user's edited plan) into a
// valid plan: the scaffold task first, then at most MAX_TASKS-1 tasks with
// unique ids, known tools, clamped text, and dependencies that only point at
// earlier tasks. Every task is reset to 'pending'.
export function normalizeTasks(raw: unknown): PlanTask[] {
  const out: PlanTask[] = [scaffoldTask()]
  if (!Array.isArray(raw)) return out

  const used = new Set<number>([SCAFFOLD_ID])
  let nextId = 1
  const takeId = (wanted: unknown): number => {
    if (typeof wanted === 'number' && Number.isInteger(wanted) && wanted >= 1 && !used.has(wanted)) {
      used.add(wanted)
      return wanted
    }
    while (used.has(nextId)) nextId++
    used.add(nextId)
    return nextId
  }

  const staged: { task: PlanTask; wantedDeps: unknown }[] = []
  for (const item of raw) {
    if (staged.length >= MAX_TASKS - 1) break
    const r = item as Record<string, unknown> | null
    if (!r || typeof r !== 'object') continue
    const name = clean(r.name, MAX_NAME_CHARS)
    if (!name) continue
    let tool: TaskTool = ALL_TOOLS.has(String(r.tool)) ? (r.tool as TaskTool) : 'manual'
    // The scaffold task is added by the system, never taken from input.
    if (tool === 'scaffold') tool = 'code-generator'
    const minutes = typeof r.estimatedMinutes === 'number' && Number.isFinite(r.estimatedMinutes) ? r.estimatedMinutes : 10
    staged.push({
      task: {
        id: takeId(r.id),
        name,
        description: clean(r.description, MAX_DESCRIPTION_CHARS),
        tool,
        dependencies: [],
        estimatedMinutes: Math.min(240, Math.max(1, Math.round(minutes))),
        status: 'pending',
      },
      wantedDeps: r.dependencies,
    })
  }

  const earlier = new Set<number>([SCAFFOLD_ID])
  for (const { task, wantedDeps } of staged) {
    const deps = new Set<number>([SCAFFOLD_ID])
    if (Array.isArray(wantedDeps)) {
      for (const d of wantedDeps) {
        if (typeof d === 'number' && Number.isInteger(d) && earlier.has(d)) deps.add(d)
      }
    }
    task.dependencies = [...deps].sort((a, b) => a - b)
    earlier.add(task.id)
    out.push(task)
  }
  return out
}

// Reads the planner model's reply: a JSON object (possibly wrapped in prose or
// code fences) with a summary, tasks, deliverables and success criteria.
export function extractPlan(
  text: string,
): { summary: string; tasks: PlanTask[]; deliverables: string[]; successCriteria: string[] } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const tasks = normalizeTasks(parsed.tasks)
  if (tasks.length < 2) return null
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => clean(s, 200)).filter(Boolean).slice(0, 12) : []
  return {
    summary: clean(parsed.summary, 1000),
    tasks,
    deliverables: strings(parsed.deliverables),
    successCriteria: strings(parsed.successCriteria),
  }
}

// The user's edited plan: the scaffold task stays first and untouched, the
// rest is re-validated. Returns null if nothing but the scaffold is left.
export function applyPlanEdit(incoming: unknown): PlanTask[] | null {
  const tasks = normalizeTasks(incoming)
  return tasks.length >= 2 ? tasks : null
}

// ---------------------------------------------------------------------------
// Running a plan
// ---------------------------------------------------------------------------

export type NextStep =
  | { kind: 'run'; task: PlanTask }
  | { kind: 'needs_user'; task: PlanTask }
  | { kind: 'busy' }
  | { kind: 'waiting' }
  | { kind: 'failed' }
  | { kind: 'done' }

const FINISHED: ReadonlySet<TaskStatus> = new Set(['completed', 'skipped'])

// Decides what happens next: the first pending task whose dependencies are
// all finished. Tasks behind a failed task never run.
export function pickNextStep(tasks: PlanTask[]): NextStep {
  if (tasks.some((t) => t.status === 'running')) return { kind: 'busy' }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const t of tasks) {
    if (t.status !== 'pending') continue
    const ready = t.dependencies.every((d) => {
      const dep = byId.get(d)
      return !dep || FINISHED.has(dep.status)
    })
    if (!ready) continue
    return isAutoTool(t.tool) ? { kind: 'run', task: t } : { kind: 'needs_user', task: t }
  }
  if (tasks.every((t) => FINISHED.has(t.status))) return { kind: 'done' }
  if (tasks.some((t) => t.status === 'waiting')) return { kind: 'waiting' }
  return { kind: 'failed' }
}

// The goal's status follows from its tasks, except for the two states a
// person controls: 'planned' (awaiting approval) and 'cancelled'.
export function deriveGoalStatus(current: GoalStatus, tasks: PlanTask[]): GoalStatus {
  if (current === 'planned' || current === 'cancelled') return current
  const next = pickNextStep(tasks)
  switch (next.kind) {
    case 'done':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'waiting':
    case 'needs_user':
      return 'waiting'
    default:
      return 'running'
  }
}

export function computeProgress(tasks: PlanTask[]): {
  completedTasks: number
  totalTasks: number
  currentTask: string | null
} {
  const completedTasks = tasks.filter((t) => FINISHED.has(t.status)).length
  const active =
    tasks.find((t) => t.status === 'running') ??
    tasks.find((t) => t.status === 'waiting') ??
    tasks.find((t) => t.status === 'pending')
  return { completedTasks, totalTasks: tasks.length, currentTask: active ? active.name : null }
}

function patchTask(tasks: PlanTask[], id: number, patch: Partial<PlanTask>): PlanTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

export function startTask(tasks: PlanTask[], id: number, now: string): PlanTask[] {
  const t = tasks.find((x) => x.id === id)
  return patchTask(tasks, id, { status: 'running', attempts: (t?.attempts ?? 0) + 1, startedAt: now, note: undefined })
}

export function finishTask(tasks: PlanTask[], id: number, note: string, now: string): PlanTask[] {
  return patchTask(tasks, id, { status: 'completed', note: clean(note, MAX_NOTE_CHARS), finishedAt: now })
}

export function failTask(tasks: PlanTask[], id: number, note: string, now: string): PlanTask[] {
  return patchTask(tasks, id, { status: 'failed', note: clean(note, MAX_NOTE_CHARS), finishedAt: now })
}

// A task that needs the person (deploy, images, manual work) stops here.
export function waitOnTask(tasks: PlanTask[], id: number): PlanTask[] {
  return patchTask(tasks, id, { status: 'waiting', note: 'Waiting for you: mark it done or skip it.' })
}

// A task left 'running' by a request that died (the server slept or restarted)
// is tried again, up to MAX_ATTEMPTS, then marked failed.
export function recoverStaleTasks(tasks: PlanTask[], now: string): PlanTask[] {
  return tasks.map((t) => {
    if (t.status !== 'running') return t
    if ((t.attempts ?? 0) >= MAX_ATTEMPTS) {
      return { ...t, status: 'failed', note: 'Stopped before finishing and out of retries.', finishedAt: now }
    }
    return { ...t, status: 'pending', note: 'Interrupted; trying again.' }
  })
}

// A person's decision about a task that cannot run on its own, or a retry.
export function resolveTask(
  tasks: PlanTask[],
  id: number,
  action: 'complete' | 'skip' | 'retry',
  now: string,
): PlanTask[] | null {
  const t = tasks.find((x) => x.id === id)
  if (!t) return null
  if (action === 'retry') {
    if (t.status !== 'failed') return null
    return patchTask(tasks, id, { status: 'pending', attempts: 0, note: undefined, finishedAt: undefined })
  }
  if (t.status !== 'waiting' && t.status !== 'pending') return null
  if (t.status === 'pending' && isAutoTool(t.tool)) return null
  return patchTask(tasks, id, {
    status: action === 'complete' ? 'completed' : 'skipped',
    note: action === 'complete' ? 'Marked done by you.' : 'Skipped by you.',
    finishedAt: now,
  })
}

// ---------------------------------------------------------------------------
// What each automatic task asks the code generator to do
// ---------------------------------------------------------------------------

const TOOL_INSTRUCTIONS: Record<string, string> = {
  'code-generator': 'Implement this part of the app.',
  'schema-design':
    'Design or refine the data model for this part of the app: types, schema or migration files, and the code that uses them.',
  seed: 'Add realistic sample data and a way to load it, so the app is not empty when first opened.',
  seo: 'Improve SEO: page titles and meta descriptions, Open Graph tags, semantic headings, sitemap and robots, and image alt text.',
  'code-review':
    'Review the whole project for bugs, broken imports, missing error handling and security problems, then fix what you find.',
}

export const MAX_INSTRUCTION_CHARS = 3_500

// The request sent to the incremental generator for one task.
export function buildTaskInstruction(
  goal: string,
  summary: string,
  task: PlanTask,
  tasks: PlanTask[],
): string {
  const done = tasks.filter((t) => t.status === 'completed' && t.id !== task.id).map((t) => `- ${t.name}`)
  const lines = [
    `Overall goal: ${goal.slice(0, 800)}`,
    summary ? `Plan summary: ${summary.slice(0, 600)}` : '',
    done.length ? `Already done:\n${done.slice(-12).join('\n')}` : '',
    '',
    `Current task: ${task.name}`,
    task.description ? `Details: ${task.description}` : '',
    TOOL_INSTRUCTIONS[task.tool] ?? TOOL_INSTRUCTIONS['code-generator'],
    'Keep the existing app working. Change only what this task needs.',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0))
  return lines.join('\n').slice(0, MAX_INSTRUCTION_CHARS)
}

// A task that errored: tried again if it has attempts left, otherwise failed.
export function settleFailure(tasks: PlanTask[], id: number, reason: string, now: string): PlanTask[] {
  const t = tasks.find((x) => x.id === id)
  const reasonText = clean(reason, 300) || 'Unknown error'
  if (t && (t.attempts ?? 0) < MAX_ATTEMPTS) {
    return patchTask(tasks, id, { status: 'pending', note: `Attempt ${t.attempts ?? 1} failed: ${reasonText}. Trying again.` })
  }
  return failTask(tasks, id, reasonText, now)
}

// One honest sentence about where the goal stands, shown on the goal card.
export function describeGoal(status: GoalStatus, tasks: PlanTask[]): string {
  const p = computeProgress(tasks)
  switch (status) {
    case 'planned':
      return `Plan ready: ${Math.max(0, p.totalTasks - 1)} tasks. Review it and press Start when you are happy.`
    case 'completed':
      return `All ${p.totalTasks} tasks are finished. Open the project to review the result.`
    case 'cancelled':
      return `Stopped by you after ${p.completedTasks} of ${p.totalTasks} tasks.`
    case 'failed': {
      const failed = tasks.find((t) => t.status === 'failed')
      return failed
        ? `Stopped: "${failed.name}" failed${failed.note ? ` (${failed.note})` : ''}. Retry it or cancel the goal.`
        : 'Stopped because a task could not be completed.'
    }
    case 'waiting': {
      const w = tasks.find((t) => t.status === 'waiting') ?? tasks.find((t) => t.status === 'pending')
      return w ? `Waiting for you: "${w.name}". Do it, then mark it done, or skip it.` : 'Waiting for you.'
    }
    default:
      return p.currentTask ? `Working on "${p.currentTask}" (${p.completedTasks} of ${p.totalTasks} done).` : 'Working.'
  }
}
