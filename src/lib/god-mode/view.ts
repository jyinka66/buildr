// Shapes a god_mode_goals row for the API. Pure (no database access).
import {
  computeProgress,
  describeGoal,
  readJson,
  type GoalStatus,
  type PlanTask,
} from '@/lib/god-mode/plan'

export interface GoalRow {
  id: string
  goal: string
  timeframe_hours: number
  task_graph: unknown
  progress: unknown
  current_task: string | null
  status: string
  project_id: string | null
  result_summary: string | null
  created_at: string
  updated_at: string
  lease_until?: string | null
}

export interface PlanMeta {
  summary: string
  deliverables: string[]
  successCriteria: string[]
}

export function readTasks(row: Pick<GoalRow, 'task_graph'>): PlanTask[] {
  const tasks = readJson<PlanTask[]>(row.task_graph, [])
  return Array.isArray(tasks) ? tasks : []
}

export function readPlanMeta(row: Pick<GoalRow, 'progress'>): PlanMeta {
  const progress = readJson<{ plan?: Partial<PlanMeta> }>(row.progress, {})
  const plan = progress.plan ?? {}
  return {
    summary: typeof plan.summary === 'string' ? plan.summary : '',
    deliverables: Array.isArray(plan.deliverables) ? plan.deliverables : [],
    successCriteria: Array.isArray(plan.successCriteria) ? plan.successCriteria : [],
  }
}

const iso = (v: string | null | undefined): string | null => (v ? new Date(v).toISOString() : null)

export function toGoalSummary(row: GoalRow) {
  const tasks = readTasks(row)
  const status = row.status as GoalStatus
  const progress = computeProgress(tasks)
  return {
    id: row.id,
    goal: row.goal,
    timeframeHours: row.timeframe_hours,
    status,
    currentTask: progress.currentTask,
    resultSummary: describeGoal(status, tasks),
    projectId: row.project_id,
    progress: { completedTasks: progress.completedTasks, totalTasks: progress.totalTasks },
    taskCount: tasks.length,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export function toGoalDetail(row: GoalRow) {
  const tasks = readTasks(row)
  const leaseUntil = iso(row.lease_until)
  return {
    goal: {
      ...toGoalSummary(row),
      // A step is being worked on right now (the lease has not expired).
      busy: !!leaseUntil && new Date(leaseUntil).getTime() > Date.now(),
    },
    taskGraph: tasks,
    progress: computeProgress(tasks),
    plan: readPlanMeta(row),
  }
}

export type GoalSummary = ReturnType<typeof toGoalSummary>
export type GoalDetail = ReturnType<typeof toGoalDetail>
