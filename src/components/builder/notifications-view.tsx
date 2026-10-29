'use client'

// NotificationsView — full activity feed.
// ------------------------------------------------------------------
// Layout (top → bottom):
//   1. Stats row — Unread / Errors / Warnings / Successes counts.
//   2. Source filter Tabs — All + one tab per source present in the feed.
//   3. Feed — each notification shows: source icon, title, message,
//      severity badge, relative time. Click to mark-as-read.
//
// Uses framer-motion for staggered list animation. Default export.
// Fetches its own data via the api client. Self-contained — suitable
// for embedding in the bell Sheet, the dashboard, or a route page.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  HeartPulse,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Megaphone,
  Rocket,
  Settings,
  Upload,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationRow = {
  id: string
  source: string
  severity: string
  title: string
  message: string
  readAt: string | null
  createdAt: string
}

// ---------------------------------------------------------------------------
// Source → icon mapping. Unknown sources fall back to Bell.
// ---------------------------------------------------------------------------

const SOURCE_ICON: Record<string, LucideIcon> = {
  cron: Clock,
  monitoring: Activity,
  heal: HeartPulse,
  support: ListChecks,
  jobs: Layers,
  godmode: Zap,
  marketing: Megaphone,
  business: Rocket,
  deployment: Upload,
  system: Settings,
}

const SOURCE_LABEL: Record<string, string> = {
  cron: 'Cron',
  monitoring: 'Monitoring',
  heal: 'Self-Heal',
  support: 'Support',
  jobs: 'Jobs',
  godmode: 'God Mode',
  marketing: 'Marketing',
  business: 'Business',
  deployment: 'Deploy',
  system: 'System',
}

// ---------------------------------------------------------------------------
// Severity → badge classes. Falls back to info styling.
// ---------------------------------------------------------------------------

const SEVERITY_META: Record<
  string,
  { label: string; chip: string; dot: string; icon: LucideIcon }
