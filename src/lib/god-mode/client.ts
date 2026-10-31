// Browser-side helpers for the God Mode API (/api/god-mode).
import type { GoalDetail, GoalSummary } from '@/lib/god-mode/view'

export type { GoalDetail, GoalSummary }

export interface PlanEditTask {
  id?: number
  name: string
  description: string
  tool: string
  dependencies: number[]
}

export type StepOutcome = 'ran' | 'idle' | 'busy' | 'limit'
export type StepResult = GoalDetail & { outcome: StepOutcome; message?: string }

export class GodModeError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message?: string) {
    super(message || code)
    this.status = status
    this.code = code
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : `request_failed_${res.status}`
    // Prefer the server's plain-language message when it sent one.
    const message = typeof data.message === 'string' ? data.message : typeof data.error === 'string' && data.error.includes(' ') ? data.error : undefined
    throw new GodModeError(res.status, code, message)
  }
  return data as T
}

const patch = (id: string, body: Record<string, unknown>) =>
  call<GoalDetail>(`/api/god-mode/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })

export const godMode = {
  list: () => call<{ goals: GoalSummary[] }>('/api/god-mode').then((r) => r.goals),
  plan: (goal: string, timeframeHours: number) =>
    call<GoalDetail & { goalId: string }>('/api/god-mode', {
      method: 'POST',
      body: JSON.stringify({ goal, timeframeHours }),
    }),
  get: (id: string) => call<GoalDetail>(`/api/god-mode/${encodeURIComponent(id)}`),
  step: (id: string) => call<StepResult>(`/api/god-mode/${encodeURIComponent(id)}/step`, { method: 'POST' }),
  updatePlan: (id: string, tasks: PlanEditTask[], goal?: string) =>
    patch(id, { action: 'update_plan', tasks, ...(goal !== undefined ? { goal } : {}) }),
  approve: (id: string) => patch(id, { action: 'approve' }),
  cancel: (id: string) => patch(id, { action: 'cancel' }),
  task: (id: string, taskId: number, op: 'complete' | 'skip' | 'retry') =>
    patch(id, { action: 'task', taskId, op }),
  remove: (id: string) => call<{ ok: true }>(`/api/god-mode/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
