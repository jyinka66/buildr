'use client'

// GodModeView — the autonomous AI agent console.
// ------------------------------------------------------------------
// 1. Describe a goal. The AI makes a PLAN (a list of tasks). Nothing is built yet.
// 2. Review and edit the plan, then press "Start building".
// 3. Tasks run one at a time, changing the project's files. While this page is
//    open it drives the run and shows live progress. Tasks that need the
//    person (deploying, images, manual work) pause until they are marked done
//    or skipped. Failed tasks can be retried; the whole goal can be cancelled.
//
// The server keeps the state, so a goal survives closing the page; it keeps
// going for a while on its own and picks up again when the page is reopened.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  Hand,
  Loader2,
  MinusCircle,
  Rocket,
  Target,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

import { godMode, GodModeError, type GoalDetail, type GoalSummary } from '@/lib/god-mode/client'
import { isAutoTool, type PlanTask } from '@/lib/god-mode/plan'
import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'

import { PlanEditor, TOOL_LABELS } from '@/components/builder/god-mode-plan-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEFRAMES = [
  { value: 1, label: '1 hour' },
  { value: 4, label: '4 hours' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
]

const EXAMPLES = [
  'Build a complete SaaS landing page with pricing, testimonials, and a contact form',
  'Create a task management dashboard with drag-and-drop columns and real-time updates',
  'Generate an e-commerce store with product grid, cart, and checkout',
  'Build a blog platform with markdown editor, tags, and SEO optimization',
]

const STATUS_META: Record<string, { label: string; chip: string; icon: React.ReactNode }> = {
  planned: {
    label: 'Plan ready',
    chip: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    icon: <ClipboardList className="h-3 w-3" />,
  },
  running: {
    label: 'Running',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  waiting: {
    label: 'Needs you',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    icon: <Hand className="h-3 w-3" />,
  },
  completed: {
    label: 'Completed',
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    icon: <XCircle className="h-3 w-3" />,
  },
  cancelled: {
    label: 'Cancelled',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
    icon: <Ban className="h-3 w-3" />,
  },
}

const TASK_ICON: Record<string, React.ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-zinc-400" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  skipped: <MinusCircle className="h-3.5 w-3.5 text-zinc-400" />,
  waiting: <Hand className="h-3.5 w-3.5 text-amber-500" />,
}

const ACTIVE = new Set(['running', 'waiting'])
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Run panel: a goal that has started
// ---------------------------------------------------------------------------