> = {
  info: {
    label: 'Info',
    chip: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
    dot: 'bg-zinc-400 dark:bg-zinc-500',
    icon: Info,
  },
  success: {
    label: 'Success',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  warning: {
    label: 'Warning',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
    icon: AlertTriangle,
  },
  error: {
    label: 'Error',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    dot: 'bg-red-500',
    icon: AlertTriangle,
  },
}

function severityMeta(severity: string) {
  return SEVERITY_META[severity] ?? SEVERITY_META.info
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string
  value: number
  icon: LucideIcon
  accent: string
}

function StatCard({ label, value, icon: Icon, accent }: StatCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-3 p-3">
        <span
          className={cn(
            'grid h-9 w-9 flex-shrink-0 place-items-center rounded-md',
            accent,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-lg font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Notification item
// ---------------------------------------------------------------------------

interface NotificationItemProps {
  n: NotificationRow
  marking: boolean
  onClick: () => void
}

function NotificationItem({ n, marking, onClick }: NotificationItemProps) {
  const SourceIcon = SOURCE_ICON[n.source] ?? Bell
  const sm = severityMeta(n.severity)
  const SeverityIcon = sm.icon
  const unread = !n.readAt

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      disabled={marking}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:bg-accent/60 disabled:opacity-60',
        unread
          ? 'border-l-2 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-500/5'
          : 'border-border',
      )}
    >
      {/* Source icon */}
      <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <SourceIcon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-medium leading-snug',
              unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {n.title}
          </p>
          <span className="flex-shrink-0 text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
          </span>
        </div>

        {n.message && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
            {n.message}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
              sm.chip,
            )}
          >
            <SeverityIcon className="h-3 w-3" />
            {sm.label}
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <SourceIcon className="h-2.5 w-2.5" />
            {SOURCE_LABEL[n.source] ?? n.source}
          </span>
          {unread && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <span className={cn('h-1.5 w-1.5 rounded-full', sm.dot)} />
              new
            </span>
          )}
        </div>
      </div>

      {marking && (
        <Loader2 className="absolute right-3 top-3 h-3 w-3 animate-spin text-muted-foreground" />
      )}
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

const ALL_TAB = 'all'

export default function NotificationsView() {
  const session = useBuilder((s) => s.session)

  const [items, setItems] = React.useState<NotificationRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeSource, setActiveSource] = React.useState<string>(ALL_TAB)
  const [markingId, setMarkingId] = React.useState<string | null>(null)
  const [markingAll, setMarkingAll] = React.useState(false)

  // --- load ----------------------------------------------------------------
  const load = React.useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const { notifications } = await api.listNotifications({ limit: 50 })
      setItems(notifications)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [session])

  React.useEffect(() => {
    void load()
  }, [load])

  // --- derived stats -------------------------------------------------------
  const stats = React.useMemo(() => {
    let unread = 0
    let errors = 0
    let warnings = 0
    let successes = 0
    for (const n of items) {
      if (!n.readAt) unread += 1
      if (n.severity === 'error') errors += 1
      if (n.severity === 'warning') warnings += 1
      if (n.severity === 'success') successes += 1
    }
    return { unread, errors, warnings, successes, total: items.length }
  }, [items])

  // --- source list (stable order) -----------------------------------------
  const sources = React.useMemo(() => {
    const seen = new Set<string>()
    const out: { value: string; label: string; count: number }[] = []
    for (const n of items) {
      if (seen.has(n.source)) continue
      seen.add(n.source)
      const count = items.filter((x) => x.source === n.source).length
      out.push({
        value: n.source,
        label: SOURCE_LABEL[n.source] ?? n.source,
        count,
      })
    }
    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  }, [items])

  // --- filtered list -------------------------------------------------------
  const filtered = React.useMemo(() => {
    if (activeSource === ALL_TAB) return items
    return items.filter((n) => n.source === activeSource)
  }, [items, activeSource])

  // --- actions -------------------------------------------------------------
  async function handleMarkRead(id: string) {
    const target = items.find((x) => x.id === id)
    if (!target) return
    if (target.readAt) return // already read
    // Optimistic update.
    const nowIso = new Date().toISOString()
    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, readAt: nowIso } : x)),
    )
    setMarkingId(id)
    try {
      await api.markNotificationRead(id)
    } catch {
      // Roll back on failure.
      setItems((prev) =>
        prev.map((x) => (x.id === id ? { ...x, readAt: null } : x)),
      )
    } finally {
      setMarkingId(null)
    }
  }

  async function handleMarkAll() {
    setMarkingAll(true)
    const nowIso = new Date().toISOString()
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? nowIso })))
    try {
      await api.markAllNotificationsRead()
    } catch {
      /* keep optimistic state */
    } finally {
      setMarkingAll(false)
    }
  }

  // --- empty states --------------------------------------------------------
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Sign in to view your activity feed.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        <StatCard
          label="Unread"
          value={stats.unread}
          icon={Bell}
          accent="bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300"
        />
        <StatCard
          label="Errors"
          value={stats.errors}
          icon={AlertTriangle}
          accent="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
        />
        <StatCard
          label="Warnings"
          value={stats.warnings}
          icon={AlertTriangle}
          accent="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        />
        <StatCard
          label="Successes"
          value={stats.successes}
          icon={CheckCircle2}
          accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        />
      </div>

      {/* Source tabs */}
      <div className="px-3">
        <Tabs value={activeSource} onValueChange={setActiveSource}>
          <div className="flex items-center justify-between gap-2">
            <TabsList className="h-8 flex-wrap">
              <TabsTrigger value={ALL_TAB} className="text-xs">
                All ({stats.total})
              </TabsTrigger>
              {sources.map((s) => (
                <TabsTrigger key={s.value} value={s.value} className="text-xs">
                  {s.label} ({s.count})
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={handleMarkAll}
              disabled={markingAll || stats.unread === 0}
            >
              {markingAll ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Mark all read
            </Button>
          </div>

          <TabsContent value={activeSource} className="mt-2 flex-1">
            <ScrollArea className="h-[calc(100vh-280px)] min-h-[280px]">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Bell className="h-6 w-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {stats.total === 0
                      ? 'No notifications yet.'
                      : 'No notifications for this source.'}
                  </p>
                </div>
              ) : (
                <motion.div
                  className="space-y-2 p-1"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: { staggerChildren: 0.03 },
                    },
                  }}
                >
                  <AnimatePresence initial={false}>
                    {filtered.map((n) => (
                      <NotificationItem
                        key={n.id}
                        n={n}
                        marking={markingId === n.id}
                        onClick={() => void handleMarkRead(n.id)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
