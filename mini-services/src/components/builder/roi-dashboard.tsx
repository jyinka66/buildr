'use client'

// RoiDashboard — Campaign ROI tracking dashboard.
// ------------------------------------------------------------------
// Fetches aggregate ROI data from GET /api/marketing/roi and renders:
//   1. Top metrics row: Total Clicks, Total Conversions, Conversion Rate,
//      Total Revenue (formatted as NGN ₦).
//   2. Campaign breakdown table (clicks, conversions, revenue, CTR).
//   3. Platform breakdown bar chart (per utm_source performance).
//   4. Top performing tracking links list.
//   5. Recent clicks timeline.
//   6. "Create Tracking Link" button → dialog → generates short link with
//      copy-to-clipboard.
//
// Handles 401 by opening the auth dialog. Toasts via sonner.

import * as React from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
  Target,
  TrendingUp,
  DollarSign,
} from 'lucide-react'
import { toast } from 'sonner'

import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types — mirror GET /api/marketing/roi
// ---------------------------------------------------------------------------

interface RoiData {
  totalClicks: number
  totalConversions: number
  totalRevenueKobo: number
  conversionRate: number
  byCampaign: {
    campaignId: string
    campaignName: string
    clicks: number
    conversions: number
    revenue: number
    ctr: number
  }[]
  byPlatform: {
    platform: string
    clicks: number
    conversions: number
    revenue: number
  }[]
  topPerforming: {
    trackingId: string
    shortCode: string
    clicks: number
    conversions: number
    revenue: number
  }[]
  recentClicks: {
    trackingId: string
    clickedAt: string
    source: string
  }[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Emerald → teal → amber → zinc palette (matches analytics-view).
const PLATFORM_COLORS = [
  '#10b981', '#14b8a6', '#0d9488', '#f59e0b', '#52525b', '#34d399',
  '#0ea5e9', '#8b5cf6', '#ec4899', '#f97316',
]

function formatNaira(kobo: number): string {
  return (kobo / 100).toLocaleString('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 2,
  })
}

function formatCompactKobo(kobo: number): string {
  const naira = kobo / 100
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(1)}M`
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(1)}K`
  return formatNaira(kobo)
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return 'recently'
  }
}

