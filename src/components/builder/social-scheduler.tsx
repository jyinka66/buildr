'use client'

// SocialScheduler — multi-platform scheduling + auto-post composer.
// ------------------------------------------------------------------
// Rendered as a new tab inside the Marketing view. Provides:
//   A. Calendar View     — 7-col week / month grid with post cards on their days.
//   B. Compose Dialog    — title, body, multi-platform, date+time, best-time
//                          chips, hashtags, per-platform character counts.
//   C. Connected Accounts Bar — connected social accounts + "Connect Account".
//   D. Post Cards        — list of scheduled posts with edit / delete.
//
// API:
//   GET    /api/marketing/schedule?status=&from=&to=
//   POST   /api/marketing/schedule
//   PATCH  /api/marketing/schedule/[id]
//   DELETE /api/marketing/schedule/[id]
//   GET    /api/marketing/accounts
//   POST   /api/marketing/accounts
//   DELETE /api/marketing/accounts/[id]
//   GET    /api/marketing/best-times

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hash,
  Instagram,
  Linkedin,
  Loader2,
  Music2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Twitter,
  Facebook,
  Plug,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Calendar as DatePicker } from '@/components/ui/calendar'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Platform = 'meta' | 'x' | 'linkedin' | 'instagram' | 'tiktok'

interface ScheduledPost {
  id: string
  title: string
  content: string
  platforms: string[]
  mediaUrls?: string[]
  hashtags?: string[]
  scheduledAt: string
  status: string
  campaignId?: string | null
  postedAt?: string | null
  results?: Record<string, PlatformResult>
  createdAt?: string
  updatedAt?: string
}

interface AccountResult {
  ok: boolean
  name?: string
  url?: string | null
  error?: string
}

interface PlatformResult {
  ok: boolean
  error?: string
  accounts?: Record<string, AccountResult>
}

interface SocialAccount {
  id: string
  platform: string
  accountName: string
  handle?: string | null
  avatarUrl?: string | null
  connected?: boolean
  /** False for placeholder accounts that were added without real OAuth. */
  canPublish?: boolean
  createdAt?: string
}

interface BestTimesResponse {
  times: Record<string, string[]>
  meta: Record<string, { times: string[]; note: string }>
}

