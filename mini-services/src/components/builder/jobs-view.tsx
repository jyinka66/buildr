'use client'

// Jobs view — the Freelance Job Engine.
// New job form + job list with status badges + AI scope preview + execute/open/download actions.
// Expanded job detail panel with four sections:
//   A. Client Portal Link   — generate a shareable no-sign-in portal URL
//   B. Contract & Invoice   — generate a written contract + a line-item invoice
//   C. Milestone Delivery   — vertical timeline with approve/reject per milestone
//   D. Payments (Paystack)  — collect deposit / milestone / final payments
//
// Backend contract (see api-client.ts):
//   - api.createJob({ title, description, jobType?, clientName?, clientEmail?, budget?, deadline? })
//       -> { ok, job: Record<string, unknown> }
//   - api.listJobs()
//       -> { jobs: [{ id, title, description, jobType, clientName, status, budget, createdAt }] }
//   - api.executeJob(jobId)
//       -> { ok, jobId, projectId, status, deliverables, fileCount, message }
//   - api.getClientPortal(jobId, token)
//       -> { job, scope, tasks, deliverables, projectId }
//   - api.generateContract(jobId, { hourlyRate?, paymentTerms? })
//       -> { ok, contract, estimatedCost, hourlyRate, paymentTerms }
//   - api.generateInvoice(jobId, { hourlyRate?, taxRate? })
//       -> { ok, invoice: Record<string, unknown> }
//   - api.getMilestones(jobId)
//       -> { milestones: [{ number, name, tasks, status, paymentPercentage }] }
//   - api.updateMilestone(jobId, { milestoneIndex, action, feedback? })
//       -> { ok, action, milestoneIndex }

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Check,
  CreditCard,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderGit2,
  Link2,
  ListChecks,
  Loader2,
  Milestone,
  Play,
  Plus,
  Receipt,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Users,
  Wallet,
  X,
  XCircle,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import LeadsView from './leads-view'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JobType =
  | 'website'
  | 'api'
  | 'mobile'
  | 'ecommerce'
  | 'dashboard'
  | 'blog'
  | 'landing'

interface JobSummary {
  id: string
  title: string
  description: string
  jobType: string
  clientName: string | null
  status: string
  budget: number | null
  createdAt: string
}

interface ScopeTask {
  title: string
  status?: string
  dependencies?: string[]
}

interface JobScope {
  summary: string
  stack: string[]
  estimatedHours: number
  complexity: string
  deliverables: string[]
  tasks: ScopeTask[]
}

interface JobRecord {
  id: string
  title: string
  description: string
  jobType: string
  clientName?: string | null
  clientEmail?: string | null
  status: string
  budget?: number | null
  deadline?: string | null
  createdAt: string
  projectId?: string | null
  scope?: JobScope | null
  scopeSummary?: string
  fileCount?: number
}

interface InvoiceLineItem {
  description: string
  hours: number
  rate: number
  amount: number
}

interface InvoiceParty {
  name: string
  lines: string[]
}

interface InvoiceData {
  invoiceNumber: string
  date: string
  dueDate: string
  from: InvoiceParty
  to: InvoiceParty
  lineItems: InvoiceLineItem[]
  subtotal: number
  tax: number
  taxRate: number
  total: number
}

interface MilestoneTask {
  title: string
  status: string
}

interface Milestone {
  number: number
  name: string
  tasks: MilestoneTask[]
  status: string
  paymentPercentage: number
}

interface ContractResult {
  contract: string
  estimatedCost: number
  hourlyRate: number
  paymentTerms: string
}

interface PaymentRow {
  id: string
  reference: string
  amountKobo: number
  currency: string
  status: string
  type: string
  milestoneIndex: number | null
  customerEmail: string | null
  authorizationUrl: string | null
  paidAt: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'api', label: 'API / Backend' },
  { value: 'mobile', label: 'Mobile app' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'blog', label: 'Blog' },
  { value: 'landing', label: 'Landing page' },
]

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  intake: {
    label: 'Intake',
    className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-700',
  },
  planning: {
    label: 'Planning',
    className: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-700',
  },
  executing: {
    label: 'Executing',
    className: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-700',
  },
  reviewing: {
    label: 'Reviewing',
    className: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-700',
  },
  delivered: {
    label: 'Delivered',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-700',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-700',
  },
}

const DEFAULT_STATUS = {
  label: 'Draft',
  className: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
}

const PAYMENT_TERMS = ['50/50', '100% upfront', 'Net 15', 'Net 30'] as const

const MILESTONE_STATUS: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
  },
  running: {
    label: 'In progress',
    className: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-700',
  },
  in_progress: {
    label: 'In progress',
    className: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-700',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-700',
  },
  approved: {
    label: 'Approved',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-700',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-700',
  },
}

const DEFAULT_MILESTONE_STATUS = MILESTONE_STATUS.pending

const PAYMENT_TYPES = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'final', label: 'Final' },
] as const

const PAYMENT_STATUS: Record<string, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-700',
  },
  success: {
    label: 'Success',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-700',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-700',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
  },
}

