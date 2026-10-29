'use client'

// GodModeView — the autonomous AI agent console.
// ------------------------------------------------------------------
// The user sets a goal + timeframe. AI decomposes it into a task graph,
// then begins executing by generating a complete codebase.
//
// Flow:
//   1. User enters a goal + picks a timeframe (1h / 4h / 12h / 24h / 3d / 7d)
//   2. Click "Activate God Mode" → AI decomposes into tasks + starts generating
//   3. Goals list shows all active/completed goals with progress bars
//   4. Click a goal to expand → see the full task graph with statuses

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  Clock,
  Loader2,
  Target,
  Zap,
  Rocket,
  Circle,
  PlayCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  'Generate an e-commerce store with product grid, cart, and Stripe checkout',
  'Build a blog platform with markdown editor, tags, and SEO optimization',
]

const STATUS_META: Record<string, { label: string; chip: string; icon: React.ReactNode }> = {
  queued: {
    label: 'Queued',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
    icon: <Clock className="h-3 w-3" />,
  },
  running: {
    label: 'Running',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  completed: {
    label: 'Completed',
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    icon: <Circle className="h-3 w-3" />,
  },
}

const TASK_STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-zinc-400" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  failed: <Circle className="h-3.5 w-3.5 text-red-500" />,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => asString(x)).filter(Boolean) : []
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GodModeView() {
  const [goal, setGoal] = React.useState('')
  const [timeframe, setTimeframe] = React.useState(24)
  const [activating, setActivating] = React.useState(false)
  const [goals, setGoals] = React.useState<{
    id: string; goal: string; timeframeHours: number; status: string
    currentTask: string | null; resultSummary: string
    projectId: string | null
    progress: { completedTasks: number; totalTasks: number }
    taskCount: number; createdAt: string
  }[]>([])
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [expandedTasks, setExpandedTasks] = React.useState<Record<string, unknown>[]>([])
  const [loadingTasks, setLoadingTasks] = React.useState(false)

  const openBuilder = useBuilder((s) => s.openBuilder)

  async function loadGoals() {
    try {
      const { goals } = await api.listGodModeGoals()
      setGoals(goals)
    } catch {
      /* non-fatal */
    }
  }

  React.useEffect(() => {
    void loadGoals()
  }, [])

  // Auto-poll for running goals.
  React.useEffect(() => {
    const hasRunning = goals.some((g) => g.status === 'running' || g.status === 'queued')
    if (!hasRunning) return
    const interval = setInterval(() => {
      void loadGoals()
    }, 5000)
    return () => clearInterval(interval)
  }, [goals])

  async function handleActivate() {
    if (goal.trim().length < 10) {
      toast.error('Please describe your goal in detail (at least 10 characters).')
      return
    }
    setActivating(true)
    const t = toast.loading('Activating God Mode…')
    try {
      const result = await api.createGodModeGoal({
        goal: goal.trim(),
        timeframeHours: timeframe,
      })
      toast.dismiss(t)
      toast.success('God Mode activated!', {
        description: `${result.taskGraph.length} tasks queued. ${result.filesGenerated} files generated.`,
      })
      setGoal('')
      await loadGoals()
      setExpandedId(result.goalId)
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Activation failed. Please try again.')
    } finally {
      setActivating(false)
    }
  }

  async function handleExpand(goalId: string) {
    if (expandedId === goalId) {
      setExpandedId(null)
      return
    }
    setExpandedId(goalId)
    setLoadingTasks(true)
    try {
      const { taskGraph } = await api.getGodModeStatus(goalId)
      setExpandedTasks(taskGraph)
    } catch {
      setExpandedTasks([])
    } finally {
      setLoadingTasks(false)
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
          Set a goal. AI decomposes it into tasks and executes autonomously —
          generating a complete codebase. You just review the result.
        </p>
      </div>

      {/* Goal input */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-fuchsia-50/50 to-purple-50/30 dark:from-fuchsia-950/10 dark:to-purple-950/10">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-fuchsia-600" />
            What should the AI build?
          </CardTitle>
          <CardDescription>
            Describe a goal. Be specific — the AI will plan tasks and generate code.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Textarea
            placeholder="e.g. Build a complete SaaS landing page with pricing, testimonials, and a contact form"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="resize-none"
            maxLength={500}
          />

          {/* Timeframe selector */}
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

          {/* Examples */}
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Or try an example:</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setGoal(ex)}
                  className="rounded-md border border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground transition hover:border-fuchsia-300 hover:text-foreground"
                >
                  {ex.slice(0, 50)}…
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleActivate}
            disabled={activating || goal.trim().length < 10}
            className="w-full gap-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-700 hover:to-purple-700"
            size="lg"
          >
            {activating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
            Activate God Mode
          </Button>
        </CardContent>
      </Card>

      {/* Goals list */}
      {goals.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium">Your Goals ({goals.length})</h2>
          <div className="space-y-3">
            {goals.map((g) => {
              const pct = g.progress.totalTasks > 0
                ? Math.round((g.progress.completedTasks / g.progress.totalTasks) * 100)
                : 0
              const isRunning = g.status === 'running'
              const sm = STATUS_META[g.status] || STATUS_META.queued
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
                            <span className="text-xs text-muted-foreground">
                              · {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          {isRunning && g.currentTask && (
                            <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Working on: {g.currentTask}
                            </p>
                          )}
                          {g.resultSummary && !isRunning && (
                            <p className="mt-1 text-xs text-muted-foreground">{g.resultSummary}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          {g.projectId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => openBuilder(g.projectId!)}
                            >
                              <Rocket className="h-3 w-3" />
                              Open
                            </Button>
                          )}
                          <button
                            onClick={() => handleExpand(g.id)}
                            className="text-xs text-fuchsia-600 hover:text-fuchsia-700 dark:text-fuchsia-400"
                          >
                            {isExpanded ? 'Hide tasks' : 'View tasks'}
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Progress value={pct} className="h-1.5" />
                      <p className="mt-1 text-right text-[10px] text-muted-foreground">{pct}%</p>

                      {/* Expanded task graph */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-4 space-y-1.5">
                              {loadingTasks ? (
                                <div className="flex h-16 items-center justify-center">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                              ) : (
                                expandedTasks.map((task, i) => {
                                  const name = asString(task.name)
                                  const desc = asString(task.description)
                                  const status = asString(task.status, 'pending')
                                  const tool = asString(task.tool)
                                  const minutes = asNumber(task.estimatedMinutes)
                                  return (
                                    <div
                                      key={i}
                                      className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs"
                                    >
                                      <span className="mt-0.5 flex-shrink-0">{TASK_STATUS_ICON[status]}</span>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">{name}</span>
                                          {tool && (
                                            <Badge variant="outline" className="text-[10px]">{tool}</Badge>
                                          )}
                                          {minutes > 0 && (
                                            <span className="text-[10px] text-muted-foreground">~{minutes}min</span>
                                          )}
                                        </div>
                                        <p className="mt-0.5 text-muted-foreground">{desc}</p>
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {goals.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <Zap className="h-10 w-10 text-fuchsia-500/50" />
            <p className="font-medium">No goals yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Activate God Mode to set an autonomous goal. The AI will decompose it into tasks and generate the code.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
