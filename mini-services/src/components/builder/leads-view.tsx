'use client'

// LeadsView — the Lead-to-Job Pipeline.
// ------------------------------------------------------------------
// A. Lead Inbox — kanban board (New → Contacted → Qualified → Converted → Lost).
// B. Lead Detail Panel — slide-over with full contact info, requirements,
//    UTM/campaign attribution, notes timeline, status changer + "Convert
//    to Job" action.
// C. Lead Attribution — campaign + UTM + tracking clicks/conversions (when a
//    lead came in via a tracked link).
// D. Stats Bar — total leads, conversion rate, revenue, most effective source.
//
// Backend (see @/lib/api-client):
//   - api.listLeads({ status?, source? }) -> { leads: LeadRecord[] }
//   - api.getLead(id)                    -> { lead }
//   - api.createLead(body)               -> { ok, lead? }
//   - api.updateLead(id, body)           -> { ok, lead }
//   - api.deleteLead(id)                 -> { ok }
//   - api.convertLead(id, body?)        -> { ok, jobId, lead, alreadyConverted? }
//   - api.addLeadNote(id, text)          -> { ok, note }

import * as React from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquarePlus,
  Phone,
  Plus,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Loader2,
  ExternalLink,
  Tag,
} from 'lucide-react'
import { toast } from 'sonner'

import { api, type LeadRecord, type LeadNote } from '@/lib/api-client'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'

interface ColumnDef {
  value: LeadStatus
  label: string
  description: string
  // Header accent (background tint + text color).
  accent: string
  // Card border tint when this status applies.
  cardAccent: string
  dot: string
}

const COLUMNS: ColumnDef[] = [
  {
    value: 'new',
    label: 'New',
    description: 'Just came in',
    accent: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-900',
    cardAccent: 'border-l-blue-400 dark:border-l-blue-600',
    dot: 'bg-blue-500',
  },
  {
    value: 'contacted',
    label: 'Contacted',
    description: 'You reached out',
    accent: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-900',
    cardAccent: 'border-l-amber-400 dark:border-l-amber-600',
    dot: 'bg-amber-500',
  },
  {
    value: 'qualified',
    label: 'Qualified',
    description: 'Confirmed interested',
    accent: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-900',
    cardAccent: 'border-l-green-400 dark:border-l-green-600',
    dot: 'bg-green-500',
  },
  {
    value: 'converted',
    label: 'Converted',
    description: 'Became a job',
    accent: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-900',
    cardAccent: 'border-l-emerald-400 dark:border-l-emerald-600',
    dot: 'bg-emerald-500',
  },
  {
    value: 'lost',
    label: 'Lost',
    description: 'Not interested',
    accent: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-900',
    cardAccent: 'border-l-red-400 dark:border-l-red-600',
    dot: 'bg-red-500',
  },
]

const STATUS_BY_VALUE = new Map<LeadStatus, ColumnDef>(
  COLUMNS.map((c) => [c.value, c]),
)

const SOURCE_BADGE: Record<string, { label: string; className: string; icon?: React.ReactNode }> = {
  organic: {
    label: 'Organic',
    className: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
  },
  ad: {
    label: 'Ad',
    className: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-800',
  },
  social: {
    label: 'Social',
    className: 'bg-pink-100 text-pink-700 border-pink-300 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-800',
  },
  referral: {
    label: 'Referral',
    className: 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-800',
  },
  form: {
    label: 'Form',
    className: 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-800',
  },
}

const DEFAULT_SOURCE = {
  label: 'Other',
  className: 'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
}

const VALID_SOURCES = ['organic', 'ad', 'social', 'referral', 'form'] as const
type LeadSource = (typeof VALID_SOURCES)[number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function asStringOrUndefined(v: unknown): string | undefined {
  const s = asString(v)
  return s.length > 0 ? s : undefined
}

function asNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function formatKobo(kobo: number | null | undefined): string {
  const n = asNumberOrNull(kobo)
  if (n === null || n <= 0) return '—'
  try {
    return (n / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })
  } catch {
    return `₦${(n / 100).toLocaleString()}`
  }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return ''
  }
}

function truncate(text: string | null | undefined, max: number): string {
  const s = asString(text)
  if (s.length <= max) return s
  return s.slice(0, max).trimEnd() + '…'
}