const DEFAULT_PAYMENT_STATUS = PAYMENT_STATUS.pending

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function JobsView() {
  const openBuilder = useBuilder((s) => s.openBuilder)

  const [formOpen, setFormOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [jobs, setJobs] = React.useState<JobSummary[]>([])
  const [loading, setLoading] = React.useState(true)
  const [executingId, setExecutingId] = React.useState<string | null>(null)
  const [scopeFor, setScopeFor] = React.useState<string | null>(null)
  const [scope, setScope] = React.useState<JobScope | null>(null)
  const [scopeLoading, setScopeLoading] = React.useState(false)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<'jobs' | 'leads'>('jobs')

  React.useEffect(() => {
    void refreshJobs()
  }, [])

  async function refreshJobs() {
    setLoading(true)
    try {
      const data = await api.listJobs()
      setJobs(data.jobs)
    } catch (err) {
      toast.error('Failed to load jobs', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(input: {
    title: string
    description: string
    jobType: JobType
    clientName: string
    budget: string
    deadline: string
  }) {
    setCreating(true)
    try {
      const budgetNum = input.budget.trim() ? Number(input.budget) : undefined
      const res = await api.createJob({
        title: input.title.trim(),
        description: input.description.trim(),
        jobType: input.jobType,
        clientName: input.clientName.trim() || undefined,
        budget: typeof budgetNum === 'number' && !Number.isNaN(budgetNum) ? budgetNum : undefined,
        deadline: input.deadline.trim() || undefined,
      })
      if (!res.ok) throw new Error('create_failed')
      const job = parseJobRecord(res.job)
      toast.success('Job created', {
        description: 'AI scope is ready. Review it below before executing.',
      })
      setFormOpen(false)
      await refreshJobs()
      // Surface the AI-generated scope immediately.
      if (job.scope) {
        setScopeFor(job.id)
        setScope(job.scope)
      }
    } catch (err) {
      toast.error('Failed to create job', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setCreating(false)
    }
  }

  async function handleExecute(jobId: string) {
    setExecutingId(jobId)
    try {
      const res = await api.executeJob(jobId)
      if (!res.ok) throw new Error('execute_failed')
      toast.success('Job executed', {
        description: res.message || `${res.fileCount} files generated.`,
      })
      await refreshJobs()
    } catch (err) {
      toast.error('Execution failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setExecutingId(null)
    }
  }

  async function handleShowScope(job: JobSummary) {
    if (scopeFor === job.id) {
      setScopeFor(null)
      setScope(null)
      return
    }
    // Try to fetch full job detail to read the scope; fall back to listing.
    setScopeLoading(true)
    setScopeFor(job.id)
    try {
      const detail = await api.listJobs()
      const match = detail.jobs.find((j) => asString(j.id) === job.id) as
        | Record<string, unknown>
        | undefined
      const parsed = match ? parseJobRecord(match) : null
      setScope(parsed?.scope ?? null)
    } catch {
      setScope(null)
    } finally {
      setScopeLoading(false)
    }
  }

  async function resolveProjectId(jobId: string): Promise<string> {
    const fresh = await api.listJobs()
    const match = fresh.jobs.find((j) => asString(j.id) === jobId) as
      | Record<string, unknown>
      | undefined
    return match ? asString(match.projectId) : ''
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Badge
            variant="outline"
            className="w-fit border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            <Briefcase className="h-3 w-3" />
            Freelance Job Engine
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Jobs</h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Describe a client engagement. Buildr writes the scope, scaffolds the deliverables,
            and ships a downloadable ZIP — all from one form.
          </p>
        </div>
        <Button
          onClick={() => setFormOpen((v) => !v)}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {formOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {formOpen ? 'Close form' : 'New job'}
        </Button>
      </header>

      {/* Tab switcher: Jobs ↔ Leads */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'jobs' | 'leads')}
        className="mt-6"
      >
        <TabsList className="grid w-full grid-cols-2 sm:w-[360px]">
          <TabsTrigger value="jobs" className="gap-1.5 text-xs sm:text-sm">
            <Briefcase className="h-4 w-4" />
            <span>Jobs</span>
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-1.5 text-xs sm:text-sm">
            <Users className="h-4 w-4" />
            <span>Leads</span>
          </TabsTrigger>
        </TabsList>

        {/* Leads tab — rendered first because the rest of the jobs UI is large */}
        <TabsContent value="leads" className="mt-6">
          <LeadsView />
        </TabsContent>

        <TabsContent value="jobs" className="mt-6">
          {/* New job form */}
          {formOpen && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-6"
        >
          <NewJobForm onCreate={handleCreate} creating={creating} />
        </motion.div>
      )}

      {/* Scope preview (after a create) */}
      {scopeFor && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-6"
        >
          <ScopePreview
            jobId={scopeFor}
            scope={scope}
            loading={scopeLoading}
            onClose={() => {
              setScopeFor(null)
              setScope(null)
            }}
          />
        </motion.div>
      )}

      {/* Job list */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium tracking-tight">All jobs</h2>
          {loading && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </span>
          )}
        </div>

        {!loading && jobs.length === 0 ? (
          <Card className="border-dashed py-10">
            <CardContent className="flex flex-col items-center gap-2 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
                <Briefcase className="h-5 w-5" />
              </span>
              <p className="font-medium">No jobs yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first job to get an AI-generated scope and a head start on the deliverables.
              </p>
              <Button
                onClick={() => setFormOpen(true)}
                className="mt-1 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                New job
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {jobs.map((job, i) => {
              const status = STATUS_BADGE[job.status] ?? DEFAULT_STATUS
              const isExecuting = executingId === job.id
              const canExecute = job.status === 'planning'
              const canOpen = job.status === 'reviewing' || job.status === 'delivered'
              const isExpanded = expandedId === job.id
              return (
                <motion.div
                  key={job.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.24) }}
                  className={cn(isExpanded && 'md:col-span-2')}
                >
                  <JobCard
                    job={job}
                    status={status}
                    isExecuting={isExecuting}
                    canExecute={canExecute}
                    canOpen={canOpen}
                    isExpanded={isExpanded}
                    onToggleExpand={() =>
                      setExpandedId(isExpanded ? null : job.id)
                    }
                    onExecute={() => handleExecute(job.id)}
                    onOpen={() => {
                      void (async () => {
                        try {
                          const projectId = await resolveProjectId(job.id)
                          if (!projectId) {
                            toast.error('No project yet', {
                              description: 'Execute this job first to generate a project.',
                            })
                            return
                          }
                          await openBuilder(projectId)
                        } catch (err) {
                          toast.error('Failed to open project', {
                            description: err instanceof Error ? err.message : 'unknown_error',
                          })
                        }
                      })()
                    }}
                    onDownload={() => {
                      void (async () => {
                        try {
                          const projectId = await resolveProjectId(job.id)
                          if (!projectId) {
                            toast.error('No project to export yet')
                            return
                          }
                          window.open(`/api/export/${projectId}`, '_blank', 'noopener,noreferrer')
                        } catch {
                          toast.error('Failed to resolve project for download')
                        }
                      })()
                    }}
                    onShowScope={() => handleShowScope(job)}
                    scopeOpen={scopeFor === job.id}
                  />
                </motion.div>
              )
            })}
          </div>
        )}
      </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New job form
// ---------------------------------------------------------------------------

function NewJobForm({
  onCreate,
  creating,
}: {
  onCreate: (input: {
    title: string
    description: string
    jobType: JobType
    clientName: string
    budget: string
    deadline: string
  }) => Promise<void>
  creating: boolean
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [jobType, setJobType] = React.useState<JobType>('website')
  const [clientName, setClientName] = React.useState('')
  const [budget, setBudget] = React.useState('')
  const [deadline, setDeadline] = React.useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !description.trim()) {
      toast.error('Title and description are required')
      return
    }
    void onCreate({ title, description, jobType, clientName, budget, deadline })
  }

  return (
    <Card className="border-emerald-200/60 dark:border-emerald-900/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          Create a job
        </CardTitle>
        <CardDescription>
          The AI generates a scope (stack, hours, deliverables, task graph) on submit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="job-title">Title *</Label>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Landing page for a coffee subscription startup"
              required
            />
          </div>

          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="job-desc">Description *</Label>
            <Textarea
              id="job-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the engagement — goals, must-haves, references, tone…"
              className="min-h-28 resize-y"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="job-type">Job type</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v as JobType)}>
              <SelectTrigger id="job-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JOB_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="job-client">Client name</Label>
            <Input
              id="job-client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Acme Co. (optional)"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="job-budget">Budget (USD)</Label>
            <Input
              id="job-budget"
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="2500 (optional)"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="job-deadline">Deadline</Label>
            <Input
              id="job-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          <div className="flex justify-end md:col-span-2">
            <Button
              type="submit"
              disabled={creating}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Create job
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Scope preview
// ---------------------------------------------------------------------------

function ScopePreview({
  jobId,
  scope,
  loading,
  onClose,
}: {
  jobId: string
  scope: JobScope | null
  loading: boolean
  onClose: () => void
}) {
  return (
    <Card className="border-emerald-300/70 dark:border-emerald-800/40">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-emerald-600" />
              AI-generated scope
            </CardTitle>
            <CardDescription className="mt-1">
              Review the plan. When ready, execute the job to generate the deliverables.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close scope">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading scope…
          </div>
        ) : !scope ? (
          <p className="text-sm text-muted-foreground">
            No scope data available for job <code className="font-mono">{jobId}</code>.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Top stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatPill
                icon={<Clock className="h-3.5 w-3.5" />}
                label="Est. hours"
                value={scope.estimatedHours ? String(scope.estimatedHours) : '—'}
              />
              <StatPill
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                label="Complexity"
                value={scope.complexity || '—'}
              />
              <StatPill
                icon={<Target className="h-3.5 w-3.5" />}
                label="Deliverables"
                value={String(scope.deliverables.length)}
              />
              <StatPill
                icon={<ListChecks className="h-3.5 w-3.5" />}
                label="Tasks"
                value={String(scope.tasks.length)}
              />
            </div>

            {/* Summary */}
            {scope.summary && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Summary
                </h4>
                <p className="text-sm">{scope.summary}</p>
              </div>
            )}

            {/* Stack */}
            {scope.stack.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recommended stack
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {scope.stack.map((s, i) => (
                    <Badge key={`${s}-${i}`} variant="secondary" className="font-normal">
                      <FileCode2 className="h-3 w-3" />
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Deliverables */}
            {scope.deliverables.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Deliverables
                </h4>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {scope.deliverables.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span className="text-muted-foreground">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Task graph */}
            {scope.tasks.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Task graph
                </h4>
                <ol className="space-y-2">
                  {scope.tasks.map((t, i) => {
                    const status = (t.status || 'pending').toLowerCase()
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50/50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40"
                      >
                        <span className="mt-0.5 text-emerald-600">
                          {status === 'completed' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : status === 'running' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Circle className="h-4 w-4 text-zinc-400" />
                          )}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{t.title}</p>
                          {t.dependencies && t.dependencies.length > 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Depends on: {t.dependencies.join(', ')}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50/50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <span className="text-emerald-600">{icon}</span>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job card
// ---------------------------------------------------------------------------

function JobCard({
  job,
  status,
  isExecuting,
  canExecute,
  canOpen,
  isExpanded,
  onToggleExpand,
  onExecute,
  onOpen,
  onDownload,
  onShowScope,
  scopeOpen,
}: {
  job: JobSummary
  status: { label: string; className: string }
  isExecuting: boolean
  canExecute: boolean
  canOpen: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onExecute: () => void
  onOpen: () => void
  onDownload: () => void
  onShowScope: () => void
  scopeOpen: boolean
}) {
  const createdLabel = React.useMemo(() => {
    try {
      return formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
    } catch {
      return 'recently'
    }
  }, [job.createdAt])

  const typeLabel =
    JOB_TYPES.find((t) => t.value === job.jobType)?.label || job.jobType || '—'

  return (
    <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="truncate text-base">{job.title}</CardTitle>
          <Badge variant="outline" className={cn('shrink-0', status.className)}>
            {status.label}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="gap-1 font-normal">
            <FolderGit2 className="h-3 w-3" />
            {typeLabel}
          </Badge>
          {job.clientName && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <User className="h-3 w-3" />
              {job.clientName}
            </Badge>
          )}
          {typeof job.budget === 'number' && job.budget > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Wallet className="h-3 w-3" />${job.budget.toLocaleString()}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-3">
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {job.description?.trim() || 'No description provided.'}
        </p>
      </CardContent>

      <CardContent className="flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            {createdLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canExecute && (
            <Button
              onClick={onExecute}
              size="sm"
              disabled={isExecuting}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isExecuting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Execute
            </Button>
          )}
          {canOpen && (
            <Button onClick={onOpen} size="sm" className="gap-1.5">
              <FolderGit2 className="h-3.5 w-3.5" />
              Open project
            </Button>
          )}
          {canOpen && (
            <Button onClick={onDownload} size="sm" variant="outline" className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              ZIP
            </Button>
          )}
          <Button
            onClick={onShowScope}
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
          >
            <ListChecks className="h-3.5 w-3.5" />
            {scopeOpen ? 'Hide scope' : 'View scope'}
          </Button>
          <Button
            onClick={onToggleExpand}
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5 text-muted-foreground"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                isExpanded && 'rotate-180',
              )}
            />
            {isExpanded ? 'Hide details' : 'Manage'}
          </Button>
        </div>
      </CardContent>

      {/* Expanded detail panel (Sections A / B / C) */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <CardContent className="border-t pt-4">
              <JobDetailPanel job={job} />
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Job detail panel — tabbed container for the three new sections
// ---------------------------------------------------------------------------

function JobDetailPanel({ job }: { job: JobSummary }) {
  return (
    <Tabs defaultValue="portal" className="w-full">
      <TabsList className="flex w-full gap-1 overflow-x-auto sm:grid sm:grid-cols-4 sm:overflow-visible">
        <TabsTrigger value="portal" className="gap-1.5 whitespace-nowrap">
          <Link2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Client Portal</span>
          <span className="sm:hidden">Portal</span>
        </TabsTrigger>
        <TabsTrigger value="billing" className="gap-1.5">
          <Receipt className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contract & Invoice</span>
          <span className="sm:hidden">Billing</span>
        </TabsTrigger>
        <TabsTrigger value="milestones" className="gap-1.5 whitespace-nowrap">
          <Milestone className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Milestones</span>
          <span className="sm:hidden">Timeline</span>
        </TabsTrigger>
        <TabsTrigger value="payments" className="gap-1.5 whitespace-nowrap">
          <CreditCard className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Payments</span>
          <span className="sm:hidden">Pay</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="portal" className="pt-4">
        <ClientPortalLink jobId={job.id} />
      </TabsContent>
      <TabsContent value="billing" className="pt-4">
        <ContractInvoice jobId={job.id} />
      </TabsContent>
      <TabsContent value="milestones" className="pt-4">
        <MilestoneDelivery jobId={job.id} />
      </TabsContent>
      <TabsContent value="payments" className="pt-4">
        <PaymentsPanel jobId={job.id} />
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------
// Section A — Client Portal Link
// ---------------------------------------------------------------------------

function ClientPortalLink({ jobId }: { jobId: string }) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [absoluteUrl, setAbsoluteUrl] = React.useState<string | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  async function handleGenerate() {
    setGenerating(true)
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/client-portal`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const result = await response.json().catch(() => ({})) as { token?: string; error?: string }
      if (!response.ok || !result.token) throw new Error(result.error || 'Could not create a secure client portal link')

      const path = `/client/${encodeURIComponent(jobId)}?token=${encodeURIComponent(result.token)}`
      setUrl(path)
      setAbsoluteUrl(new URL(path, window.location.origin).toString())
      await api.getClientPortal(jobId, result.token)
      toast.success('Client portal link ready', { description: 'The secure portal link is ready to share.' })
    } catch (err) {
      toast.error('Could not generate portal link', { description: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    const target = absoluteUrl ?? url
    if (!target) return
    const ok = await copyToClipboard(target)
    if (ok) {
      setCopied(true)
      toast.success('Link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Failed to copy link')
    }
  }

  function handleOpen() {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Card className="border-emerald-200/60 dark:border-emerald-900/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-emerald-600" />
          Client portal link
        </CardTitle>
        <CardDescription>
          Generate a shareable, no-sign-in link so the client can follow along.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!url ? (
          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Get client portal link
          </Button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  readOnly
                  value={absoluteUrl ?? url}
                  className="pr-9 font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={handleCopy}
                  variant="ghost"
                  size="icon"
                  aria-label="Copy link"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <Button
                onClick={handleOpen}
                className="gap-1.5"
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Open portal
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this link with your client. They can view progress, download files, and
              leave feedback — no account needed.
            </p>
            <Button
              onClick={handleGenerate}
              variant="ghost"
              size="sm"
              className="w-fit gap-1.5 text-muted-foreground"
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Regenerate link
            </Button>
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section B — Contract & Invoice
// ---------------------------------------------------------------------------

function ContractInvoice({ jobId }: { jobId: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ContractPanel jobId={jobId} />
      <InvoicePanel jobId={jobId} />
    </div>
  )
}

function ContractPanel({ jobId }: { jobId: string }) {
  const [hourlyRate, setHourlyRate] = React.useState('75')
  const [paymentTerms, setPaymentTerms] = React.useState<string>('50/50')
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<ContractResult | null>(null)
  const [copied, setCopied] = React.useState(false)

  async function handleGenerate() {
    const rate = Number(hourlyRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Enter a valid hourly rate')
      return
    }
    setLoading(true)
    try {
      const res = await api.generateContract(jobId, {
        hourlyRate: rate,
        paymentTerms,
      })
      if (!res.ok) throw new Error('generate_failed')
      setResult({
        contract: res.contract,
        estimatedCost: asNumber(res.estimatedCost) ?? 0,
        hourlyRate: asNumber(res.hourlyRate) ?? rate,
        paymentTerms: asString(res.paymentTerms) || paymentTerms,
      })
      toast.success('Contract generated', {
        description: `Estimated total: $${(asNumber(res.estimatedCost) ?? 0).toLocaleString()}`,
      })
    } catch (err) {
      toast.error('Failed to generate contract', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!result) return
    const ok = await copyToClipboard(result.contract)
    if (ok) {
      setCopied(true)
      toast.success('Contract copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Failed to copy contract')
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-emerald-600" />
          Contract
        </CardTitle>
        <CardDescription>
          Generate a written agreement with payment terms and an estimated total.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-rate">Hourly rate ($)</Label>
            <Input
              id="contract-rate"
              type="number"
              min={0}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-terms">Payment terms</Label>
            <Select
              value={paymentTerms}
              onValueChange={setPaymentTerms}
              disabled={loading}
            >
              <SelectTrigger id="contract-terms" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={loading}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          Generate contract
        </Button>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col gap-3"
            >
              {/* Estimated total — prominent */}
              <div className="flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-500/10">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  <Wallet className="h-3.5 w-3.5" />
                  Estimated total
                </span>
                <span className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  ${result.estimatedCost.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Rate: ${result.hourlyRate}/hr</span>
                <span>Terms: {result.paymentTerms}</span>
              </div>

              {/* Contract text */}
              <div className="relative">
                <pre className="max-h-80 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 pr-12 text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900/50">
                  {result.contract}
                </pre>
                <Button
                  onClick={handleCopy}
                  size="sm"
                  variant="outline"
                  className="absolute right-2 top-2 gap-1.5"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

function InvoicePanel({ jobId }: { jobId: string }) {
  const [hourlyRate, setHourlyRate] = React.useState('75')
  const [taxRate, setTaxRate] = React.useState('0')
  const [loading, setLoading] = React.useState(false)
  const [invoice, setInvoice] = React.useState<InvoiceData | null>(null)
  const [rawInvoice, setRawInvoice] = React.useState<string>('')

  async function handleGenerate() {
    const rate = Number(hourlyRate)
    const tax = Number(taxRate)
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Enter a valid hourly rate')
      return
    }
    setLoading(true)
    try {
      const res = await api.generateInvoice(jobId, {
        hourlyRate: rate,
        taxRate: Number.isFinite(tax) && tax >= 0 ? tax : 0,
      })
      if (!res.ok) throw new Error('generate_failed')
      const parsed = parseInvoice(res.invoice)
      setInvoice(parsed)
      setRawInvoice(
        typeof res.invoice === 'string'
          ? res.invoice
          : JSON.stringify(res.invoice ?? {}, null, 2),
      )
      toast.success('Invoice generated', {
        description: parsed
          ? `${parsed.lineItems.length} line item(s) · total $${parsed.total.toLocaleString()}`
          : 'Invoice data received',
      })
    } catch (err) {
      toast.error('Failed to generate invoice', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!rawInvoice) return
    const text = invoice ? invoiceToText(invoice) : rawInvoice
    const ok = await copyToClipboard(text)
    if (ok) toast.success('Invoice copied to clipboard')
    else toast.error('Failed to copy invoice')
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-emerald-600" />
          Invoice
        </CardTitle>
        <CardDescription>
          Generate a line-item invoice with tax and a due date.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-rate">Hourly rate ($)</Label>
            <Input
              id="invoice-rate"
              type="number"
              min={0}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-tax">Tax rate (%)</Label>
            <Input
              id="invoice-tax"
              type="number"
              min={0}
              max={100}
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={loading}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Receipt className="h-4 w-4" />
          )}
          Generate invoice
        </Button>

        <AnimatePresence>
          {invoice && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col gap-3"
            >
              {/* Header: invoice number + dates */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Invoice #
                  </span>
                  <span className="font-mono text-sm font-semibold">
                    {invoice.invoiceNumber}
                  </span>
                </div>
                {invoice.date && (
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Date
                    </span>
                    <span className="text-sm">{invoice.date}</span>
                  </div>
                )}
                {invoice.dueDate && (
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Due
                    </span>
                    <span className="text-sm">{invoice.dueDate}</span>
                  </div>
                )}
              </div>

              {/* From / To */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    From
                  </span>
                  {invoice.from.name && (
                    <span className="text-sm font-medium">{invoice.from.name}</span>
                  )}
                  {invoice.from.lines.map((l, i) => (
                    <span key={i} className="text-xs text-muted-foreground">
                      {l}
                    </span>
                  ))}
                  {!invoice.from.name && invoice.from.lines.length === 0 && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    To
                  </span>
                  {invoice.to.name && (
                    <span className="text-sm font-medium">{invoice.to.name}</span>
                  )}
                  {invoice.to.lines.map((l, i) => (
                    <span key={i} className="text-xs text-muted-foreground">
                      {l}
                    </span>
                  ))}
                  {!invoice.to.name && invoice.to.lines.length === 0 && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>

              {/* Line items */}
              {invoice.lineItems.length > 0 && (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoice.lineItems.map((it, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{it.description}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {it.hours}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${it.rate.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${it.amount.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Totals */}
              <div className="ml-auto flex w-full max-w-xs flex-col gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">${invoice.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Tax ({invoice.taxRate}%)
                  </span>
                  <span className="tabular-nums">${invoice.tax.toLocaleString()}</span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t pt-1.5 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums text-emerald-700 dark:text-emerald-300">
                    ${invoice.total.toLocaleString()}
                  </span>
                </div>
              </div>

              <Button
                onClick={handleCopy}
                size="sm"
                variant="outline"
                className="ml-auto gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy invoice
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section C — Milestone Delivery
// ---------------------------------------------------------------------------

function MilestoneDelivery({ jobId }: { jobId: string }) {
  const [milestones, setMilestones] = React.useState<Milestone[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [actingIndex, setActingIndex] = React.useState<number | null>(null)

  async function handleLoad() {
    setLoading(true)
    try {
      const res = await api.getMilestones(jobId)
      const parsed = parseMilestones(res.milestones)
      setMilestones(parsed)
      setLoaded(true)
      if (parsed.length === 0) {
        toast.info('No milestones yet', {
          description: 'This job does not have a milestone plan defined.',
        })
      } else {
        toast.success('Milestones loaded', {
          description: `${parsed.length} milestone(s) on the timeline.`,
        })
      }
    } catch (err) {
      toast.error('Failed to load milestones', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(index: number, action: 'approve' | 'reject') {
    setActingIndex(index)
    try {
      await api.updateMilestone(jobId, { milestoneIndex: index, action })
      toast.success(
        action === 'approve' ? 'Milestone approved' : 'Milestone rejected',
        { description: `Milestone #${index + 1} has been ${action === 'approve' ? 'approved' : 'rejected'}.` },
      )
      // Refresh the timeline to reflect the new state.
      const res = await api.getMilestones(jobId)
      setMilestones(parseMilestones(res.milestones))
    } catch (err) {
      toast.error(`Failed to ${action} milestone`, {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setActingIndex(null)
    }
  }

  if (!loaded) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
          <Milestone className="h-5 w-5" />
        </span>
        <Button
          onClick={handleLoad}
          disabled={loading}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Milestone className="h-4 w-4" />
          )}
          Load milestones
        </Button>
        <p className="text-sm text-muted-foreground">
          Fetch the delivery timeline for this job.
        </p>
      </div>
    )
  }

  if (milestones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800/60">
          <Milestone className="h-5 w-5" />
        </span>
        <p className="text-sm text-muted-foreground">
          No milestones defined for this job yet.
        </p>
        <Button
          onClick={handleLoad}
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ListChecks className="h-3.5 w-3.5" />
          )}
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="relative flex flex-col">
        {milestones.map((m, idx) => {
          const isLast = idx === milestones.length - 1
          const isDone = m.status === 'completed' || m.status === 'approved'
          const isRunning = m.status === 'running' || m.status === 'in_progress'
          const isRejected = m.status === 'rejected'
          const badge =
            MILESTONE_STATUS[m.status] ?? DEFAULT_MILESTONE_STATUS
          const isActing = actingIndex === idx

          return (
            <motion.li
              key={idx}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: Math.min(idx * 0.05, 0.3) }}
              className="relative pl-10"
            >
              {/* Timeline connector */}
              {!isLast && (
                <span
                  className={cn(
                    'absolute left-[13px] top-7 bottom-0 w-px',
                    isDone
                      ? 'bg-emerald-300 dark:bg-emerald-700'
                      : 'bg-zinc-200 dark:bg-zinc-700',
                  )}
                />
              )}

              {/* Timeline node */}
              <span className="absolute left-0 top-1 grid h-7 w-7 place-items-center rounded-full border-2 bg-background">
                {isDone ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : isRejected ? (
                  <XCircle className="h-5 w-5 text-red-500" />
                ) : isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-400" />
                )}
              </span>

              {/* Content card */}
              <div className="mb-3 rounded-lg border bg-card p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    #{m.number}
                  </span>
                  <h4 className="text-sm font-semibold">{m.name}</h4>
                  <Badge variant="outline" className={cn('ml-auto', badge.className)}>
                    {badge.label}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="gap-1 font-normal"
                  >
                    <Wallet className="h-3 w-3" />
                    {m.paymentPercentage}% of budget
                  </Badge>
                </div>

                {m.tasks.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t pt-2.5">
                    {m.tasks.map((t, ti) => {
                      const s = t.status
                      return (
                        <li key={ti} className="flex items-start gap-2 text-sm">
                          <span className="mt-0.5 shrink-0">
                            {s === 'completed' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            ) : s === 'running' || s === 'in_progress' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-zinc-400" />
                            )}
                          </span>
                          <span className="text-muted-foreground">{t.title}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {/* Approve / Reject */}
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      isActing ||
                      m.status === 'approved' ||
                      m.status === 'completed'
                    }
                    onClick={() => handleAction(idx, 'approve')}
                    className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                  >
                    {isActing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isActing || m.status === 'rejected'}
                    onClick={() => handleAction(idx, 'reject')}
                    className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-500/10"
                  >
                    {isActing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    Reject
                  </Button>
                </div>
              </div>
            </motion.li>
          )
        })}
      </ol>

      <Button
        onClick={handleLoad}
        variant="ghost"
        size="sm"
        className="ml-auto gap-1.5 text-muted-foreground"
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ListChecks className="h-3.5 w-3.5" />
        )}
        Refresh milestones
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section D — Payments (Paystack)
// ---------------------------------------------------------------------------

function PaymentsPanel({ jobId }: { jobId: string }) {
  const [payments, setPayments] = React.useState<PaymentRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [collectOpen, setCollectOpen] = React.useState(false)

  // Dialog form state
  const [type, setType] = React.useState<'deposit' | 'milestone' | 'final'>('deposit')
  const [amountNgn, setAmountNgn] = React.useState('')
  const [milestoneIdx, setMilestoneIdx] = React.useState('0')
  const [creating, setCreating] = React.useState(false)
  const [createdLink, setCreatedLink] = React.useState<{
    authorizationUrl: string
    reference: string
  } | null>(null)

  // Manual verify state
  const [verifyingRef, setVerifyingRef] = React.useState<string | null>(null)

  // Keep a ref of payments so the polling interval always sees the latest
  // list without re-subscribing on every state change.
  const paymentsRef = React.useRef<PaymentRow[]>([])
  paymentsRef.current = payments

  async function handleLoad() {
    setLoading(true)
    try {
      const res = await api.listJobPayments(jobId)
      setPayments(parsePayments(res.payments))
    } catch (err) {
      toast.error('Failed to load payments', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }

  // Auto-load on mount + whenever the job changes.
  React.useEffect(() => {
    void handleLoad()
     
  }, [jobId])

  // Poll for verification every 5s while there's at least one pending payment.
  React.useEffect(() => {
    const hasPending = payments.some((p) => p.status === 'pending')
    if (!hasPending) return

    let cancelled = false
    const tick = async () => {
      const current = paymentsRef.current
      const pending = current.find((p) => p.status === 'pending')
      if (!pending || cancelled) return
      try {
        const res = await api.verifyJobPayment(jobId, pending.reference)
        if (cancelled) return
        if (res.ok && res.status === 'success') {
          toast.success('Payment confirmed', {
            description: `₦${(pending.amountKobo / 100).toLocaleString()} received from ${pending.customerEmail || 'customer'}.`,
          })
          const list = await api.listJobPayments(jobId)
          if (!cancelled) setPayments(parsePayments(list.payments))
        } else if (res.ok && res.status === 'failed') {
          toast.error('Payment failed', {
            description: 'The Paystack transaction did not complete.',
          })
          const list = await api.listJobPayments(jobId)
          if (!cancelled) setPayments(parsePayments(list.payments))
        }
      } catch {
        // Swallow poll errors — keep retrying on the next tick.
      }
    }
    const t = setInterval(tick, 5_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [jobId, payments])

  async function handleCreateLink() {
    const ngn = Number(amountNgn)
    if (!Number.isFinite(ngn) || ngn <= 0) {
      toast.error('Enter a valid amount in NGN')
      return
    }
    const amountKobo = Math.round(ngn * 100)
    if (amountKobo < 100) {
      toast.error('Minimum amount is ₦1.00')
      return
    }
    const body: {
      type: 'deposit' | 'milestone' | 'final'
      amountKobo: number
      milestoneIndex?: number
    } = { type, amountKobo }
    if (type === 'milestone') {
      const idx = Number(milestoneIdx)
      if (!Number.isFinite(idx) || idx < 0) {
        toast.error('Enter a valid milestone index')
        return
      }
      body.milestoneIndex = Math.floor(idx)
    }
    setCreating(true)
    try {
      const res = await api.createJobPayment(jobId, body)
      setCreatedLink({
        authorizationUrl: res.authorizationUrl,
        reference: res.reference,
      })
      toast.success('Payment link created', {
        description: 'Open the payment page to collect funds from your client.',
      })
      // Refresh the list so the new pending payment shows up immediately.
      const list = await api.listJobPayments(jobId)
      setPayments(parsePayments(list.payments))
    } catch (err) {
      toast.error('Failed to create payment link', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setCreating(false)
    }
  }

  async function handleVerify(reference: string, amountKobo: number) {
    setVerifyingRef(reference)
    try {
      const res = await api.verifyJobPayment(jobId, reference)
      if (res.ok && res.status === 'success') {
        toast.success('Payment confirmed', {
          description: `₦${(amountKobo / 100).toLocaleString()} received.`,
        })
      } else if (res.ok && res.status === 'failed') {
        toast.error('Payment failed', {
          description: 'The Paystack transaction did not complete.',
        })
      } else if (res.ok) {
        toast.info('Still pending', {
          description: 'The customer has not completed payment yet.',
        })
      }
      const list = await api.listJobPayments(jobId)
      setPayments(parsePayments(list.payments))
    } catch (err) {
      toast.error('Failed to verify payment', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setVerifyingRef(null)
    }
  }

  function handleOpenLink(url: string | null) {
    if (!url) {
      toast.error('No authorization URL available for this payment')
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function resetDialog() {
    setCreatedLink(null)
    setAmountNgn('')
    setMilestoneIdx('0')
    setType('deposit')
  }

  function handleDialogChange(open: boolean) {
    setCollectOpen(open)
    if (!open) {
      // Delay reset so the dialog's close animation isn't interrupted.
      setTimeout(resetDialog, 150)
    }
  }

  const pendingCount = payments.filter((p) => p.status === 'pending').length
  const successCount = payments.filter((p) => p.status === 'success').length
  const totalKobo = payments
    .filter((p) => p.status === 'success')
    .reduce((sum, p) => sum + p.amountKobo, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4 text-emerald-600" />
          Payments
        </CardTitle>
        <CardDescription>
          Collect deposits, milestone, and final payments via Paystack.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {payments.length === 0
              ? 'No payments collected yet.'
              : `${successCount} of ${payments.length} confirmed` +
                (totalKobo > 0
                  ? ` · ₦${(totalKobo / 100).toLocaleString()} received`
                  : '')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleLoad}
              variant="outline"
              size="sm"
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListChecks className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
            <Button
              onClick={() => setCollectOpen(true)}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              Collect Payment
            </Button>
          </div>
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {pendingCount} payment{pendingCount === 1 ? '' : 's'} pending — verifying every 5s.
          </div>
        )}

        {payments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
              <CreditCard className="h-4 w-4" />
            </span>
            <p className="text-sm text-muted-foreground">
              Create a payment link to collect from your client.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => {
                  const badge =
                    PAYMENT_STATUS[p.status] ?? DEFAULT_PAYMENT_STATUS
                  const isPending = p.status === 'pending'
                  const date = p.paidAt || p.createdAt
                  const naira = (p.amountKobo / 100).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium capitalize">
                        {p.type}
                        {p.type === 'milestone' && p.milestoneIndex != null && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            #{p.milestoneIndex + 1}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ₦{naira}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {date
                          ? formatDistanceToNow(new Date(date), {
                              addSuffix: true,
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isPending && p.authorizationUrl && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => handleOpenLink(p.authorizationUrl)}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </Button>
                          )}
                          {isPending && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-xs"
                              disabled={verifyingRef === p.reference}
                              onClick={() =>
                                handleVerify(p.reference, p.amountKobo)
                              }
                            >
                              {verifyingRef === p.reference ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              Verify
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={collectOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-600" />
              Collect Payment
            </DialogTitle>
            <DialogDescription>
              Generate a Paystack payment link for your client. The link works
              on Paystack's hosted checkout page.
            </DialogDescription>
          </DialogHeader>

          {!createdLink ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label>Payment type</Label>
                <Select
                  value={type}
                  onValueChange={(v) =>
                    setType(v as 'deposit' | 'milestone' | 'final')
                  }
                  disabled={creating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type === 'milestone' && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="milestone-idx">
                    Milestone index (0-based)
                  </Label>
                  <Input
                    id="milestone-idx"
                    type="number"
                    min={0}
                    value={milestoneIdx}
                    onChange={(e) => setMilestoneIdx(e.target.value)}
                    disabled={creating}
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="amount-ngn">Amount (NGN)</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    ₦
                  </span>
                  <Input
                    id="amount-ngn"
                    type="number"
                    min={1}
                    step="0.01"
                    className="pl-7"
                    value={amountNgn}
                    onChange={(e) => setAmountNgn(e.target.value)}
                    disabled={creating}
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {amountNgn && Number(amountNgn) > 0
                    ? `= ${Math.round(Number(amountNgn) * 100).toLocaleString()} kobo`
                    : 'Converted to kobo internally (1 NGN = 100 kobo).'}
                </p>
              </div>

              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => handleDialogChange(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateLink}
                  disabled={creating}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  Create Payment Link
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4 py-2"
            >
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-500/10">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  Payment link ready
                </p>
                <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                  Reference:{' '}
                  <code className="font-mono">{createdLink.reference}</code>
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Authorization URL</Label>
                <div className="rounded-md border bg-muted/40 p-2 text-xs font-mono break-all">
                  {createdLink.authorizationUrl}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={() =>
                    handleOpenLink(createdLink.authorizationUrl)
                  }
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Payment Page
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={async () => {
                      const ok = await copyToClipboard(
                        createdLink.authorizationUrl,
                      )
                      if (ok) toast.success('Link copied to clipboard')
                      else toast.error('Failed to copy link')
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    Copy Link
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={resetDialog}
                  >
                    Create Another
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                We'll automatically verify the payment every 5 seconds once it's
                pending.
              </p>
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter((s) => s.length > 0)
  if (typeof v === 'string' && v.trim()) {
    return v.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function asNumberOrUndefined(v: unknown): number | undefined {
  const n = asNumber(v)
  return n === null ? undefined : n
}

function parseScope(v: unknown): JobScope | null {
  if (!v || typeof v !== 'object') return null
  const obj = v as Record<string, unknown>
  const tasks = Array.isArray(obj.tasks)
    ? obj.tasks
        .map((t): ScopeTask | null => {
          if (!t || typeof t !== 'object') return null
          const o = t as Record<string, unknown>
          return {
            title: asString(o.title ?? o.name) || 'Untitled task',
            status: asString(o.status) || 'pending',
            dependencies: asStringArray(o.dependencies ?? o.depends_on ?? o.dependsOn),
          }
        })
        .filter((t): t is ScopeTask => t !== null)
    : []

  return {
    summary: asString(obj.summary),
    stack: asStringArray(obj.stack ?? obj.techStack ?? obj.tech_stack),
    estimatedHours: asNumberOrUndefined(obj.estimatedHours ?? obj.estimated_hours ?? obj.hours) ?? 0,
    complexity: asString(obj.complexity) || 'Medium',
    deliverables: asStringArray(obj.deliverables),
    tasks,
  }
}

function parseJobRecord(raw: Record<string, unknown>): JobRecord {
  return {
    id: asString(raw.id),
    title: asString(raw.title),
    description: asString(raw.description),
    jobType: asString(raw.jobType ?? raw.job_type),
    clientName: typeof raw.clientName === 'string' ? raw.clientName : (raw.client_name as string | null | undefined) ?? null,
    clientEmail: typeof raw.clientEmail === 'string' ? raw.clientEmail : (raw.client_email as string | null | undefined) ?? null,
    status: asString(raw.status) || 'intake',
    budget: typeof raw.budget === 'number' ? raw.budget : null,
    deadline: typeof raw.deadline === 'string' ? raw.deadline : null,
    createdAt: asString(raw.createdAt ?? raw.created_at),
    projectId: typeof raw.projectId === 'string'
      ? raw.projectId
      : typeof raw.project_id === 'string'
        ? raw.project_id
        : null,
    scope: parseScope(raw.scope),
    scopeSummary: asString(raw.scopeSummary ?? raw.scope_summary),
    fileCount: asNumberOrUndefined(raw.fileCount ?? raw.file_count),
  }
}

function parseParty(v: unknown): InvoiceParty {
  if (typeof v === 'string' && v.trim()) {
    return { name: v.trim(), lines: [] }
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const name = asString(o.name ?? o.company ?? o.businessName ?? o.business_name)
    const addr = o.address ?? o.street ?? o.lines ?? o.line1
    let lines: string[] = []
    if (Array.isArray(addr)) {
      lines = addr.map((x) => asString(x)).filter((s) => s.length > 0)
    } else if (typeof addr === 'string' && addr.trim()) {
      lines = addr.split(/\n/).map((s) => s.trim()).filter(Boolean)
    }
    const line2 = asString(o.line2 ?? o.city)
    if (line2) lines.push(line2)
    const email = asString(o.email)
    if (email) lines.push(email)
    const phone = asString(o.phone)
    if (phone) lines.push(phone)
    return { name, lines }
  }
  return { name: '', lines: [] }
}

function parseInvoice(v: unknown): InvoiceData | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const rawItems = o.lineItems ?? o.line_items ?? o.items ?? o.lines
  const lineItems: InvoiceLineItem[] = Array.isArray(rawItems)
    ? rawItems.map((it): InvoiceLineItem => {
        const i = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
        return {
          description:
            asString(i.description ?? i.desc ?? i.title ?? i.name ?? i.item) || '—',
          hours: asNumber(i.hours ?? i.quantity ?? i.qty) ?? 0,
          rate: asNumber(i.rate ?? i.unitPrice ?? i.unit_price ?? i.price) ?? 0,
          amount: asNumber(i.amount ?? i.total ?? i.lineTotal ?? i.line_total) ?? 0,
        }
      })
    : []
  return {
    invoiceNumber:
      asString(o.invoiceNumber ?? o.invoice_number ?? o.number ?? o.id) || '—',
    date: asString(o.date ?? o.issueDate ?? o.issue_date ?? o.createdAt ?? o.created_at),
    dueDate: asString(o.dueDate ?? o.due_date),
    from: parseParty(
      o.from ?? o.fromAddress ?? o.from_address ?? o.sender ?? o.contractor ?? o.vendor,
    ),
    to: parseParty(
      o.to ?? o.toAddress ?? o.to_address ?? o.recipient ?? o.client ?? o.billTo ?? o.bill_to,
    ),
    lineItems,
    subtotal: asNumber(o.subtotal ?? o.sub_total) ?? 0,
    tax: asNumber(o.tax ?? o.taxAmount ?? o.tax_amount) ?? 0,
    taxRate: asNumber(o.taxRate ?? o.tax_rate) ?? 0,
    total:
      asNumber(o.total ?? o.totalAmount ?? o.total_amount ?? o.amountDue ?? o.amount_due ?? o.grandTotal) ??
      0,
  }
}

function parseMilestoneTask(v: unknown): MilestoneTask {
  if (!v || typeof v !== 'object') return { title: 'Untitled task', status: 'pending' }
  const o = v as Record<string, unknown>
  return {
    title: asString(o.title ?? o.name ?? o.task) || 'Untitled task',
    status: (asString(o.status) || 'pending').toLowerCase(),
  }
}

function parseMilestones(v: unknown): Milestone[] {
  if (!Array.isArray(v)) return []
  return v.map((m, idx): Milestone => {
    const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
    const rawTasks = o.tasks
    return {
      number: asNumber(o.number ?? o.index) ?? idx + 1,
      name: asString(o.name ?? o.title) || `Milestone ${idx + 1}`,
      tasks: Array.isArray(rawTasks) ? rawTasks.map(parseMilestoneTask) : [],
      status: (asString(o.status) || 'pending').toLowerCase(),
      paymentPercentage:
        asNumber(o.paymentPercentage ?? o.payment_percentage ?? o.percentage) ?? 0,
    }
  })
}

function parsePayments(v: unknown): PaymentRow[] {
  if (!Array.isArray(v)) return []
  return v.map((p): PaymentRow => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    return {
      id: asString(o.id),
      reference: asString(o.reference ?? o.paystack_ref),
      amountKobo: asNumber(o.amountKobo ?? o.amount_kobo) ?? 0,
      currency: asString(o.currency) || 'NGN',
      status: (asString(o.status) || 'pending').toLowerCase(),
      type: (asString(o.type) || 'deposit').toLowerCase(),
      milestoneIndex: asNumber(o.milestoneIndex ?? o.milestone_index),
      customerEmail:
        typeof o.customerEmail === 'string'
          ? o.customerEmail
          : (o.customer_email as string | null | undefined) ?? null,
      authorizationUrl:
        typeof o.authorizationUrl === 'string'
          ? o.authorizationUrl
          : (o.authorization_url as string | null | undefined) ?? null,
      paidAt: asString(o.paidAt ?? o.paid_at) || null,
      createdAt: asString(o.createdAt ?? o.created_at),
    }
  })
}

function invoiceToText(inv: InvoiceData): string {
  const out: string[] = []
  out.push(`INVOICE #${inv.invoiceNumber}`)
  if (inv.date) out.push(`Date: ${inv.date}`)
  if (inv.dueDate) out.push(`Due: ${inv.dueDate}`)
  out.push('')
  out.push('FROM:')
  if (inv.from.name) out.push(`  ${inv.from.name}`)
  inv.from.lines.forEach((l) => out.push(`  ${l}`))
  out.push('')
  out.push('TO:')
  if (inv.to.name) out.push(`  ${inv.to.name}`)
  inv.to.lines.forEach((l) => out.push(`  ${l}`))
  out.push('')
  if (inv.lineItems.length > 0) {
    out.push('LINE ITEMS:')
    out.push('  Description | Hours | Rate | Amount')
    inv.lineItems.forEach((it) => {
      out.push(`  ${it.description} | ${it.hours} | $${it.rate} | $${it.amount}`)
    })
    out.push('')
  }
  out.push(`Subtotal: $${inv.subtotal}`)
  out.push(`Tax (${inv.taxRate}%): $${inv.tax}`)
  out.push(`TOTAL: $${inv.total}`)
  return out.join('\n')
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof window !== 'undefined' &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy fallback
  }
  // Legacy fallback for non-secure contexts / older browsers.
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