function RunPanel({
  detail,
  pendingTask,
  onTask,
  onCancel,
  onDelete,
}: {
  detail: GoalDetail
  pendingTask: string | null
  onTask: (task: PlanTask, op: 'complete' | 'skip' | 'retry') => void
  onCancel: () => void
  onDelete: () => void
}) {
  const { goal, taskGraph } = detail
  const canCancel = ['running', 'waiting', 'failed'].includes(goal.status)
  const canDelete = goal.status !== 'running'

  return (
    <div className="mt-4 space-y-3">
      {goal.status === 'running' ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          Building one task at a time. It keeps going while this page is open. If Buildr's server goes to sleep it
          pauses, and carries on when you open this page again.
        </div>
      ) : null}

      <div className="space-y-1.5">
        {taskGraph.map((task) => {
          const waiting = task.status === 'waiting'
          const failed = task.status === 'failed'
          const key = `${task.id}`
          return (
            <div
              key={task.id}
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 text-xs',
                waiting ? 'border-amber-300 bg-amber-50/50 dark:border-amber-700/50 dark:bg-amber-500/5' : 'border-border bg-muted/20',
                failed && 'border-red-300 bg-red-50/50 dark:border-red-700/50 dark:bg-red-500/5',
              )}
            >
              <span className="mt-0.5 shrink-0">{TASK_ICON[task.status] ?? TASK_ICON.pending}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{task.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {TOOL_LABELS[task.tool] ?? task.tool}
                  </Badge>
                  {!isAutoTool(task.tool) && task.status === 'pending' ? (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">pauses for you</span>
                  ) : null}
                </div>
                {task.description ? <p className="mt-0.5 text-muted-foreground">{task.description}</p> : null}
                {task.note ? (
                  <p className={cn('mt-0.5', failed ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{task.note}</p>
                ) : null}
                {waiting || failed ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {waiting ? (
                      <>
                        <Button size="sm" className="h-7 text-xs" disabled={pendingTask === key} onClick={() => onTask(task, 'complete')}>
                          {pendingTask === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          Mark done
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pendingTask === key} onClick={() => onTask(task, 'skip')}>
                          Skip
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pendingTask === key} onClick={() => onTask(task, 'retry')}>
                        {pendingTask === key ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Retry this task
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {canCancel || canDelete ? (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {canDelete ? (
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Delete goal
            </Button>
          ) : null}
          {canCancel ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onCancel}>
              <Ban className="h-3.5 w-3.5" /> Cancel goal
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GodModeView() {
  const [goalText, setGoalText] = React.useState('')
  const [timeframe, setTimeframe] = React.useState(24)
  const [planning, setPlanning] = React.useState(false)
  const [goals, setGoals] = React.useState<GoalSummary[]>([])
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<GoalDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [pendingTask, setPendingTask] = React.useState<string | null>(null)

  const openBuilder = useBuilder((s) => s.openBuilder)

  const refreshList = React.useCallback(async () => {
    try {
      setGoals(await godMode.list())
    } catch {
      /* non-fatal: the list just stays as it was */
    }
  }, [])

  React.useEffect(() => {
    void refreshList()
  }, [refreshList])

  // Keep the list fresh while anything is active.
  React.useEffect(() => {
    if (!goals.some((g) => ACTIVE.has(g.status))) return
    const interval = setInterval(() => void refreshList(), 6000)
    return () => clearInterval(interval)
  }, [goals, refreshList])

  // Show a new detail and keep that goal's card in the list in step with it.
  const applyDetail = React.useCallback((d: GoalDetail) => {
    setDetail((prev) => (prev && prev.goal.id !== d.goal.id ? prev : d))
    setGoals((prev) => prev.map((g) => (g.id === d.goal.id ? { ...g, ...d.goal } : g)))
  }, [])

  // While the open goal is running, this page drives it: ask for the next task,
  // repeat until it stops, and wait quietly if the server is already busy.
  const runningId = detail && detail.goal.status === 'running' ? detail.goal.id : null
  React.useEffect(() => {
    if (!runningId) return
    let cancelled = false
    void (async () => {
      let failures = 0
      while (!cancelled) {
        try {
          const result = await godMode.step(runningId)
          if (cancelled) return
          failures = 0
          applyDetail(result)
          if (result.goal.status !== 'running') return
          if (result.outcome === 'limit') {
            setNotice(result.message ?? 'Your plan limit was reached. Upgrade, then reopen this goal.')
            return
          }
          if (result.outcome === 'busy' || result.outcome === 'idle') await sleep(4000)
        } catch (err) {
          if (cancelled) return
          if (err instanceof GodModeError && err.code === 'god_mode_migration_needed') {
            setNotice(err.message)
            return
          }
          if (err instanceof GodModeError && (err.status === 404 || err.status === 401)) return
          failures += 1
          if (failures >= 3) {
            setNotice('Lost contact with the server. Reopen this goal to continue.')
            return
          }
          await sleep(3000 * failures)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runningId, applyDetail])

  async function handlePlan() {
    if (goalText.trim().length < 10) {
      toast.error('Please describe your goal in detail (at least 10 characters).')
      return
    }
    setPlanning(true)
    setNotice(null)
    const t = toast.loading('Making a plan…')
    try {
      const result = await godMode.plan(goalText.trim(), timeframe)
      toast.dismiss(t)
      toast.success('Plan ready. Review it, then start building.')
      setGoalText('')
      await refreshList()
      setExpandedId(result.goal.id)
      setDetail(result)
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Could not make a plan. Please try again.')
    } finally {
      setPlanning(false)
    }
  }

  async function handleExpand(id: string) {
    setNotice(null)
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
      return
    }
    setExpandedId(id)
    setDetail(null)
    setLoadingDetail(true)
    try {
      const d = await godMode.get(id)
      setDetail((prev) => (prev === null ? d : prev))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open that goal.')
      setExpandedId(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  async function handleTask(task: PlanTask, op: 'complete' | 'skip' | 'retry') {
    if (!detail) return
    setPendingTask(String(task.id))
    try {
      applyDetail(await godMode.task(detail.goal.id, task.id, op))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work. Please try again.')
    } finally {
      setPendingTask(null)
    }
  }

  async function handleCancel() {
    if (!detail || !window.confirm('Cancel this goal? What was built so far stays in the project.')) return
    try {
      applyDetail(await godMode.cancel(detail.goal.id))
      toast.success('Goal cancelled.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the goal.')
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this goal? The project it made is kept.')) return
    try {
      await godMode.remove(id)
      setGoals((prev) => prev.filter((g) => g.id !== id))
      setExpandedId(null)
      setDetail(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the goal.')
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight md:text-4xl"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white">
            <Zap className="h-5 w-5" />
          </span>
          God Mode
        </motion.h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
          Set a goal. The AI makes a plan you can review and change, then builds it one task at a time.
        </p>
      </div>

      {/* Goal input */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-fuchsia-50/50 to-purple-50/30 dark:from-fuchsia-950/10 dark:to-purple-950/10">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-fuchsia-600" />
            What should the AI build?
          </CardTitle>
          <CardDescription>Be specific. You will see the plan before anything is built.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Textarea
            placeholder="e.g. Build a complete SaaS landing page with pricing, testimonials, and a contact form"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            rows={3}
            className="resize-none"
            maxLength={1000}
          />

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Timeframe</p>
            <div className="flex flex-wrap gap-2">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => setTimeframe(tf.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition',
                    timeframe === tf.value
                      ? 'border-fuchsia-400 bg-fuchsia-100 text-fuchsia-700 dark:border-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300'
                      : 'border-border text-muted-foreground hover:border-fuchsia-300',
                  )}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Or try an example:</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setGoalText(ex)}
                  className="rounded-md border border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-fuchsia-300 hover:text-foreground"
                >
                  {ex.slice(0, 50)}…
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handlePlan}
            disabled={planning || goalText.trim().length < 10}
            className="w-full gap-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-700 hover:to-purple-700"
            size="lg"
          >
            {planning ? <Loader2 className="h-5 w-5 animate-spin" /> : <ClipboardList className="h-5 w-5" />}
            Make a plan
          </Button>
        </CardContent>
      </Card>

      {notice ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      {/* Goals list */}
      {goals.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-medium">Your goals ({goals.length})</h2>
          <div className="space-y-3">
            {goals.map((g) => {
              const pct = g.progress.totalTasks > 0 ? Math.round((g.progress.completedTasks / g.progress.totalTasks) * 100) : 0
              const sm = STATUS_META[g.status] ?? STATUS_META.planned
              const isExpanded = expandedId === g.id
              return (
                <motion.div key={g.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="line-clamp-2 text-base">{g.goal}</CardTitle>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={cn('gap-1 text-xs', sm.chip)}>
                              {sm.icon}
                              {sm.label}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              <Clock className="mr-1 h-2.5 w-2.5" />
                              {g.timeframeHours}h
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {g.progress.completedTasks} / {g.progress.totalTasks} tasks
                            </span>
                            {g.createdAt ? (
                              <span className="text-xs text-muted-foreground">
                                · {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                              </span>
                            ) : null}
                          </div>
                          {g.resultSummary ? <p className="mt-1.5 text-xs text-muted-foreground">{g.resultSummary}</p> : null}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {g.projectId ? (
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openBuilder(g.projectId!)}>
                              <Rocket className="h-3 w-3" />
                              Open
                            </Button>
                          ) : null}
                          <button
                            onClick={() => void handleExpand(g.id)}
                            className="text-xs text-fuchsia-600 hover:text-fuchsia-700 dark:text-fuchsia-400"
                          >
                            {isExpanded ? 'Hide' : g.status === 'planned' ? 'Review plan' : 'View tasks'}
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {g.status !== 'planned' ? (
                        <>
                          <Progress value={pct} className="h-1.5" />
                          <p className="mt-1 text-right text-[10px] text-muted-foreground">{pct}%</p>
                        </>
                      ) : null}

                      <AnimatePresence initial={false}>
                        {isExpanded ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            {loadingDetail || !detail || detail.goal.id !== g.id ? (
                              <div className="flex h-16 items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : detail.goal.status === 'planned' ? (
                              <PlanEditor
                                detail={detail}
                                onStarted={(d) => {
                                  setDetail(d)
                                  void refreshList()
                                }}
                                onDiscarded={() => {
                                  setGoals((prev) => prev.filter((x) => x.id !== g.id))
                                  setExpandedId(null)
                                  setDetail(null)
                                }}
                              />
                            ) : (
                              <RunPanel
                                detail={detail}
                                pendingTask={pendingTask}
                                onTask={(task, op) => void handleTask(task, op)}
                                onCancel={() => void handleCancel()}
                                onDelete={() => void handleDelete(g.id)}
                              />
                            )}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <Zap className="h-10 w-10 text-fuchsia-500/50" />
            <p className="font-medium">No goals yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Describe a goal and the AI will make a plan for you to review before anything is built.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
