'use client'

// Analytics dashboard view. Fetches aggregated stats from GET /api/analytics
// on mount and on manual refresh. Renders KPI cards, a generations-over-time
// bar chart, tokens-by-provider progress bars, provider health pills, top
// integrations, and a recent-activity timeline. Handles 401 by opening the
// auth dialog via `useBuilder.openAuth('login')`. No footer (page shell owns it).

import * as React from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  BarChart3,
  Boxes,
  Clock,
  FolderGit2,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types — mirror the shape returned by GET /api/analytics.
// ---------------------------------------------------------------------------

type Totals = {
  projects: number
  generations: number
  tokens: number
  durationMs: number
  enabledProviders: number
  totalProviders: number
  totalIntegrations: number
}

type GenerationsByDayItem = { date: string; count: number; tokens: number }
type TokensByProviderItem = { provider: string; tokens: number }
type TopIntegrationItem = { key: string; name: string; count: number }
type HealthBreakdown = { healthy: number; degraded: number; down: number }
type RecentActivityItem = { action: string; time: string }

type AnalyticsData = {
  totals: Totals
  generationsByDay: GenerationsByDayItem[]
  tokensByProvider: TokensByProviderItem[]
  topIntegrations: TopIntegrationItem[]
  healthBreakdown: HealthBreakdown
  recentActivity: RecentActivityItem[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Emerald → teal → amber → zinc palette. NO indigo/blue/violet.
const PROVIDER_COLORS = [
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#0d9488', // teal-600
  '#f59e0b', // amber-500
  '#52525b', // zinc-600
  '#34d399', // emerald-400
]

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDay(date: string): string {
  // API returns YYYY-MM-DD; render MM-DD for the chart x-axis.
  const parts = date.split('-')
  if (parts.length !== 3) return date
  const [, m, d] = parts
  return `${m}-${d}`
}

function formatDayLabel(label: unknown): string {
  if (typeof label !== 'string') return String(label)
  const parts = label.split('-')
  if (parts.length !== 3) return label
  const [y, m, d] = parts
  return `${m}/${d}/${y}`
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return 'recently'
  }
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
} as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalyticsView() {
  const openAuth = useBuilder((s) => s.openAuth)

  const [data, setData] = React.useState<AnalyticsData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/analytics', { cache: 'no-store' })
      if (res.status === 401) {
        openAuth('login')
        return
      }
      if (!res.ok) {
        throw new Error(`request_failed (${res.status})`)
      }
      const json = (await res.json()) as AnalyticsData
      setData(json)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'analytics_load_failed'
      setError(msg)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [openAuth])

  React.useEffect(() => {
    void load()
  }, [load])

  const avgResponseSec = React.useMemo(() => {
    if (!data) return null
    if (data.totals.generations === 0) return null
    return data.totals.durationMs / data.totals.generations / 1000
  }, [data])

  const isEmpty = React.useMemo(() => {
    if (!data) return true
    return (
      data.totals.projects === 0 &&
      data.totals.generations === 0 &&
      data.totals.tokens === 0
    )
  }, [data])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
      {/* Header ---------------------------------------------------------- */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <BarChart3 className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Analytics</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Usage, performance and provider health across all your projects — aggregated over the
            last 14 days of activity.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={refreshing}
          className="h-9 self-start md:self-auto"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </header>

      {/* Error banner ---------------------------------------------------- */}
      {error && !loading && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300">
          Failed to load analytics: {error}
        </div>
      )}

      {/* Loading skeleton ------------------------------------------------ */}
      {loading && (
        <div className="mt-8 space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="gap-0 py-4">
                <CardContent className="flex items-center gap-3 px-4">
                  <Skeleton className="h-9 w-9 rounded-md" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-1 h-3 w-56" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-56 w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-1 h-3 w-32" />
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Empty state ------------------------------------------------------ */}
      {!loading && !error && isEmpty && (
        <Card className="mt-8 border-dashed py-10">
          <CardContent className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-medium">No analytics yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Once you create projects and generate code, usage stats, charts and provider
                health will show up here.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={refreshing}
              className="mt-1"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Dashboard ------------------------------------------------------- */}
      {!loading && !error && !isEmpty && data && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="mt-8 space-y-6"
        >
          {/* KPI row ----------------------------------------------------- */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <motion.div variants={itemVariants}>
              <KpiCard
                icon={<FolderGit2 className="h-4 w-4" />}
                label="Total Projects"
                value={data.totals.projects.toLocaleString()}
                hint={`${data.totals.totalIntegrations} integrations available`}
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <KpiCard
                icon={<Zap className="h-4 w-4" />}
                label="Total Generations"
                value={data.totals.generations.toLocaleString()}
                hint="Last 14 days"
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <KpiCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Total Tokens"
                value={formatTokens(data.totals.tokens)}
                hint={`${data.totals.tokens.toLocaleString()} consumed`}
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <KpiCard
                icon={<Clock className="h-4 w-4" />}
                label="Avg Response Time"
                value={
                  avgResponseSec === null ? '—' : `${avgResponseSec.toFixed(2)}s`
                }
                hint={
                  data.totals.generations === 0
                    ? 'No generations yet'
                    : `Across ${data.totals.generations.toLocaleString()} runs`
                }
              />
            </motion.div>
          </section>

          {/* Charts row -------------------------------------------------- */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <motion.div variants={itemVariants} className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-4 w-4 text-emerald-600" />
                    Generations over time
                  </CardTitle>
                  <CardDescription>
                    Generations per day for the last 14 days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.generationsByDay}
                        margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDay}
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          angle={-30}
                          textAnchor="end"
                          height={42}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={36}
                        />
                        <Tooltip
                          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                          contentStyle={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '0.5rem',
                            fontSize: '12px',
                            color: 'var(--card-foreground)',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                          }}
                          labelStyle={{ color: 'var(--muted-foreground)' }}
                          itemStyle={{ color: 'var(--card-foreground)' }}
                          labelFormatter={formatDayLabel}
                          formatter={(value, name) => {
                            const v =
                              typeof value === 'number'
                                ? value
                                : Array.isArray(value)
                                  ? Number(value[0])
                                  : Number(value)
                            const label =
                              name === 'count' ? 'Generations' : String(name)
                            return [v.toLocaleString(), label]
                          }}
                        />
                        <Bar
                          dataKey="count"
                          fill="#10b981"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={28}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4 text-emerald-600" />
                    Provider health
                  </CardTitle>
                  <CardDescription>
                    {data.totals.enabledProviders} of {data.totals.totalProviders} enabled
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2">
                  <HealthPill
                    label="Healthy"
                    count={data.healthBreakdown.healthy}
                    tone="emerald"
                  />
                  <HealthPill
                    label="Degraded"
                    count={data.healthBreakdown.degraded}
                    tone="amber"
                  />
                  <HealthPill
                    label="Down"
                    count={data.healthBreakdown.down}
                    tone="zinc"
                  />
                </CardContent>
              </Card>
            </motion.div>
          </section>

          {/* Bottom row -------------------------------------------------- */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <motion.div variants={itemVariants}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-emerald-600" />
                    Tokens by provider
                  </CardTitle>
                  <CardDescription>Total tokens consumed per LLM</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.tokensByProvider.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No tokens logged yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {data.tokensByProvider.map((item, i) => {
                        const max = data.tokensByProvider[0]?.tokens || 1
                        const pct = Math.max(
                          4,
                          Math.round((item.tokens / max) * 100),
                        )
                        const color =
                          PROVIDER_COLORS[i % PROVIDER_COLORS.length]
                        return (
                          <div key={`${item.provider}-${i}`} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="truncate font-medium">
                                {item.provider}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {formatTokens(item.tokens)}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full transition-[width] duration-500"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: color,
                                }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Boxes className="h-4 w-4 text-emerald-600" />
                    Top integrations
                  </CardTitle>
                  <CardDescription>
                    Most used across your projects
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.topIntegrations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No integrations used yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {data.topIntegrations.map((item) => (
                        <li
                          key={item.key}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="truncate text-sm font-medium">
                            {item.name}
                          </span>
                          <Badge
                            variant="secondary"
                            className="shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                          >
                            {item.count}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4 text-emerald-600" />
                    Recent activity
                  </CardTitle>
                  <CardDescription>Latest actions on your account</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.recentActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No activity recorded yet.
                    </p>
                  ) : (
                    <ol className="relative space-y-3 border-l border-border/60 pl-4">
                      {data.recentActivity.map((item, i) => (
                        <li
                          key={`${i}-${item.time}`}
                          className="relative"
                        >
                          <span
                            className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
                            aria-hidden
                          />
                          <p className="text-sm font-medium leading-tight">
                            {item.action}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatRelative(item.time)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </section>
        </motion.div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tabular-nums leading-tight">
            {value}
          </span>
          {hint && (
            <span className="truncate text-[10px] text-muted-foreground">
              {hint}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const HEALTH_TONES = {
  emerald: {
    wrapper:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  amber: {
    wrapper:
      'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  zinc: {
    wrapper:
      'bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
    dot: 'bg-zinc-400',
  },
} as const

function HealthPill({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: keyof typeof HEALTH_TONES
}) {
  const toneClass = HEALTH_TONES[tone]
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg border border-border/40 p-3 text-center',
        toneClass.wrapper,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', toneClass.dot)} aria-hidden />
      <span className="text-xl font-semibold tabular-nums">{count}</span>
      <span className="text-[10px] uppercase tracking-wide opacity-80">
        {label}
      </span>
    </div>
  )
}