function platformColor(idx: number): string {
  return PLATFORM_COLORS[idx % PLATFORM_COLORS.length]
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
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <motion.div variants={itemVariants}>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">
                {value}
              </p>
              {sub ? (
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              ) : null}
            </div>
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', accent)}>
              {icon}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Create Tracking Link dialog
// ---------------------------------------------------------------------------

function CreateLinkDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const [destinationUrl, setDestinationUrl] = React.useState('')
  const [source, setSource] = React.useState('')
  const [medium, setMedium] = React.useState('')
  const [campaign, setCampaign] = React.useState('')
  const [content, setContent] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [result, setResult] = React.useState<{ shortCode: string; shortUrl: string } | null>(null)

  function reset() {
    setDestinationUrl('')
    setSource('')
    setMedium('')
    setCampaign('')
    setContent('')
    setResult(null)
  }

  async function handleCreate() {
    if (!destinationUrl.trim()) {
      toast.error('Destination URL is required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/marketing/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destinationUrl: destinationUrl.trim(),
          source: source.trim(),
          medium: medium.trim(),
          campaign: campaign.trim(),
          content: content.trim(),
        }),
      })
      if (res.status === 401) {
        toast.error('Please sign in to create tracking links')
        onOpenChange(false)
        return
      }
      const data = (await res.json()) as { ok?: boolean; shortCode?: string; shortUrl?: string; error?: string }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `request_failed (${res.status})`)
      }
      setResult({ shortCode: data.shortCode!, shortUrl: data.shortUrl! })
      toast.success('Tracking link created')
      onCreated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'create_failed'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  async function copyShortUrl() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.shortUrl)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Could not copy — select and copy manually')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-emerald-600" />
            Create Tracking Link
          </DialogTitle>
          <DialogDescription>
            Generate a short link with UTM parameters. Share it anywhere — clicks and conversions are tracked automatically.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-emerald-50/50 p-4 dark:bg-emerald-500/5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your short link
              </p>
              <p className="mt-1.5 break-all font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {result.shortUrl}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Short code: <span className="font-mono">{result.shortCode}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={copyShortUrl} variant="default" className="flex-1">
                <Copy className="mr-2 h-4 w-4" />
                Copy Link
              </Button>
              <Button asChild variant="outline">
                <a href={result.shortUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Test
                </a>
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full"
              onClick={reset}
            >
              Create another
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="dest-url">Destination URL</Label>
              <Input
                id="dest-url"
                placeholder="https://yoursite.com/landing"
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="utm-source">UTM Source</Label>
                <Input
                  id="utm-source"
                  placeholder="google, meta, newsletter"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="utm-medium">UTM Medium</Label>
                <Input
                  id="utm-medium"
                  placeholder="cpc, email, social"
                  value={medium}
                  onChange={(e) => setMedium(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="utm-campaign">UTM Campaign</Label>
                <Input
                  id="utm-campaign"
                  placeholder="black_friday, launch_q4"
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="utm-content">UTM Content</Label>
                <Input
                  id="utm-content"
                  placeholder="variant_a, hero_ad (optional)"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {!result && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !destinationUrl.trim()}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RoiDashboard() {
  const openAuth = useBuilder((s) => s.openAuth)

  const [data, setData] = React.useState<RoiData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/marketing/roi', { cache: 'no-store' })
      if (res.status === 401) {
        openAuth('login')
        return
      }
      if (!res.ok) {
        throw new Error(`request_failed (${res.status})`)
      }
      const json = (await res.json()) as RoiData
      setData(json)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'roi_load_failed'
      setError(msg)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [openAuth])

  React.useEffect(() => {
    void load()
  }, [load])

  const isEmpty = React.useMemo(() => {
    if (!data) return true
    return (
      data.totalClicks === 0 &&
      data.totalConversions === 0 &&
      data.totalRevenueKobo === 0 &&
      data.byCampaign.length === 0
    )
  }, [data])

  const platformChartData = React.useMemo(() => {
    if (!data) return []
    return data.byPlatform.map((p) => ({
      platform: p.platform,
      clicks: p.clicks,
      conversions: p.conversions,
      revenue: p.revenue,
    }))
  }, [data])

  return (
    <div className="mx-auto w-full max-w-5xl px-1 py-6">
      {/* Header ------------------------------------------------------- */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">ROI Dashboard</h2>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Track clicks, conversions, and revenue across every campaign link you create.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={refreshing}
            className="h-9"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="h-9"
          >
            <Plus className="h-4 w-4" />
            Create Tracking Link
          </Button>
        </div>
      </header>

      {/* Body --------------------------------------------------------- */}
      {loading ? (
        <div className="mt-8 space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[112px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[320px] rounded-xl" />
        </div>
      ) : error ? (
        <Card className="mt-8">
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
              <Link2 className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-lg font-semibold">No tracking data yet</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Create your first tracking link to start measuring clicks, conversions, and revenue.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Tracking Link
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="mt-8 space-y-6"
        >
          {/* Metrics row -------------------------------------------- */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          >
            <MetricCard
              icon={<MousePointerClick className="h-5 w-5" />}
              label="Total Clicks"
              value={data.totalClicks.toLocaleString()}
              accent="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"
            />
            <MetricCard
              icon={<Target className="h-5 w-5" />}
              label="Conversions"
              value={data.totalConversions.toLocaleString()}
              accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
            />
            <MetricCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Conversion Rate"
              value={`${data.conversionRate.toFixed(2)}%`}
              accent="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
            />
            <MetricCard
              icon={<DollarSign className="h-5 w-5" />}
              label="Total Revenue"
              value={formatNaira(data.totalRevenueKobo)}
              accent="bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
            />
          </motion.div>

          {/* Platform breakdown chart + top performing -------------- */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <motion.div variants={itemVariants} className="lg:col-span-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Platform Breakdown</CardTitle>
                  <CardDescription>Clicks per traffic source (UTM source)</CardDescription>
                </CardHeader>
                <CardContent>
                  {platformChartData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No platform data yet.
                    </p>
                  ) : (
                    <div className="h-[260px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={platformChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                          <XAxis
                            dataKey="platform"
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 12 }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip
                            cursor={{ fill: 'rgba(16,185,129,0.08)' }}
                            contentStyle={{
                              borderRadius: 8,
                              border: '1px solid hsl(var(--border))',
                              fontSize: 12,
                            }}
                            formatter={(value: number, name: string) => {
                              if (name === 'revenue') return [formatCompactKobo(value), 'Revenue']
                              return [value, name.charAt(0).toUpperCase() + name.slice(1)]
                            }}
                          />
                          <Bar dataKey="clicks" radius={[4, 4, 0, 0]}>
                            {platformChartData.map((_, i) => (
                              <Cell key={i} fill={platformColor(i)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants} className="lg:col-span-2">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="text-base">Top Performing Links</CardTitle>
                  <CardDescription>Best-converting tracking links</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.topPerforming.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No conversions recorded yet.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {data.topPerforming.map((t, i) => (
                        <li key={t.trackingId} className="flex items-center gap-3">
                          <span
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: platformColor(i) }}
                          >
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-sm font-medium">
                              {t.shortCode}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t.clicks.toLocaleString()} clicks · {t.conversions.toLocaleString()} conversions
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatCompactKobo(t.revenue)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Campaign breakdown table ------------------------------ */}
          <motion.div variants={itemVariants}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Campaign Breakdown</CardTitle>
                <CardDescription>Per-campaign performance and CTR</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byCampaign.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No campaign-level data yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campaign</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">Conversions</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byCampaign.map((c) => (
                        <TableRow key={c.campaignId}>
                          <TableCell className="font-medium">
                            {c.campaignName}
                            {c.campaignId === 'uncategorized' && (
                              <Badge variant="outline" className="ml-2 text-[10px]">uncategorized</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.clicks.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.conversions.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatCompactKobo(c.revenue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.ctr.toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Recent clicks ----------------------------------------- */}
          {data.recentClicks.length > 0 && (
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent Clicks</CardTitle>
                  <CardDescription>Latest activity across your links</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {data.recentClicks.map((c) => (
                      <li
                        key={c.trackingId + c.clickedAt}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                            {c.source}
                          </Badge>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {c.trackingId.slice(0, 8)}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelative(c.clickedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </motion.div>
      ) : null}

      <CreateLinkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
    </div>
  )
}