const PLATFORMS: { value: Platform; label: string; icon: React.ReactNode; charLimit: number; color: string }[] = [
  { value: 'meta', label: 'Meta', icon: <Facebook className="h-4 w-4" />, charLimit: 2200, color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  { value: 'x', label: 'X', icon: <Twitter className="h-4 w-4" />, charLimit: 280, color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300' },
  { value: 'linkedin', label: 'LinkedIn', icon: <Linkedin className="h-4 w-4" />, charLimit: 2200, color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { value: 'instagram', label: 'Instagram', icon: <Instagram className="h-4 w-4" />, charLimit: 2200, color: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300' },
  { value: 'tiktok', label: 'TikTok', icon: <Music2 className="h-4 w-4" />, charLimit: 2200, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
]

const PLATFORM_MAP: Record<string, (typeof PLATFORMS)[number]> = PLATFORMS.reduce(
  (acc, p) => {
    acc[p.value] = p
    return acc
  },
  {} as Record<string, (typeof PLATFORMS)[number]>,
)

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  posting: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  posted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  draft: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function jsonOrThrow<T>(res: Response): Promise<T> {
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

async function apiListPosts(opts?: { status?: string; from?: string; to?: string }): Promise<ScheduledPost[]> {
  const params = new URLSearchParams()
  if (opts?.status) params.set('status', opts.status)
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  const qs = params.toString()
  const res = await fetch(`/api/marketing/schedule${qs ? '?' + qs : ''}`, { cache: 'no-store' })
  const data = await jsonOrThrow<{ posts: ScheduledPost[] }>(res)
  return data.posts
}

async function apiCreatePost(body: {
  title: string
  content: string
  platforms: string[]
  scheduledAt: string
  mediaUrls?: string[]
  hashtags?: string[]
  campaignId?: string
}): Promise<ScheduledPost> {
  const res = await fetch('/api/marketing/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await jsonOrThrow<{ ok: boolean; post: ScheduledPost }>(res)
  return data.post
}

async function apiUpdatePost(
  id: string,
  body: Partial<{
    title: string
    content: string
    platforms: string[]
    scheduledAt: string
    mediaUrls: string[]
    hashtags: string[]
    status: string
  }>,
): Promise<ScheduledPost> {
  const res = await fetch(`/api/marketing/schedule/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await jsonOrThrow<{ ok: boolean; post: ScheduledPost }>(res)
  return data.post
}

async function apiDeletePost(id: string): Promise<void> {
  const res = await fetch(`/api/marketing/schedule/${id}`, { method: 'DELETE' })
  await jsonOrThrow<{ ok: boolean }>(res)
}

async function apiListAccounts(): Promise<{ accounts: SocialAccount[]; providers: Record<string, boolean> }> {
  const res = await fetch('/api/marketing/accounts', { cache: 'no-store' })
  const data = await jsonOrThrow<{ accounts: SocialAccount[]; providers?: Record<string, boolean> }>(res)
  return { accounts: data.accounts, providers: data.providers ?? {} }
}

async function apiConnectAccount(body: { platform: string; accountName: string; handle?: string }): Promise<SocialAccount> {
  const res = await fetch('/api/marketing/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await jsonOrThrow<{ ok: boolean; account: SocialAccount }>(res)
  return data.account
}

async function apiDisconnectAccount(id: string): Promise<void> {
  const res = await fetch(`/api/marketing/accounts/${id}`, { method: 'DELETE' })
  await jsonOrThrow<{ ok: boolean }>(res)
}

async function apiBestTimes(): Promise<BestTimesResponse> {
  const res = await fetch('/api/marketing/best-times', { cache: 'no-store' })
  return jsonOrThrow<BestTimesResponse>(res)
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const p = PLATFORM_MAP[platform]
  if (!p) return <Badge variant="outline" className={className}>{platform}</Badge>
  return (
    <Badge variant="secondary" className={cn('gap-1', p.color, className)}>
      {p.icon}
      <span className="text-[10px] font-medium">{p.label}</span>
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('capitalize', STATUS_STYLE[status] || STATUS_STYLE.draft)}>
      {status}
    </Badge>
  )
}

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const p = PLATFORM_MAP[platform]
  if (!p) return null
  return <span className={cn('inline-flex', className)}>{p.icon}</span>
}

function charLimitFor(platforms: string[]): number {
  // Tightest limit among selected platforms governs the visible count.
  if (platforms.length === 0) return 2200
  return Math.min(...platforms.map((p) => PLATFORM_MAP[p]?.charLimit ?? 2200))
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SocialScheduler() {
  const [posts, setPosts] = React.useState<ScheduledPost[]>([])
  const [accounts, setAccounts] = React.useState<SocialAccount[]>([])
  const [providers, setProviders] = React.useState<Record<string, boolean>>({})
  const [loadingPosts, setLoadingPosts] = React.useState(true)
  const [loadingAccounts, setLoadingAccounts] = React.useState(true)
  const [calendarMode, setCalendarMode] = React.useState<'week' | 'month'>('week')
  const [cursor, setCursor] = React.useState<Date>(startOfDay(new Date()))
  const [statusFilter, setStatusFilter] = React.useState<string>('all')

  const [composeOpen, setComposeOpen] = React.useState(false)
  const [editingPost, setEditingPost] = React.useState<ScheduledPost | null>(null)
  const [detailPost, setDetailPost] = React.useState<ScheduledPost | null>(null)
  const [pickedDate, setPickedDate] = React.useState<Date | null>(null)

  const refreshPosts = React.useCallback(async () => {
    setLoadingPosts(true)
    try {
      const opts: { status?: string } = {}
      if (statusFilter !== 'all') opts.status = statusFilter
      const list = await apiListPosts(opts)
      setPosts(list)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load scheduled posts.')
    } finally {
      setLoadingPosts(false)
    }
  }, [statusFilter])

  // Put a failed post back in the queue. Accounts that already posted are skipped by the
  // publisher, so only the failed ones are tried again.
  async function handleRetry(post: ScheduledPost) {
    try {
      await apiUpdatePost(post.id, { status: 'scheduled', scheduledAt: new Date().toISOString() })
      toast.success('Retry queued. It will be published within a few minutes.')
      setDetailPost(null)
      void refreshPosts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not retry the post.')
    }
  }

  const refreshAccounts = React.useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const { accounts: list, providers: configured } = await apiListAccounts()
      setAccounts(list)
      setProviders(configured)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load accounts.')
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  React.useEffect(() => {
    refreshPosts()
  }, [refreshPosts])

  React.useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  // Navigation helpers for the calendar grid.
  const goPrev = React.useCallback(() => {
    setCursor((c) => (calendarMode === 'week' ? subDays(c, 7) : subMonths(c, 1)))
  }, [calendarMode])
  const goNext = React.useCallback(() => {
    setCursor((c) => (calendarMode === 'week' ? addDays(c, 7) : addMonths(c, 1)))
  }, [calendarMode])
  const goToday = React.useCallback(() => setCursor(startOfDay(new Date())), [])

  // Build the list of days to render on the grid.
  const gridDays = React.useMemo(() => {
    if (calendarMode === 'week') {
      const start = startOfWeek(cursor, { weekStartsOn: 0 })
      const end = endOfWeek(cursor, { weekStartsOn: 0 })
      return eachDayOfInterval({ start, end })
    }
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
    return eachDayOfInterval({ start, end })
  }, [cursor, calendarMode])

  const postsForDay = React.useCallback(
    (day: Date) => {
      return posts
        .filter((p) => {
          if (!p.scheduledAt) return false
          try {
            return isSameDay(parseISO(p.scheduledAt), day)
          } catch {
            return false
          }
        })
        .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))
    },
    [posts],
  )

  const gridCaption =
    calendarMode === 'week'
      ? `${format(gridDays[0], 'MMM d')} – ${format(gridDays[6], 'MMM d, yyyy')}`
      : format(cursor, 'MMMM yyyy')

  const handleSave = React.useCallback(async (post: ScheduledPost) => {
    setPosts((prev) => {
      const idx = prev.findIndex((p) => p.id === post.id)
      if (idx === -1) return [post, ...prev]
      const copy = [...prev]
      copy[idx] = post
      return copy.sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))
    })
    setEditingPost(null)
    setComposeOpen(false)
    setPickedDate(null)
  }, [])

  const openCompose = React.useCallback((opts?: { edit?: ScheduledPost; date?: Date }) => {
    setEditingPost(opts?.edit ?? null)
    setPickedDate(opts?.date ?? null)
    setComposeOpen(true)
  }, [])

  const handleDelete = React.useCallback(async (post: ScheduledPost) => {
    try {
      await apiDeletePost(post.id)
      setPosts((prev) => prev.filter((p) => p.id !== post.id))
      toast.success('Post cancelled.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete post.')
    }
  }, [])

  const totalThisWeek = React.useMemo(() => {
    return posts.filter((p) => {
      try {
        const d = parseISO(p.scheduledAt)
        return gridDays.some((day) => isSameDay(day, d))
      } catch {
        return false
      }
    }).length
  }, [posts, gridDays])

  return (
    <div className="space-y-6">
      {/* Connected accounts bar */}
      <ConnectedAccountsBar
        accounts={accounts}
        providers={providers}
        loading={loadingAccounts}
        onChange={refreshAccounts}
      />

      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <CalendarDays className="h-5 w-5 text-pink-600 dark:text-pink-400" />
            Content Calendar
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalThisWeek} {calendarMode === 'week' ? 'this week' : 'this month'} · {posts.length} total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="w-[140px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center rounded-md border">
            <Button
              variant={calendarMode === 'week' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-r-none"
              onClick={() => setCalendarMode('week')}
            >
              Week
            </Button>
            <Button
              variant={calendarMode === 'month' ? 'default' : 'ghost'}
              size="sm"
              className="rounded-l-none"
              onClick={() => setCalendarMode('month')}
            >
              Month
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => openCompose()}
          >
            <Plus className="h-4 w-4" />
            Schedule Post
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goPrev} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goNext} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <CardTitle className="text-sm font-medium text-muted-foreground">{gridCaption}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 pb-2 sm:px-3 sm:pb-3">
          <div className="min-w-[420px]">
          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 px-1 pb-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((day) => {
              const dayPosts = postsForDay(day)
              const inMonth = calendarMode === 'month' ? isSameMonth(day, cursor) : true
              const today = isToday(day)
              return (
                <motion.div
                  key={day.toISOString()}
                  layout
                  className={cn(
                    'group relative min-h-[88px] rounded-md border p-1.5 transition-colors sm:min-h-[120px]',
                    inMonth ? 'bg-card' : 'bg-muted/30 text-muted-foreground',
                    today && 'border-pink-400 ring-1 ring-pink-400/40 dark:border-pink-600',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-xs font-medium',
                        today && 'grid h-5 w-5 place-items-center rounded-full bg-pink-500 text-white',
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
                      onClick={() => {
                        const d = new Date(day)
                        d.setHours(9, 0, 0, 0)
                        openCompose({ date: d })
                      }}
                      aria-label="Add post on this day"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayPosts.slice(0, calendarMode === 'week' ? 4 : 2).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setDetailPost(p)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left text-[10px] transition-colors',
                          'bg-pink-500/10 hover:bg-pink-500/20 dark:bg-pink-500/15 dark:hover:bg-pink-500/25',
                          'border border-pink-500/20',
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-pink-700 dark:text-pink-300">
                            {format(parseISO(p.scheduledAt), 'HH:mm')}
                          </span>
                          <div className="ml-auto flex gap-0.5">
                            {p.platforms.slice(0, 3).map((pl) => (
                              <PlatformIcon key={pl} platform={pl} className="[&>svg]:h-2.5 [&>svg]:w-2.5" />
                            ))}
                          </div>
                        </div>
                        <span className="line-clamp-1 text-[10px] text-foreground/80">{p.title}</span>
                      </button>
                    ))}
                    {dayPosts.length > (calendarMode === 'week' ? 4 : 2) && (
                      <button
                        onClick={() => setDetailPost(dayPosts[(calendarMode === 'week' ? 4 : 2)])}
                        className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        +{dayPosts.length - (calendarMode === 'week' ? 4 : 2)} more
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
          </div>
        </CardContent>
      </Card>

      {/* Post cards list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">
            All Scheduled Posts ({posts.length})
          </h3>
        </div>
        {loadingPosts ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">No scheduled posts yet</p>
                <p className="text-xs text-muted-foreground">Click "Schedule Post" to compose your first one.</p>
              </div>
              <Button size="sm" onClick={() => openCompose()}>
                <Plus className="h-4 w-4" />
                Schedule Post
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={() => openCompose({ edit: post })}
                  onDelete={() => handleDelete(post)}
                  onClick={() => setDetailPost(post)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Compose / Edit dialog */}
      <ComposeDialog
        open={composeOpen}
        onOpenChange={(o) => {
          setComposeOpen(o)
          if (!o) {
            setEditingPost(null)
            setPickedDate(null)
          }
        }}
        editing={editingPost}
        pickedDate={pickedDate}
        onSaved={handleSave}
      />

      {/* Detail dialog */}
      <PostDetailDialog post={detailPost} onClose={() => setDetailPost(null)} onRetry={handleRetry} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Connected Accounts Bar
// ---------------------------------------------------------------------------

function ConnectedAccountsBar({
  accounts,
  providers,
  loading,
  onChange,
}: {
  accounts: SocialAccount[]
  providers: Record<string, boolean>
  loading: boolean
  onChange: () => void
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Card className="bg-muted/30">
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        <div className="mr-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Plug className="h-3.5 w-3.5" />
          Connected Accounts
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : accounts.length === 0 ? (
          <span className="text-xs text-muted-foreground">No accounts connected yet.</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {accounts.map((a) => (
              <AccountChip key={a.id} account={a} onChange={onChange} />
            ))}
          </div>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto h-7 gap-1 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Connect Account
            </Button>
          </DialogTrigger>
          <ConnectAccountDialog
            providers={providers}
            onClose={() => setOpen(false)}
            onConnected={() => {
              setOpen(false)
              onChange()
            }}
          />
        </Dialog>
      </CardContent>
    </Card>
  )
}

function AccountChip({ account, onChange }: { account: SocialAccount; onChange: () => void }) {
  const [removing, setRemoving] = React.useState(false)
  const p = PLATFORM_MAP[account.platform]
  return (
    <div className="group flex items-center gap-1.5 rounded-full border bg-background py-1 pl-2 pr-1 text-xs">
      <span className={cn('inline-flex', p?.color)}>{p?.icon ?? <Plug className="h-3.5 w-3.5" />}</span>
      <span className="font-medium">{account.accountName}</span>
      {account.handle && <span className="text-muted-foreground">@{account.handle}</span>}
      {account.canPublish === false && (
        <span
          className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
          title="This account was added without signing in to the platform, so posts cannot be published to it. Disconnect it and connect it again."
        >
          not linked
        </span>
      )}
      <button
        disabled={removing}
        onClick={async () => {
          setRemoving(true)
          try {
            await apiDisconnectAccount(account.id)
            toast.success(`Disconnected ${account.accountName}.`)
            onChange()
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to disconnect.')
          } finally {
            setRemoving(false)
          }
        }}
        className="ml-1 grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rose-500/15 hover:text-rose-600"
        aria-label={`Disconnect ${account.accountName}`}
      >
        {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </button>
    </div>
  )
}

function ConnectAccountDialog({
  providers,
  onClose,
  onConnected,
}: {
  providers: Record<string, boolean>
  onClose: () => void
  onConnected: () => void
}) {
  const [platform, setPlatform] = React.useState<string>('meta')
  const [accountName, setAccountName] = React.useState('')
  const [handle, setHandle] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountName.trim()) {
      toast.error('Account name is required.')
      return
    }
    setSaving(true)
    try {
      await apiConnectAccount({ platform, accountName: accountName.trim(), handle: handle.trim() || undefined })
      toast.success('Account connected.')
      setAccountName('')
      setHandle('')
      onConnected()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect account.')
    } finally {
      setSaving(false)
    }
  }

  // When this server has OAuth credentials for the platform, connecting signs in on the
  // platform itself so posts can really be published. Otherwise only a placeholder is possible.
  const live = providers[platform] === true
  const platformLabel = PLATFORM_MAP[platform]?.label ?? platform

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Connect a social account</DialogTitle>
        <DialogDescription>
          {live
            ? `You will sign in on ${platformLabel} and approve posting. Buildr stores the access token encrypted.`
            : `${platformLabel} sign-in is not set up on this server yet, so a placeholder account is saved. Posts cannot be published to a placeholder. See SOCIAL-PUBLISHING.md to add the ${platformLabel} credentials.`}
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={
          live
            ? (e) => {
                e.preventDefault()
                // Full-page navigation on purpose: this is an API route that redirects to the platform.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign(`/api/marketing/accounts/oauth/${platform}/start`)
              }
            : handleSubmit
        }
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="connect-platform">Platform</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger id="connect-platform" className="w-full">
              <SelectValue placeholder="Pick a platform" />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  <span className="flex items-center gap-2">
                    {p.icon}
                    {p.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!live && (<>
        <div className="space-y-1.5">
          <Label htmlFor="connect-name">Account name</Label>
          <Input
            id="connect-name"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. Acme Inc."
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="connect-handle">Handle <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            id="connect-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@acme"
          />
        </div>
        </>)}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {live ? `Continue to ${platformLabel}` : 'Save placeholder'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

// ---------------------------------------------------------------------------
// Post Card
// ---------------------------------------------------------------------------

function PostCard({
  post,
  onClick,
  onEdit,
  onDelete,
}: {
  post: ScheduledPost
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = React.useState(false)
  let when = ''
  try {
    when = format(parseISO(post.scheduledAt), 'EEE, MMM d · HH:mm')
  } catch {
    when = post.scheduledAt
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
    >
      <Card className="group cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-sm">{post.title}</CardTitle>
              <CardDescription className="flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3" />
                {when}
              </CardDescription>
            </div>
            <StatusBadge status={post.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="line-clamp-3 text-xs text-muted-foreground">{post.content}</p>
          <div className="flex flex-wrap items-center gap-1">
            {post.platforms.map((p) => (
              <PlatformBadge key={p} platform={p} />
            ))}
          </div>
          {post.hashtags && post.hashtags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
              <Hash className="h-3 w-3" />
              {post.hashtags.slice(0, 5).map((h) => (
                <span key={h} className="rounded bg-muted px-1.5 py-0.5">#{h}</span>
              ))}
              {post.hashtags.length > 5 && <span>+{post.hashtags.length - 5}</span>}
            </div>
          )}
          <div className="flex items-center justify-end gap-1 border-t pt-2" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true)
                await onDelete()
                setDeleting(false)
              }}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Post Detail Dialog
// ---------------------------------------------------------------------------

function PostResults({ results }: { results: Record<string, PlatformResult> }) {
  const entries = Object.entries(results).filter(([platform]) => !platform.startsWith('_'))
  if (entries.length === 0) return null
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      <div className="font-medium">Publishing results</div>
      {entries.map(([platform, result]) => (
        <div key={platform} className="space-y-1">
          <div className="flex items-center gap-1.5">
            <PlatformBadge platform={platform} />
            <span className={result.ok ? 'text-emerald-600' : 'text-rose-600'}>{result.ok ? 'Posted' : 'Failed'}</span>
          </div>
          {result.error && <p className="text-rose-600">{result.error}</p>}
          {Object.entries(result.accounts ?? {}).map(([id, a]) => (
            <p key={id} className="pl-1 text-muted-foreground">
              {a.name ?? id}:{' '}
              {a.ok ? (
                a.url ? <a className="underline" href={a.url} target="_blank" rel="noreferrer noopener">view post</a> : 'posted'
              ) : (
                <span className="text-rose-600">{a.error ?? 'failed'}</span>
              )}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

function PostDetailDialog({
  post,
  onClose,
  onRetry,
}: {
  post: ScheduledPost | null
  onClose: () => void
  onRetry: (post: ScheduledPost) => Promise<void>
}) {
  return (
    <Dialog open={!!post} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {post && (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between gap-2">
                <DialogTitle className="pr-6">{post.title}</DialogTitle>
                <StatusBadge status={post.status} />
              </div>
              <DialogDescription className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {(() => {
                  try {
                    return format(parseISO(post.scheduledAt), "EEE, MMM d, yyyy 'at' HH:mm")
                  } catch {
                    return post.scheduledAt
                  }
                })()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1">
                {post.platforms.map((p) => (
                  <PlatformBadge key={p} platform={p} />
                ))}
              </div>
              <ScrollArea className="max-h-60 rounded-md border bg-muted/20 p-3">
                <p className="whitespace-pre-wrap text-sm">{post.content}</p>
              </ScrollArea>
              {post.hashtags && post.hashtags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  {post.hashtags.map((h) => (
                    <span key={h} className="rounded bg-muted px-1.5 py-0.5">#{h}</span>
                  ))}
                </div>
              )}
              {post.mediaUrls && post.mediaUrls.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {post.mediaUrls.length} media attachment{post.mediaUrls.length === 1 ? '' : 's'}
                </div>
              )}
              {post.results && <PostResults results={post.results} />}
            </div>
            <DialogFooter>
              {post.status === 'failed' && (
                <Button variant="outline" onClick={() => void onRetry(post)}>Retry failed platforms</Button>
              )}
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Compose Dialog
// ---------------------------------------------------------------------------

interface ComposeForm {
  title: string
  content: string
  platforms: string[]
  scheduledAt: string // ISO
  hashtags: string
  mediaUrls: string
}

function emptyForm(): ComposeForm {
  // Default to one hour from now, rounded to the next 15-min mark.
  const now = new Date()
  now.setMinutes(now.getMinutes() + 60 - (now.getMinutes() % 15), 0, 0)
  return {
    title: '',
    content: '',
    platforms: ['meta'],
    scheduledAt: now.toISOString(),
    hashtags: '',
    mediaUrls: '',
  }
}

function toLocalDateTimeInput(iso: string): string {
  try {
    const d = new Date(iso)
    const tzOffsetMs = d.getTimezoneOffset() * 60000
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16)
  } catch {
    return ''
  }
}

function fromLocalDateTimeInput(value: string): string {
  if (!value) return ''
  return new Date(value).toISOString()
}

function ComposeDialog({
  open,
  onOpenChange,
  editing,
  pickedDate,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: ScheduledPost | null
  pickedDate: Date | null
  onSaved: (post: ScheduledPost) => void
}) {
  const [form, setForm] = React.useState<ComposeForm>(emptyForm)
  const [bestTimes, setBestTimes] = React.useState<BestTimesResponse | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Reset form when opening or when the editing target changes.
  React.useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        title: editing.title,
        content: editing.content,
        platforms: [...editing.platforms],
        scheduledAt: editing.scheduledAt,
        hashtags: (editing.hashtags ?? []).join(', '),
        mediaUrls: (editing.mediaUrls ?? []).join(', '),
      })
    } else {
      // Honor a picked date from the calendar (default to 09:00 of that day).
      const base = pickedDate ?? new Date()
      const seed = new Date(base)
      if (!pickedDate) {
        // Default to one hour from now, rounded to the next 15-min mark.
        seed.setMinutes(seed.getMinutes() + 60 - (seed.getMinutes() % 15), 0, 0)
      } else {
        seed.setHours(9, 0, 0, 0)
      }
      setForm({
        title: '',
        content: '',
        platforms: ['meta'],
        scheduledAt: seed.toISOString(),
        hashtags: '',
        mediaUrls: '',
      })
    }
  }, [open, editing, pickedDate])

  // Pre-fetch best-time suggestions once.
  React.useEffect(() => {
    if (!open || bestTimes) return
    apiBestTimes()
      .then(setBestTimes)
      .catch(() => {
        /* non-fatal */
      })
  }, [open, bestTimes])

  const togglePlatform = (p: string) => {
    setForm((f) => {
      const has = f.platforms.includes(p)
      return {
        ...f,
        platforms: has ? f.platforms.filter((x) => x !== p) : [...f.platforms, p],
      }
    })
  }

  const charLimit = charLimitFor(form.platforms)
  const overLimit = form.content.length > charLimit

  function applyBestTime(time: string) {
    // time like "09:00" → combine with current scheduled date.
    const d = new Date(form.scheduledAt)
    const [h, m] = time.split(':').map((n) => parseInt(n, 10))
    d.setHours(h || 0, m || 0, 0, 0)
    setForm((f) => ({ ...f, scheduledAt: d.toISOString() }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('Title is required.')
    if (!form.content.trim()) return toast.error('Content is required.')
    if (form.platforms.length === 0) return toast.error('Select at least one platform.')
    if (overLimit) return toast.error(`Content exceeds the ${charLimit}-character limit.`)
    if (!form.scheduledAt || Number.isNaN(Date.parse(form.scheduledAt))) {
      return toast.error('Pick a date and time.')
    }

    const hashtags = form.hashtags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const mediaUrls = form.mediaUrls
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    setSaving(true)
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        platforms: form.platforms,
        scheduledAt: form.scheduledAt,
        hashtags,
        mediaUrls,
      }
      const saved = editing
        ? await apiUpdatePost(editing.id, payload)
        : await apiCreatePost(payload)
      toast.success(editing ? 'Post updated.' : 'Post scheduled!')
      onSaved(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save post.')
    } finally {
      setSaving(false)
    }
  }

  const localDateTime = toLocalDateTimeInput(form.scheduledAt)
  const selectedDayForPicker = form.scheduledAt ? new Date(form.scheduledAt) : new Date()

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-pink-600 dark:text-pink-400" />
            {editing ? 'Edit scheduled post' : 'Compose a new post'}
          </DialogTitle>
          <DialogDescription>
            Schedule once, publish across Meta, X, LinkedIn, Instagram & TikTok.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="post-title">Title</Label>
            <Input
              id="post-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Launch day announcement"
              autoFocus
            />
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="post-content">Post content</Label>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  overLimit ? 'text-rose-600' : 'text-muted-foreground',
                )}
              >
                {form.content.length} / {charLimit}
                {form.platforms.length > 1 && (
                  <span className="ml-1 text-muted-foreground">(tightest limit of selected)</span>
                )}
              </span>
            </div>
            <Textarea
              id="post-content"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={5}
              placeholder="Write your caption here…"
            />
          </div>

          {/* Platforms */}
          <div className="space-y-1.5">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const active = form.platforms.includes(p.value)
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePlatform(p.value)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? cn('border-transparent', p.color)
                        : 'bg-background text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {p.icon}
                    {p.label}
                    <span className="text-[9px] opacity-70">{p.charLimit}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date + time */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="post-date">Date &amp; time</Label>
              <Input
                id="post-date"
                type="datetime-local"
                value={localDateTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, scheduledAt: fromLocalDateTimeInput(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Pick a day</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-xs font-normal">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {selectedDayForPicker ? format(selectedDayForPicker, 'EEE, MMM d, yyyy') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <DatePicker
                    mode="single"
                    selected={selectedDayForPicker}
                    onSelect={(d) => {
                      if (!d) return
                      const cur = new Date(form.scheduledAt)
                      d.setHours(cur.getHours(), cur.getMinutes(), 0, 0)
                      setForm((f) => ({ ...f, scheduledAt: d.toISOString() }))
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Best time chips */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              AI best-time suggestions
            </Label>
            {bestTimes ? (
              <div className="space-y-2">
                {form.platforms.map((pl) => {
                  const meta = bestTimes.meta[pl]
                  if (!meta) return null
                  return (
                    <div key={pl} className="flex flex-wrap items-center gap-1.5">
                      <PlatformBadge platform={pl} />
                      {meta.times.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => applyBestTime(t)}
                          className="rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-pink-500/15 hover:text-pink-700 dark:hover:text-pink-300"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )
                })}
                <p className="text-[10px] text-muted-foreground">
                  Tap a time to apply it to today&apos;s picked date.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading suggestions…
              </div>
            )}
          </div>

          {/* Hashtags */}
          <div className="space-y-1.5">
            <Label htmlFor="post-hashtags" className="flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" />
              Hashtags
            </Label>
            <Input
              id="post-hashtags"
              value={form.hashtags}
              onChange={(e) => setForm((f) => ({ ...f, hashtags: e.target.value }))}
              placeholder="launch, saas, ai (comma-separated, no #)"
            />
            {form.hashtags.trim() && (
              <div className="flex flex-wrap items-center gap-1">
                {form.hashtags
                  .split(',')
                  .map((s) => s.trim().replace(/^#/, ''))
                  .filter(Boolean)
                  .map((h, i) => (
                    <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">#{h}</span>
                  ))}
              </div>
            )}
          </div>

          {/* Media URLs */}
          <div className="space-y-1.5">
            <Label htmlFor="post-media">Media URLs <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="post-media"
              value={form.mediaUrls}
              onChange={(e) => setForm((f) => ({ ...f, mediaUrls: e.target.value }))}
              placeholder="https://cdn…/image.png (comma-separated)"
            />
          </div>

          <Separator />

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || overLimit}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              {editing ? 'Update post' : 'Schedule post'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default SocialScheduler
