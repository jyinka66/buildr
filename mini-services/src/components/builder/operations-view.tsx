'use client'

// OperationsView — 24/7 Operations dashboard (cron + monitoring + auto-heal).
// ------------------------------------------------------------------
// Three tabs:
//   1. Cron Jobs     — list with status badges, enable/disable, Run Now, create form.
//   2. Monitoring    — health cards per project, Check Now button, recent events feed.
//   3. Auto-Heal     — trigger panel + heal action cards with AI diagnosis.
//
// Self-contained — does not depend on editing api-client.ts or store.ts.
// Uses framer-motion + sonner + shadcn/ui.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Heart,
  HeartPulse,
  Loader2,
  PlayCircle,
  Plus,
  Power,
  RefreshCw,
  Stethoscope,
  Timer,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Local API client (we are not allowed to edit api-client.ts).
// ---------------------------------------------------------------------------

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `request_failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

interface CronJob {
  id: string
  name: string
  description: string
  prompt: string
  schedule: string
  scheduleCron: string | null
  enabled: boolean
  projectId: string | null
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: string
  lastOutput: string
  runCount: number
  failCount: number
  createdAt: string
  updatedAt: string
}

interface MonitoringEvent {
  id: string
  projectId: string | null
  kind: string
  status: string
  message: string
  responseMs: number | null
  statusCode: number | null
  url: string | null
  checkedAt: string
}

interface ProjectHealth {
  id: string
  name: string
  slug: string
  projectStatus: string
  url: string | null
  health: 'unknown' | 'ok' | 'degraded' | 'down'
  lastCheckedAt: string | null
  lastStatusCode: number | null
  lastResponseMs: number | null
  lastMessage: string
  updatedAt: string
}

interface HealAction {
  id: string
  projectId: string
  triggerEvent: string
  diagnosis: Record<string, unknown>
  fixApplied: Record<string, unknown>
  status: string
  summary: string
  beforeState: Record<string, unknown>
  afterState: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

const opsApi = {
  async listCron(): Promise<{ jobs: CronJob[] }> {
    const res = await fetch('/api/operations/cron', { cache: 'no-store' })
    return json(res)
  },
  async createCron(body: {
    name: string
    description?: string
    prompt: string
    schedule: string
    scheduleCron?: string
    projectId?: string
    enabled?: boolean
  }): Promise<{ job: CronJob }> {
    const res = await fetch('/api/operations/cron', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
  async patchCron(id: string, patch: Partial<{
    name: string
    description: string
    prompt: string
    schedule: string
    scheduleCron: string
    enabled: boolean
  }>): Promise<{ job: CronJob }> {
    const res = await fetch('/api/operations/cron', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    return json(res)
  },
  async deleteCron(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/operations/cron?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    return json(res)
  },
  async runCron(id: string): Promise<{
    ok: boolean
    status: string
    output: string
    durationMs: number
    job: Partial<CronJob>
  }> {
    const res = await fetch(`/api/operations/cron/${encodeURIComponent(id)}/run`, { method: 'POST' })
    return json(res)
  },
  async listMonitoring(): Promise<{ events: MonitoringEvent[]; health: ProjectHealth[] }> {
    const res = await fetch('/api/operations/monitoring', { cache: 'no-store' })
    return json(res)
  },
  async probe(body: { projectId?: string; url?: string }): Promise<{
    ok: boolean
    status: string
    url: string
    statusCode: number | null
    responseMs: number
    timedOut: boolean
    event: MonitoringEvent
  }> {
    const res = await fetch('/api/operations/monitoring', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
  async listHeal(): Promise<{ actions: HealAction[] }> {
    const res = await fetch('/api/operations/heal', { cache: 'no-store' })
    return json(res)
  },
  async triggerHeal(body: { projectId: string; triggerEvent?: string; note?: string }): Promise<{
    ok: boolean
    action: HealAction
    message: string
  }> {
    const res = await fetch('/api/operations/heal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Display helpers.
// ---------------------------------------------------------------------------

const SCHEDULES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom cron' },
]

const CRON_STATUS_META: Record<string, { label: string; chip: string; icon: React.ReactNode }> = {
  idle: {
    label: 'Idle',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
    icon: <Clock className="h-3 w-3" />,
  },
  running: {
    label: 'Running',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  success: {
    label: 'Success',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
}

const HEALTH_META: Record<string, { label: string; chip: string; dot: string; icon: React.ReactNode }> = {
  unknown: {
    label: 'Unknown',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
    dot: 'bg-zinc-400',
    icon: <Clock className="h-3 w-3" />,
  },
  ok: {
    label: 'Healthy',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  degraded: {
    label: 'Degraded',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  down: {
    label: 'Down',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    dot: 'bg-red-500',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
}

const EVENT_STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
  info: 'bg-sky-500',
}

const HEAL_STATUS_META: Record<string, { label: string; chip: string; icon: React.ReactNode }> = {
  analyzing: {
    label: 'Analyzing',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  applying: {
    label: 'Applying',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  applied: {
    label: 'Diagnosed',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => asString(x)).filter(Boolean) : []
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback
}
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OperationsView() {
  const [tab, setTab] = React.useState<'cron' | 'monitoring' | 'heal'>('cron')

  // Cron state
  const [jobs, setJobs] = React.useState<CronJob[]>([])
  const [loadingJobs, setLoadingJobs] = React.useState(true)
  const [creatingJob, setCreatingJob] = React.useState(false)
  const [runningId, setRunningId] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [showCreate, setShowCreate] = React.useState(false)
  // create form
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [schedule, setSchedule] = React.useState('daily')
  const [scheduleCron, setScheduleCron] = React.useState('')

  // Monitoring state
  const [events, setEvents] = React.useState<MonitoringEvent[]>([])
  const [health, setHealth] = React.useState<ProjectHealth[]>([])
  const [loadingMon, setLoadingMon] = React.useState(true)
  const [probingId, setProbingId] = React.useState<string | null>(null)

  // Heal state
  const [actions, setActions] = React.useState<HealAction[]>([])
  const [loadingHeal, setLoadingHeal] = React.useState(true)
  const [healingId, setHealingId] = React.useState<string | null>(null)
  const [healNote, setHealNote] = React.useState('')

  // ------- loaders
  async function loadJobs() {
    setLoadingJobs(true)
    try {
      const { jobs } = await opsApi.listCron()
      setJobs(jobs)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load cron jobs')
    } finally {
      setLoadingJobs(false)
    }
  }

  async function loadMonitoring() {
    setLoadingMon(true)
    try {
      const { events, health } = await opsApi.listMonitoring()
      setEvents(events)
      setHealth(health)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load monitoring data')
    } finally {
      setLoadingMon(false)
    }
  }

  async function loadHeal() {
    setLoadingHeal(true)
    try {
      const { actions } = await opsApi.listHeal()
      setActions(actions)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load heal actions')
    } finally {
      setLoadingHeal(false)
    }
  }

  React.useEffect(() => { void loadJobs() }, [])

  // Lazy-load the tab's data on first visit.
  React.useEffect(() => {
    if (tab === 'monitoring' && health.length === 0 && events.length === 0) void loadMonitoring()
    if (tab === 'heal' && actions.length === 0) void loadHeal()
  }, [tab])

  // Auto-poll for running cron jobs.
  React.useEffect(() => {
    const hasRunning = jobs.some((j) => j.lastStatus === 'running')
    if (!hasRunning) return
    const interval = setInterval(() => { void loadJobs() }, 5000)
    return () => clearInterval(interval)
  }, [jobs])

  // ------- cron handlers
  async function handleCreateJob() {
    if (name.trim().length < 3) {
      toast.error('Name must be at least 3 characters.')
      return
    }
    if (prompt.trim().length < 10) {
      toast.error('Prompt must be at least 10 characters.')
      return
    }
    setCreatingJob(true)
    const t = toast.loading('Creating cron job…')
    try {
      await opsApi.createCron({
        name: name.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        schedule,
        scheduleCron: schedule === 'custom' ? scheduleCron.trim() : undefined,
        enabled: true,
      })
      toast.dismiss(t)
      toast.success('Cron job created.')
      setName('')
      setDescription('')
      setPrompt('')
      setSchedule('daily')
      setScheduleCron('')
      setShowCreate(false)
      await loadJobs()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Failed to create cron job')
    } finally {
      setCreatingJob(false)
    }
  }

  async function handleToggle(job: CronJob) {
    const t = toast.loading(job.enabled ? 'Disabling…' : 'Enabling…')
    try {
      await opsApi.patchCron(job.id, { enabled: !job.enabled })
      toast.dismiss(t)
      toast.success(job.enabled ? 'Cron disabled.' : 'Cron enabled.')
      await loadJobs()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Failed to toggle')
    }
  }

  async function handleRun(job: CronJob) {
    setRunningId(job.id)
    const t = toast.loading(`Running "${job.name}"…`)
    try {
      const result = await opsApi.runCron(job.id)
      toast.dismiss(t)
      if (result.ok) {
        toast.success(`"${job.name}" completed in ${result.durationMs}ms.`)
      } else {
        toast.error(`"${job.name}" failed.`)
      }
      await loadJobs()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Run failed')
    } finally {
      setRunningId(null)
    }
  }

  async function handleDelete(job: CronJob) {
    if (!confirm(`Delete cron job "${job.name}"? This cannot be undone.`)) return
    const t = toast.loading('Deleting…')
    try {
      await opsApi.deleteCron(job.id)
      toast.dismiss(t)
      toast.success('Cron job deleted.')
      await loadJobs()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // ------- monitoring handlers
  async function handleProbe(project: ProjectHealth) {
    if (!project.url) {
      toast.error('This project has no deployment URL to probe.')
      return
    }
    setProbingId(project.id)
    const t = toast.loading(`Probing ${project.url}…`)
    try {
      const result = await opsApi.probe({ projectId: project.id })
      toast.dismiss(t)
      if (result.ok) {
        toast.success(`Healthy — HTTP ${result.statusCode} in ${result.responseMs}ms.`)
      } else if (result.timedOut) {
        toast.error(`Probe timed out after 10s.`)
      } else {
        toast.error(`Unhealthy — ${result.statusCode ?? 'no response'} in ${result.responseMs}ms.`)
      }
      await loadMonitoring()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Probe failed')
    } finally {
      setProbingId(null)
    }
  }

  // ------- heal handlers
  async function handleTriggerHeal(projectId: string) {
    setHealingId(projectId)
    const t = toast.loading('Running AI diagnosis…')
    try {
      const result = await opsApi.triggerHeal({
        projectId,
        triggerEvent: 'manual',
        note: healNote.trim() || undefined,
      })
      toast.dismiss(t)
      if (result.ok) {
        toast.success('Diagnosis complete.', { description: result.message })
      } else {
        toast.error('Diagnosis had issues.', { description: result.message })
      }
      setHealNote('')
      await loadHeal()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Heal failed')
    } finally {
      setHealingId(null)
    }
  }

  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
            <Activity className="h-5 w-5" />
          </span>
          24/7 Operations
        </motion.h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Schedule autonomous cron jobs, monitor deployments, and let AI auto-heal issues.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="cron" className="gap-1.5 text-xs sm:text-sm">
            <Timer className="h-3.5 w-3.5" /> Cron Jobs
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="gap-1.5 text-xs sm:text-sm">
            <HeartPulse className="h-3.5 w-3.5" /> Monitoring
          </TabsTrigger>
          <TabsTrigger value="heal" className="gap-1.5 text-xs sm:text-sm">
            <Stethoscope className="h-3.5 w-3.5" /> Auto-Heal
          </TabsTrigger>
        </TabsList>

        {/* ─── Cron Jobs tab ─────────────────────────────────────────── */}
        <TabsContent value="cron" className="mt-6">
          {/* Create form (collapsible) */}
          <Card className="mb-4 overflow-hidden">
            <CardHeader
              className="cursor-pointer select-none bg-muted/30"
              onClick={() => setShowCreate((s) => !s)}
            >
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-sky-600" />
                  New Cron Job
                </span>
                <span className="text-xs text-muted-foreground">{showCreate ? 'Cancel' : 'Create'}</span>
              </CardTitle>
            </CardHeader>
            <AnimatePresence>
              {showCreate && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <CardContent className="space-y-3 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="cron-name" className="text-xs">Name</Label>
                        <Input
                          id="cron-name"
                          placeholder="Nightly DB backup"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Schedule</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {SCHEDULES.map((s) => (
                            <button
                              key={s.value}
                              onClick={() => setSchedule(s.value)}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-xs transition',
                                schedule === s.value
                                  ? 'border-sky-400 bg-sky-100 text-sky-700 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                                  : 'border-border text-muted-foreground hover:border-sky-300',
                              )}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                        {schedule === 'custom' && (
                          <Input
                            placeholder="*/5 * * * *"
                            value={scheduleCron}
                            onChange={(e) => setScheduleCron(e.target.value)}
                            className="mt-1.5"
                          />
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cron-desc" className="text-xs">Description (optional)</Label>
                      <Input
                        id="cron-desc"
                        placeholder="What this cron job does"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cron-prompt" className="text-xs">Prompt</Label>
                      <Textarea
                        id="cron-prompt"
                        placeholder="Back up the database, vacuum tables, and report the result."
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="resize-none"
                      />
                    </div>
                    <Button
                      onClick={handleCreateJob}
                      disabled={creatingJob}
                      className="w-full gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 text-white hover:from-sky-700 hover:to-indigo-700"
                    >
                      {creatingJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Create Cron Job
                    </Button>
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>

          {/* Jobs list */}
          {loadingJobs ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                <Timer className="h-8 w-8 text-sky-500/50" />
                <p className="font-medium">No cron jobs yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Create a cron job to schedule an autonomous AI task on a recurring schedule.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const sm = CRON_STATUS_META[job.lastStatus] || CRON_STATUS_META.idle
                const isRunning = job.lastStatus === 'running' || runningId === job.id
                const isExpanded = expandedId === job.id
                return (
                  <motion.div key={job.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <Card className="overflow-hidden">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base">{job.name}</CardTitle>
                              <Badge variant="outline" className={cn('gap-1 text-xs', sm.chip)}>
                                {sm.icon}
                                {sm.label}
                              </Badge>
                              {!job.enabled && (
                                <Badge variant="secondary" className="text-xs">disabled</Badge>
                              )}
                            </div>
                            {job.description && (
                              <CardDescription className="mt-1">{job.description}</CardDescription>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {job.schedule}
                              </span>
                              <span>{job.runCount} runs · {job.failCount} fails</span>
                              {job.lastRunAt && (
                                <span>last run {formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}</span>
                              )}
                              {job.nextRunAt && job.enabled && (
                                <span>next {formatDistanceToNow(new Date(job.nextRunAt), { addSuffix: true })}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              disabled={isRunning}
                              onClick={() => handleRun(job)}
                            >
                              {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                              Run
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => handleToggle(job)}
                              title={job.enabled ? 'Disable' : 'Enable'}
                            >
                              <Power className={cn('h-3.5 w-3.5', job.enabled ? 'text-emerald-600' : 'text-zinc-400')} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                              onClick={() => handleDelete(job)}
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : job.id)}
                          className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400"
                        >
                          {isExpanded ? 'Hide output' : 'View last output'}
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                                {job.lastOutput || '(no output yet)'}
                              </pre>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── Monitoring tab ────────────────────────────────────────── */}
        <TabsContent value="monitoring" className="mt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Project Health
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => void loadMonitoring()}
              disabled={loadingMon}
            >
              <RefreshCw className={cn('h-3 w-3', loadingMon && 'animate-spin')} />
              Refresh
            </Button>
          </div>

          {loadingMon ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : health.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                <Heart className="h-8 w-8 text-rose-500/50" />
                <p className="font-medium">No projects to monitor</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Deploy a project to start receiving health probes.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {health.map((p) => {
                const hm = HEALTH_META[p.health] || HEALTH_META.unknown
                const isProbing = probingId === p.id
                return (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', hm.dot)} />
                              <p className="truncate text-sm font-medium">{p.name}</p>
                            </div>
                            {p.url ? (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 block truncate text-xs text-sky-600 hover:underline dark:text-sky-400"
                              >
                                {p.url}
                              </a>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">No deployment URL</p>
                            )}
                          </div>
                          <Badge variant="outline" className={cn('gap-1 text-xs', hm.chip)}>
                            {hm.icon}
                            {hm.label}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="text-[10px] uppercase text-muted-foreground">Status</p>
                            <p className="font-medium tabular-nums">{p.lastStatusCode ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-muted-foreground">Latency</p>
                            <p className="font-medium tabular-nums">{p.lastResponseMs != null ? `${p.lastResponseMs}ms` : '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-muted-foreground">Checked</p>
                            <p className="font-medium">
                              {p.lastCheckedAt ? formatDistanceToNow(new Date(p.lastCheckedAt), { addSuffix: true }) : '—'}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 h-7 w-full gap-1 text-xs"
                          onClick={() => handleProbe(p)}
                          disabled={isProbing || !p.url}
                        >
                          {isProbing ? <Loader2 className="h-3 w-3 animate-spin" /> : <HeartPulse className="h-3 w-3" />}
                          Check Now
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Recent events feed */}
          {events.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Recent Events
              </h2>
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y divide-border">
                    {events.slice(0, 20).map((ev) => (
                      <li key={ev.id} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                        <span
                          className={cn(
                            'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full',
                            EVENT_STATUS_DOT[ev.status] || 'bg-zinc-400',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground">{ev.message}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            <span className="uppercase">{ev.kind}</span>
                            {ev.statusCode != null && ` · HTTP ${ev.statusCode}`}
                            {ev.responseMs != null && ` · ${ev.responseMs}ms`}
                            {' · '}{formatDistanceToNow(new Date(ev.checkedAt), { addSuffix: true })}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── Auto-Heal tab ─────────────────────────────────────────── */}
        <TabsContent value="heal" className="mt-6">
          {/* Trigger panel */}
          <Card className="mb-4 overflow-hidden">
            <CardHeader className="bg-gradient-to-br from-rose-50/50 to-orange-50/30 dark:from-rose-950/10 dark:to-orange-950/10">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4 text-rose-600" />
                Trigger AI Diagnosis
              </CardTitle>
              <CardDescription>
                Select a project — AI will review recent monitoring events + the file manifest and propose a fix.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {health.length === 0 && !loadingMon ? (
                <p className="text-xs text-muted-foreground">
                  Load the Monitoring tab first to populate projects, or refresh.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="heal-note" className="text-xs">Operator note (optional)</Label>
                  <Input
                    id="heal-note"
                    placeholder="e.g. 500 errors started after the last deploy"
                    value={healNote}
                    onChange={(e) => setHealNote(e.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {health.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={healingId === p.id}
                    onClick={() => handleTriggerHeal(p.id)}
                  >
                    {healingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    {p.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Heal action cards */}
          {loadingHeal ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : actions.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                <Stethoscope className="h-8 w-8 text-rose-500/50" />
                <p className="font-medium">No heal actions yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Trigger a diagnosis above to let AI investigate the root cause of issues.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {actions.map((a) => {
                const sm = HEAL_STATUS_META[a.status] || HEAL_STATUS_META.analyzing
                const diag = asObject(a.diagnosis)
                const rootCause = asString(diag?.rootCause)
                const confidence = asNumber(diag?.confidence, -1)
                const severity = asString(diag?.severity, 'medium')
                const evidence = asStringArray(diag?.evidence)
                const fix = asObject(diag?.recommendedFix)
                const steps = asStringArray(fix?.steps)
                const risks = asStringArray(fix?.risks)
                const project = health.find((p) => p.id === a.projectId)
                return (
                  <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <span className="truncate">{project?.name || a.projectId}</span>
                              <Badge variant="outline" className={cn('gap-1 text-xs', sm.chip)}>
                                {sm.icon}
                                {sm.label}
                              </Badge>
                            </CardTitle>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Trigger: {a.triggerEvent} · {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          {confidence >= 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {Math.round(confidence * 100)}% confidence
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        {a.summary && (
                          <p className="text-sm text-muted-foreground">{a.summary}</p>
                        )}
                        {severity && severity !== 'medium' && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs',
                              severity === 'critical' && 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
                              severity === 'high' && 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                              severity === 'low' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                            )}
                          >
                            severity: {severity}
                          </Badge>
                        )}
                        {evidence.length > 0 && (
                          <div>
                            <p className="mb-1 text-[10px] uppercase text-muted-foreground">Evidence</p>
                            <ul className="space-y-0.5 text-xs">
                              {evidence.map((e, i) => (
                                <li key={i} className="flex gap-1.5">
                                  <span className="text-emerald-500">•</span>
                                  <span>{e}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {steps.length > 0 && (
                          <div>
                            <p className="mb-1 text-[10px] uppercase text-muted-foreground">Recommended Fix</p>
                            <ol className="space-y-0.5 text-xs">
                              {steps.map((s, i) => (
                                <li key={i} className="flex gap-1.5">
                                  <span className="font-medium text-sky-600 dark:text-sky-400">{i + 1}.</span>
                                  <span>{s}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                        {risks.length > 0 && (
                          <div>
                            <p className="mb-1 text-[10px] uppercase text-muted-foreground">Risks</p>
                            <ul className="space-y-0.5 text-xs">
                              {risks.map((r, i) => (
                                <li key={i} className="flex gap-1.5">
                                  <span className="text-amber-500">!</span>
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