function parseNotes(v: unknown): LeadNote[] {
  if (!Array.isArray(v)) return []
  return v
    .map((n): LeadNote | null => {
      if (!n || typeof n !== 'object') return null
      const o = n as Record<string, unknown>
      const at = asString(o.at)
      const text = asString(o.text)
      const author = asString(o.author)
      if (!text) return null
      return { at, text, author }
    })
    .filter((n): n is LeadNote => n !== null)
}

function normalizeLead(raw: Record<string, unknown>): LeadRecord {
  return {
    id: asString(raw.id),
    ownerId: asStringOrUndefined(raw.ownerId ?? raw.owner_id),
    projectId: (raw.projectId ?? raw.project_id) as string | null | undefined,
    name: asString(raw.name),
    email: asString(raw.email),
    phone: (raw.phone ?? null) as string | null,
    company: (raw.company ?? null) as string | null,
    source: asString(raw.source) || 'organic',
    campaignId: (raw.campaignId ?? raw.campaign_id ?? null) as string | null,
    trackingId: (raw.trackingId ?? raw.tracking_id ?? null) as string | null,
    utmData:
      raw.utmData && typeof raw.utmData === 'object'
        ? (raw.utmData as Record<string, unknown>)
        : typeof raw.utm_data === 'object' && raw.utm_data
          ? (raw.utm_data as Record<string, unknown>)
          : {},
    requirements: (raw.requirements ?? null) as string | null,
    budget: asNumberOrNull(raw.budget),
    status: asString(raw.status) || 'new',
    convertedJobId: (raw.convertedJobId ?? raw.converted_job_id ?? null) as string | null,
    convertedAt: (raw.convertedAt ?? raw.converted_at ?? null) as string | null,
    notes: parseNotes(raw.notes),
    createdAt: (raw.createdAt ?? raw.created_at ?? null) as string | null,
    updatedAt: (raw.updatedAt ?? raw.updated_at ?? null) as string | null,
  }
}

function isLeadStatus(s: string): s is LeadStatus {
  return STATUS_BY_VALUE.has(s as LeadStatus)
}

