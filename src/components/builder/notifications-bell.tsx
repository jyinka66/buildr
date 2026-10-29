'use client'

// NotificationsBell — header icon button with a live unread badge.
// ------------------------------------------------------------------
// - Polls /api/notifications/unread-count every 20s.
// - Popover dropdown shows 8 most-recent notifications.
// - Click a notification: mark-as-read + navigate (source-routed).
// - "View all" button opens a full feed Sheet (NotificationsView).
// - "Mark all read" action in the popover footer.
//
// Self-contained — does not require a new entry in the View union.
// The full feed is rendered inside a Sheet (right side) so the user
// can review + filter without leaving their current screen.

import * as React from 'react'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import NotificationsView from '@/components/builder/notifications-view'

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
// Severity styling tokens.
// ---------------------------------------------------------------------------

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-zinc-400 dark:bg-zinc-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
}

const SEVERITY_BADGE: Record<string, string> = {
  info: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationsBell() {
  const session = useBuilder((s) => s.session)
  const openDashboard = useBuilder((s) => s.openDashboard)
  const openBusiness = useBuilder((s) => s.openBusiness)
  const openGodMode = useBuilder((s) => s.openGodMode)
  const openSettings = useBuilder((s) => s.openSettings)

  const [open, setOpen] = React.useState(false)
  const [fullOpen, setFullOpen] = React.useState(false)
  const [unread, setUnread] = React.useState(0)
  const [items, setItems] = React.useState<NotificationRow[]>([])
  const [loadingList, setLoadingList] = React.useState(false)
  const [markingAll, setMarkingAll] = React.useState(false)
  const [markingId, setMarkingId] = React.useState<string | null>(null)

  // --- unread count polling -------------------------------------------------
  const refreshCount = React.useCallback(async () => {
    if (!session) return
    try {
      const { unread: n } = await api.getUnreadCount()
      setUnread(n)
    } catch {
      /* non-fatal */
    }
  }, [session])

  React.useEffect(() => {
    void refreshCount()
    if (!session) return
    const id = setInterval(() => {
      void refreshCount()
    }, 20_000)
    return () => clearInterval(id)
  }, [session, refreshCount])

  // --- recent list (loaded on popover open) --------------------------------
  const refreshList = React.useCallback(async () => {
    setLoadingList(true)
    try {
      const { notifications } = await api.listNotifications({ limit: 8 })
      setItems(notifications)
    } catch {
      setItems([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) void refreshList()
  }, [open, refreshList])

  // Refresh count after the full sheet closes (read-all may have happened).
  React.useEffect(() => {
    if (!fullOpen) void refreshCount()
  }, [fullOpen, refreshCount])

  // --- actions --------------------------------------------------------------
  function routeFor(source: string): () => void | Promise<void> {
    switch (source) {
      case 'godmode':
        return () => openGodMode()
      case 'business':
      case 'marketing':
        return () => openBusiness()
      case 'support':
        return () => openSettings()
      default:
        return () => openDashboard()
    }
  }

  async function handleClick(n: NotificationRow) {
    // Optimistically mark as read locally.
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    )
    setUnread((u) => (n.readAt ? u : Math.max(0, u - 1)))
    setMarkingId(n.id)
    try {
      await api.markNotificationRead(n.id)
    } catch {
      /* non-fatal */
    } finally {
      setMarkingId(null)
    }
    setOpen(false)
    // Navigate after the popover closes.
    void routeFor(n.source)()
  }

  async function handleMarkAll() {
    setMarkingAll(true)
    // Optimistic.
    const nowIso = new Date().toISOString()
    setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? nowIso })))
    setUnread(0)
    try {
      await api.markAllNotificationsRead()
    } catch {
      /* non-fatal */
    } finally {
      setMarkingAll(false)
    }
  }

  function handleViewAll() {
    setOpen(false)
    setFullOpen(true)
  }

  // Hide the bell entirely when logged out — notifications require auth.
  if (!session) return null

  const unreadLabel = unread > 99 ? '99+' : String(unread)

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-[14px] text-white">
                {unreadLabel}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 p-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {unreadLabel} unread
                </Badge>
              )}
            </div>
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={markingAll || unread === 0}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              {markingAll ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Mark all read
            </button>
          </div>

          {/* List */}
          <ScrollArea className="h-[340px]">
            {loadingList ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
                <Bell className="h-6 w-6 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const unreadRow = !n.readAt
                  const severity = n.severity in SEVERITY_BADGE ? n.severity : 'info'
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => handleClick(n)}
                        disabled={markingId === n.id}
                        className={cn(
                          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-accent disabled:opacity-60',
                          unreadRow && 'bg-emerald-50/40 dark:bg-emerald-500/5',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full',
                            SEVERITY_DOT[severity] ?? SEVERITY_DOT.info,
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p
                              className={cn(
                                'truncate text-xs font-medium',
                                unreadRow ? 'text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {n.title}
                            </p>
                            <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </span>
                          </div>
                          {n.message && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {n.message}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                                SEVERITY_BADGE[severity],
                              )}
                            >
                              {severity}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {n.source}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>

          {/* Footer */}
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={handleViewAll}
            >
              View all
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Full feed sheet */}
      <Sheet open={fullOpen} onOpenChange={setFullOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Activity Feed
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <NotificationsView />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default NotificationsBell