function isLeadSource(s: string): s is LeadSource {
  return (VALID_SOURCES as readonly string[]).includes(s)
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function LeadsView() {
  const [leads, setLeads] = React.useState<LeadRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [activeLeadId, setActiveLeadId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [sourceFilter, setSourceFilter] = React.useState<string>('all')

  const refreshLeads = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listLeads()
      setLeads(data.leads.map((raw) => normalizeLead(raw as unknown as Record<string, unknown>)))
    } catch (err) {
      toast.error('Failed to load leads', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshLeads()
  }, [refreshLeads])

  // Stats
  const stats = React.useMemo(() => {
    const total = leads.length
    const converted = leads.filter((l) => l.status === 'converted')
    const conversionRate = total > 0 ? Math.round((converted.length / total) * 100) : 0
    // Revenue: sum of converted leads' budgets (kobo). Real payment data lives
    // in /api/jobs/[id]/payments — but to keep this view self-contained we use
    // the lead budget as a proxy when payment data isn't fetched here.
    const revenueKobo = converted.reduce(
      (sum, l) => sum + (l.budget ?? 0),
      0,
    )
    // Most effective source = source with the most converted leads (tie → total).
    const bySource = new Map<string, { total: number; converted: number }>()
    for (const l of leads) {
      const entry = bySource.get(l.source) ?? { total: 0, converted: 0 }
      entry.total += 1
      if (l.status === 'converted') entry.converted += 1
      bySource.set(l.source, entry)
    }
    let bestSource: string | null = null
    let bestScore = -1
    for (const [source, entry] of bySource.entries()) {
      // Score: converted leads primarily, fall back to total leads.
      const score = entry.converted * 1_000 + entry.total
      if (score > bestScore) {
        bestScore = score
        bestSource = source
      }
    }
    return { total, convertedCount: converted.length, conversionRate, revenueKobo, bestSource }
  }, [leads])

  // Group leads by status (and apply the source filter).
  const grouped = React.useMemo(() => {
    const filtered = leads.filter(
      (l) => sourceFilter === 'all' || l.source === sourceFilter,
    )
    const map: Record<LeadStatus, LeadRecord[]> = {
      new: [],
      contacted: [],
      qualified: [],
      converted: [],
      lost: [],
    }
    for (const l of filtered) {
      const status = isLeadStatus(l.status) ? l.status : 'new'
      map[status].push(l)
    }
    // Most recent first.
    for (const k of Object.keys(map) as LeadStatus[]) {
      map[k].sort((a, b) => {
        const at = (a.createdAt ? Date.parse(a.createdAt) : 0)
        const bt = (b.createdAt ? Date.parse(b.createdAt) : 0)
        return bt - at
      })
    }
    return map
  }, [leads, sourceFilter])

  const activeLead = React.useMemo(
    () => leads.find((l) => l.id === activeLeadId) ?? null,
    [leads, activeLeadId],
  )

  function handleLeadUpdated(updated: LeadRecord) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }

  function handleLeadDeleted(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id))
    if (activeLeadId === id) setActiveLeadId(null)
  }

  function handleLeadCreated(lead: LeadRecord) {
    setLeads((prev) => [lead, ...prev])
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Badge
            variant="outline"
            className="w-fit border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
          >
            <Users className="h-3 w-3" />
            Lead-to-Job Pipeline
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Leads</h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Capture leads from your landing pages, qualify them through your funnel, and
            convert the winners into freelance jobs — all in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-9 w-[150px] gap-2 text-sm">
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {VALID_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_BADGE[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => setCreateOpen(true)}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            New lead
          </Button>
        </div>
      </header>

      {/* Stats bar */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Total leads"
          value={String(stats.total)}
          tone="text-violet-600 dark:text-violet-300"
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Conversion rate"
          value={`${stats.conversionRate}%`}
          sub={`${stats.convertedCount} converted`}
          tone="text-emerald-600 dark:text-emerald-300"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Pipeline value"
          value={formatKobo(stats.revenueKobo)}
          sub="From converted leads"
          tone="text-amber-600 dark:text-amber-300"
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Top source"
          value={stats.bestSource ? SOURCE_BADGE[stats.bestSource]?.label ?? stats.bestSource : '—'}
          sub={stats.bestSource ? `${stats.bestSource}` : 'No data yet'}
          tone="text-pink-600 dark:text-pink-300"
        />
      </section>

      {/* Kanban board */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium tracking-tight">Inbox</h2>
          {loading && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </span>
          )}
        </div>

        {!loading && leads.length === 0 ? (
          <EmptyLeadsState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="mt-4 flex gap-4 overflow-x-auto pb-4">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.value}
                column={col}
                leads={grouped[col.value]}
                onLeadClick={(id) => setActiveLeadId(id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Detail slide-over */}
      <Sheet
        open={activeLeadId !== null}
        onOpenChange={(open) => {
          if (!open) setActiveLeadId(null)
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 p-0 sm:max-w-lg md:max-w-xl"
        >
          {activeLead && (
            <LeadDetailPanel
              lead={activeLead}
              onClose={() => setActiveLeadId(null)}
              onUpdated={handleLeadUpdated}
              onDeleted={handleLeadDeleted}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create dialog */}
      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleLeadCreated}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone?: string
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className={cn('grid h-6 w-6 place-items-center rounded-md bg-muted', tone)}>
            {icon}
          </span>
          <span>{label}</span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyLeadsState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed py-12">
      <CardContent className="flex flex-col items-center gap-2 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-500/10">
          <Users className="h-5 w-5" />
        </span>
        <p className="font-medium">No leads yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Add your first lead manually, or wire up a landing page to POST to{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/leads/capture</code>{' '}
          and start collecting inbound leads automatically.
        </p>
        <Button onClick={onCreate} className="mt-2 gap-2 bg-violet-600 text-white hover:bg-violet-700">
          <Plus className="h-4 w-4" />
          New lead
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

function KanbanColumn({
  column,
  leads,
  onLeadClick,
}: {
  column: ColumnDef
  leads: LeadRecord[]
  onLeadClick: (id: string) => void
}) {
  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col gap-3 sm:w-[300px]">
      {/* Column header */}
      <div
        className={cn(
          'flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium',
          column.accent,
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', column.dot)} />
          <span>{column.label}</span>
          <span className="text-xs font-normal opacity-70">
            ({leads.length})
          </span>
        </div>
        <span className="text-xs opacity-70">{column.description}</span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {leads.map((lead, i) => (
            <motion.button
              key={lead.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.025, 0.18) }}
              onClick={() => onLeadClick(lead.id)}
              className={cn(
                'group w-full rounded-lg border border-l-4 bg-card p-3 text-left shadow-sm transition hover:shadow-md hover:-translate-y-0.5',
                column.cardAccent,
              )}
            >
              {/* Top: name + company */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{lead.name}</p>
                  {lead.company && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Building2 className="h-3 w-3" />
                      {lead.company}
                    </p>
                  )}
                </div>
                <SourceBadge source={lead.source} />
              </div>

              {/* Requirements preview */}
              {lead.requirements && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {truncate(lead.requirements, 120)}
                </p>
              )}

              {/* Footer: contact + budget + time */}
              <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <Mail className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{lead.email}</span>
                </div>
                {lead.budget != null && lead.budget > 0 && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    {formatKobo(lead.budget)}
                  </Badge>
                )}
              </div>

              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/80">
                <Clock className="h-3 w-3" />
                <span>{relativeTime(lead.createdAt) || '—'}</span>
                {lead.status === 'converted' && lead.convertedJobId && (
                  <span className="ml-auto flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    Job
                  </span>
                )}
              </div>
            </motion.button>
          ))}
        </AnimatePresence>

        {leads.length === 0 && (
          <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing here yet.
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: string }) {
  const meta = isLeadSource(source) ? SOURCE_BADGE[source] : null
  const m = meta ?? DEFAULT_SOURCE
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        m.className,
      )}
    >
      {m.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Lead detail panel (slide-over content)
// ---------------------------------------------------------------------------

function LeadDetailPanel({
  lead,
  onClose,
  onUpdated,
  onDeleted,
}: {
  lead: LeadRecord
  onClose: () => void
  onUpdated: (lead: LeadRecord) => void
  onDeleted: (id: string) => void
}) {
  const [updatingStatus, setUpdatingStatus] = React.useState(false)
  const [converting, setConverting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [noteText, setNoteText] = React.useState('')
  const [addingNote, setAddingNote] = React.useState(false)
  const [requirementsDraft, setRequirementsDraft] = React.useState(lead.requirements ?? '')
  const [savingRequirements, setSavingRequirements] = React.useState(false)
  const [budgetDraft, setBudgetDraft] = React.useState<string>(
    lead.budget != null ? String(lead.budget) : '',
  )
  const [savingBudget, setSavingBudget] = React.useState(false)

  // Reset drafts when the lead changes (sheet may be reused).
  React.useEffect(() => {
    setRequirementsDraft(lead.requirements ?? '')
    setBudgetDraft(lead.budget != null ? String(lead.budget) : '')
  }, [lead.id, lead.requirements, lead.budget])

  async function handleStatusChange(next: string) {
    if (!isLeadStatus(next) || next === lead.status) return
    if (next === 'converted') {
      // Conversion is a separate flow — show the convert dialog/confirm via button.
      toast.message('Use "Convert to job"', {
        description: 'Conversions create a new job — use the Convert button below.',
      })
      return
    }
    setUpdatingStatus(true)
    try {
      const res = await api.updateLead(lead.id, { status: next })
      onUpdated(res.lead)
      toast.success('Status updated', { description: `Moved to ${next}.` })
    } catch (err) {
      toast.error('Failed to update status', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setUpdatingStatus(false)
    }
  }

  async function handleConvert() {
    setConverting(true)
    try {
      const res = await api.convertLead(lead.id)
      // The convert endpoint always returns jobId; lead may be absent if the
      // job was created but the lead-update failed (edge case).
      if (res.lead) onUpdated(res.lead)
      else {
        // Re-fetch the lead to get the latest state.
        try {
          const fresh = await api.getLead(lead.id)
          onUpdated(fresh.lead)
        } catch {
          /* fall through to the toast */
        }
      }
      if (res.alreadyConverted) {
        toast.success('Already converted', {
          description: `This lead is already linked to job ${res.jobId}.`,
        })
      } else {
        toast.success('Lead converted', {
          description: 'A new freelance job has been created.',
        })
      }
    } catch (err) {
      toast.error('Conversion failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setConverting(false)
    }
  }

  async function handleAddNote() {
    const text = noteText.trim()
    if (!text) return
    setAddingNote(true)
    try {
      const res = await api.addLeadNote(lead.id, text)
      onUpdated({ ...lead, notes: [...lead.notes, res.note] })
      setNoteText('')
      toast.success('Note added')
    } catch (err) {
      toast.error('Failed to add note', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setAddingNote(false)
    }
  }

  async function handleSaveRequirements() {
    setSavingRequirements(true)
    try {
      const res = await api.updateLead(lead.id, { requirements: requirementsDraft.trim() })
      onUpdated(res.lead)
      toast.success('Requirements saved')
    } catch (err) {
      toast.error('Failed to save requirements', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setSavingRequirements(false)
    }
  }

  async function handleSaveBudget() {
    const n = Number(budgetDraft.replace(/[^0-9]/g, ''))
    const validN = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
    setSavingBudget(true)
    try {
      const res = await api.updateLead(lead.id, {
        budget: validN ?? 0,
      })
      onUpdated(res.lead)
      toast.success('Budget saved')
    } catch (err) {
      toast.error('Failed to save budget', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setSavingBudget(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.deleteLead(lead.id)
      onDeleted(lead.id)
      toast.success('Lead deleted')
      onClose()
    } catch (err) {
      toast.error('Failed to delete lead', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setDeleting(false)
    }
  }

  const isConverted = lead.status === 'converted'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <SheetHeader className="border-b bg-gradient-to-br from-violet-50 to-white p-5 dark:from-violet-500/10">
        <div className="flex items-start justify-between gap-3 pr-6">
          <div className="min-w-0 flex-1">
            <SheetTitle className="flex items-center gap-2 text-xl">
              <Users className="h-5 w-5 text-violet-600 dark:text-violet-300" />
              <span className="truncate">{lead.name}</span>
            </SheetTitle>
            <SheetDescription className="mt-1 flex items-center gap-2">
              {lead.company && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {lead.company}
                </span>
              )}
              <span className="opacity-50">·</span>
              <span>{relativeTime(lead.createdAt) || 'Just now'}</span>
            </SheetDescription>
          </div>
          <SourceBadge source={lead.source} />
        </div>

        {/* Status changer */}
        <div className="mt-4 flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Stage</Label>
          <Select
            value={isConverted ? 'converted' : lead.status}
            onValueChange={handleStatusChange}
            disabled={updatingStatus || isConverted || converting}
          >
            <SelectTrigger className="h-8 w-[170px] gap-2 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMNS.map((c) => (
                <SelectItem
                  key={c.value}
                  value={c.value}
                  disabled={c.value === 'converted'}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', c.dot)} />
                    {c.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {updatingStatus && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </SheetHeader>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Contact info */}
        <section className="space-y-2">
          <SectionLabel icon={<Mail className="h-3.5 w-3.5" />}>Contact</SectionLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <InfoRow
              icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Email"
              value={
                <a href={`mailto:${lead.email}`} className="text-violet-600 hover:underline dark:text-violet-300">
                  {lead.email}
                </a>
              }
            />
            <InfoRow
              icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Phone"
              value={lead.phone || '—'}
            />
          </div>
        </section>

        {/* Requirements (editable) */}
        <section className="mt-6 space-y-2">
          <SectionLabel icon={<Briefcase className="h-3.5 w-3.5" />}>Requirements</SectionLabel>
          <Textarea
            value={requirementsDraft}
            onChange={(e) => setRequirementsDraft(e.target.value)}
            rows={4}
            placeholder="What is this lead looking for?"
            disabled={savingRequirements}
            className="resize-y text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveRequirements}
              disabled={savingRequirements || requirementsDraft.trim() === (lead.requirements ?? '')}
              className="gap-1.5"
            >
              {savingRequirements && <Loader2 className="h-3 w-3 animate-spin" />}
              Save requirements
            </Button>
          </div>
        </section>

        {/* Budget */}
        <section className="mt-4 space-y-2">
          <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5" />}>Budget (kobo)</SectionLabel>
          <div className="flex items-center gap-2">
            <Input
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 50000000 = ₦500,000"
              disabled={savingBudget}
              className="h-9 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveBudget}
              disabled={savingBudget}
              className="gap-1.5"
            >
              {savingBudget && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </Button>
          </div>
          {lead.budget != null && lead.budget > 0 && (
            <p className="text-xs text-muted-foreground">
              Formatted: <span className="font-medium text-foreground">{formatKobo(lead.budget)}</span>
            </p>
          )}
        </section>

        {/* Attribution */}
        <section className="mt-6 space-y-2">
          <SectionLabel icon={<Target className="h-3.5 w-3.5" />}>Attribution</SectionLabel>
          <LeadAttribution lead={lead} />
        </section>

        {/* Notes timeline */}
        <section className="mt-6 space-y-2">
          <SectionLabel icon={<MessageSquarePlus className="h-3.5 w-3.5" />}>
            Notes timeline
          </SectionLabel>
          <NotesTimeline notes={lead.notes} />
          <div className="mt-2 flex items-end gap-2">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={2}
              placeholder="Add a follow-up note…"
              disabled={addingNote}
              className="resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void handleAddNote()
                }
              }}
            />
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={addingNote || !noteText.trim()}
              className="gap-1.5"
            >
              {addingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">⌘+Enter to send.</p>
        </section>

        {/* Conversion outcome */}
        {isConverted && lead.convertedJobId && (
          <section className="mt-6">
            <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-500/10">
              <CardContent className="flex items-start gap-3 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-300" />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-emerald-800 dark:text-emerald-200">
                    Converted to a job
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300/80">
                    Job ID: <code className="font-mono">{lead.convertedJobId}</code>
                    {lead.convertedAt && (
                      <> · {format(new Date(lead.convertedAt), 'd MMM yyyy, h:mm a')}</>
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                  onClick={() => {
                    // Hop into the Jobs tab — the parent page handles ?view=jobs.
                    const url = new URL(window.location.href)
                    url.searchParams.set('view', 'jobs')
                    window.history.pushState({}, '', url.toString())
                    window.dispatchEvent(new PopStateEvent('popstate'))
                  }}
                >
                  View jobs
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          </section>
        )}
      </div>

      {/* Footer — actions */}
      <div className="border-t bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleConvert}
            disabled={converting || isConverted}
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {isConverted ? 'Already converted' : 'Convert to job'}
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleting || isConverted}
            variant="ghost"
            className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </Button>
        </div>
        {isConverted && (
          <p className="mt-2 text-xs text-muted-foreground">
            Converted leads can&apos;t be deleted or moved back.
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small layout primitives
// ---------------------------------------------------------------------------

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lead attribution (campaign + UTM + tracking stats)
// ---------------------------------------------------------------------------

function LeadAttribution({ lead }: { lead: LeadRecord }) {
  const utm = lead.utmData ?? {}
  const utmEntries = Object.entries(utm).filter(([, v]) => asString(v).length > 0)

  const hasCampaign = !!lead.campaignId
  const hasTracking = !!lead.trackingId
  const hasUtm = utmEntries.length > 0

  if (!hasCampaign && !hasTracking && !hasUtm && lead.source === 'organic') {
    return (
      <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        No campaign attribution — this lead came in organically.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {/* Campaign */}
      {hasCampaign && (
        <InfoRow
          icon={<Sparkles className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Campaign"
          value={
            <span className="font-mono text-xs" title={lead.campaignId ?? ''}>
              {lead.campaignId}
            </span>
          }
        />
      )}

      {/* Tracking row */}
      {hasTracking && <TrackingStats lead={lead} />}

      {/* UTM */}
      {hasUtm && (
        <div className="rounded-lg border bg-card p-2.5">
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            UTM parameters
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {utmEntries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{asString(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasTracking && !hasUtm && !hasCampaign && (
        <p className="text-xs text-muted-foreground">
          Source: <span className="font-medium text-foreground">{lead.source}</span>
        </p>
      )}
    </div>
  )
}

function TrackingStats({ lead }: { lead: LeadRecord }) {
  const [stats, setStats] = React.useState<{
    clicks: number | null
    conversions: number | null
    revenueKobo: number | null
    loading: boolean
    error: string | null
  }>({ clicks: null, conversions: null, revenueKobo: null, loading: true, error: null })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!lead.trackingId) return
      try {
        // The marketing/track GET endpoint redirects; we don't have a direct
        // lookup endpoint, so we use the ROI analytics which returns tracking
        // rows for the user. Fall back gracefully if it fails.
        const res = await fetch('/api/marketing/roi', { cache: 'no-store' })
        if (!res.ok) throw new Error('roi_failed')
        const data = (await res.json()) as { tracking?: Array<Record<string, unknown>> }
        const trackingRows = Array.isArray(data.tracking) ? data.tracking : []
        const row = trackingRows.find((r) => asString(r.id) === lead.trackingId)
        if (cancelled) return
        if (row) {
          setStats({
            clicks: asNumberOrNull(row.clicks),
            conversions: asNumberOrNull(row.conversions),
            revenueKobo: asNumberOrNull(row.revenue_kobo ?? row.revenueKobo),
            loading: false,
            error: null,
          })
        } else {
          setStats({
            clicks: null,
            conversions: null,
            revenueKobo: null,
            loading: false,
            error: 'no_data',
          })
        }
      } catch (err) {
        if (cancelled) return
        setStats({
          clicks: null,
          conversions: null,
          revenueKobo: null,
          loading: false,
          error: err instanceof Error ? err.message : 'unknown',
        })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [lead.trackingId])

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>Tracking link</span>
        <span className="font-mono normal-case text-[10px] opacity-70" title={lead.trackingId ?? ''}>
          {lead.trackingId?.slice(0, 8)}…
        </span>
      </div>
      {stats.loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading click stats…
        </div>
      ) : stats.error ? (
        <p className="text-xs text-muted-foreground">Stats unavailable.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Stat mini label="Clicks" value={String(stats.clicks ?? 0)} />
          <Stat mini label="Conv." value={String(stats.conversions ?? 0)} />
          <Stat mini label="Revenue" value={formatKobo(stats.revenueKobo)} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, mini }: { label: string; value: string; mini?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
      <div className={cn('font-semibold', mini ? 'text-sm' : 'text-base')}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notes timeline
// ---------------------------------------------------------------------------

function NotesTimeline({ notes }: { notes: LeadNote[] }) {
  if (notes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
        No notes yet. Add the first one below.
      </p>
    )
  }
  const sorted = [...notes].sort((a, b) => {
    const at = a.at ? Date.parse(a.at) : 0
    const bt = b.at ? Date.parse(b.at) : 0
    return bt - at // newest first
  })
  return (
    <ol className="space-y-2.5">
      {sorted.map((note, i) => (
        <li key={`${note.at}-${i}`} className="relative flex gap-3">
          {/* Timeline dot + connector */}
          <div className="flex flex-col items-center">
            <span className="mt-1 h-2 w-2 rounded-full bg-violet-500 dark:bg-violet-400" />
            {i < sorted.length - 1 && (
              <span className="w-px flex-1 bg-border" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium">
                {note.author || 'Unknown'}
              </span>
              <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                {note.at ? format(new Date(note.at), 'd MMM, h:mm a') : ''}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
              {note.text}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Create lead dialog
// ---------------------------------------------------------------------------

function CreateLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (lead: LeadRecord) => void
}) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [company, setCompany] = React.useState('')
  const [source, setSource] = React.useState<LeadSource>('organic')
  const [requirements, setRequirements] = React.useState('')
  const [budgetKobo, setBudgetKobo] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  function reset() {
    setName('')
    setEmail('')
    setPhone('')
    setCompany('')
    setSource('organic')
    setRequirements('')
    setBudgetKobo('')
  }

  async function handleCreate() {
    const n = name.trim()
    const e = email.trim().toLowerCase()
    if (!n || !e) {
      toast.error('Name and email are required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      toast.error('Invalid email format.')
      return
    }
    const budgetNum = Number(budgetKobo.replace(/[^0-9]/g, ''))
    setCreating(true)
    try {
      const res = await api.createLead({
        name: n,
        email: e,
        phone: phone.trim() || undefined,
        company: company.trim() || undefined,
        source,
        requirements: requirements.trim() || undefined,
        budget: Number.isFinite(budgetNum) && budgetNum > 0 ? Math.floor(budgetNum) : undefined,
      })
      if (!res.ok || !res.lead) throw new Error('create_failed')
      onCreated(normalizeLead(res.lead as unknown as Record<string, unknown>))
      toast.success('Lead created')
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to create lead', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-violet-600 dark:text-violet-300" />
            New lead
          </DialogTitle>
          <DialogDescription>
            Add a lead manually. Use{' '}
            <code className="rounded bg-muted px-1 text-xs">/api/leads/capture</code>{' '}
            for public form submissions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lead-name">Name *</Label>
            <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Okonkwo" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-email">Email *</Label>
            <Input id="lead-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-phone">Phone</Label>
            <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234 …" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-company">Company</Label>
            <Input id="lead-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." />
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as LeadSource)}>
              <SelectTrigger className="w-full gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALID_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_BADGE[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-budget">Budget (kobo)</Label>
            <Input
              id="lead-budget"
              value={budgetKobo}
              onChange={(e) => setBudgetKobo(e.target.value)}
              inputMode="numeric"
              placeholder="50000000 = ₦500,000"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lead-req">Requirements</Label>
            <Textarea
              id="lead-req"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={3}
              placeholder="What is the lead looking for?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-700"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
