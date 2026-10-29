'use client'

// SupportView — AI Customer Support inbox.
// ------------------------------------------------------------------
// Two-pane layout (responsive):
//   ┌───────────────────┬────────────────────────────────────┐
//   │ Tickets list      │ Conversation thread                 │
//   │ (status filter)   │ (messages: customer/ai/human/system)│
//   │                   ├────────────────────────────────────┤
//   │                   │ Reply / Regenerate AI panel         │
//   │                   │ Actions: Resolve · Escalate · CSAT │
//   └───────────────────┴────────────────────────────────────┘
//
// On narrow screens the panes stack: list first, then thread when a ticket
// is selected (with a back button). Uses framer-motion + sonner + shadcn/ui.
// Self-contained — does not depend on editing api-client.ts or store.ts.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Headphones,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  User,
  X,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Local API client (we are not allowed to edit api-client.ts).
// ---------------------------------------------------------------------------

interface SupportMessage {
  id: string
  role: 'customer' | 'ai' | 'human' | 'system'
  content: string
  metadata: Record<string, unknown>
  createdAt: string
}

interface SupportTicket {
  id: string
  subject: string
  message: string
  customerEmail: string
  customerName: string | null
  status: string
  priority: string
  category: string
  aiResponse: string
  aiConfidence: number | null
  csatRating: number | null
  csatComment: string | null
  tags: string[]
  projectId: string | null
  businessId: string | null
  resolvedAt: string | null
  escalatedAt: string | null
  createdAt: string
  updatedAt: string
  messages: SupportMessage[]
}

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

const supportApi = {
  async listTickets(filter?: { status?: string; priority?: string }): Promise<{ tickets: SupportTicket[] }> {
    const params = new URLSearchParams()
    if (filter?.status) params.set('status', filter.status)
    if (filter?.priority) params.set('priority', filter.priority)
    const qs = params.toString()
    const res = await fetch(`/api/support/tickets${qs ? '?' + qs : ''}`, { cache: 'no-store' })
    return json(res)
  },

  async createTicket(body: {
    subject: string
    message: string
    customerEmail: string
    customerName?: string
    projectId?: string
    businessId?: string
  }): Promise<{ ok: boolean; ticket: SupportTicket; message: string }> {
    const res = await fetch('/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  async respond(
    id: string,
    body: { message?: string; role?: 'human' | 'customer'; regenerate?: boolean },
  ): Promise<{ ok: boolean; message: SupportMessage; ticket: Partial<SupportTicket> & { id: string }; parseError: string | null }> {
    const res = await fetch(`/api/support/tickets/${id}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  async resolve(id: string, comment?: string): Promise<{ ok: boolean; ticket: Partial<SupportTicket> & { id: string }; alreadyResolved?: boolean }> {
    const res = await fetch(`/api/support/tickets/${id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment }),
    })
    return json(res)
  },

  async escalate(id: string, reason?: string): Promise<{ ok: boolean; ticket: Partial<SupportTicket> & { id: string }; alreadyEscalated?: boolean }> {
    const res = await fetch(`/api/support/tickets/${id}/escalate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    return json(res)
  },

  async csat(id: string, rating: number, comment?: string): Promise<{ ok: boolean; wasRated: boolean; ticket: Partial<SupportTicket> & { id: string } }> {
    const res = await fetch(`/api/support/tickets/${id}/csat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, comment }),
    })
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

const STATUS_META: Record<string, { label: string; chip: string; icon: React.ReactNode }> = {
  new: {
    label: 'New',
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    icon: <Sparkles className="h-3 w-3" />,
  },
  triaged: {
    label: 'Triaged',
    chip: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  answering: {
    label: 'Answering',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    icon: <Bot className="h-3 w-3" />,
  },
  resolved: {
    label: 'Resolved',
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  escalated: {
    label: 'Escalated',
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    icon: <ShieldAlert className="h-3 w-3" />,
  },
  closed: {
    label: 'Closed',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400',
    icon: <X className="h-3 w-3" />,
  },
}

const PRIORITY_META: Record<string, { label: string; chip: string }> = {
  low: { label: 'Low', chip: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300' },
  normal: { label: 'Normal', chip: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  high: { label: 'High', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  urgent: { label: 'Urgent', chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
}

const ROLE_META: Record<string, { label: string; icon: React.ReactNode; accent: string; align: 'left' | 'right' }> = {
  customer: { label: 'Customer', icon: <User className="h-3 w-3" />, accent: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300', align: 'left' },
  ai: { label: 'AI Assistant', icon: <Bot className="h-3 w-3" />, accent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', align: 'left' },
  human: { label: 'Agent', icon: <Headphones className="h-3 w-3" />, accent: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300', align: 'right' },
  system: { label: 'System', icon: <AlertCircle className="h-3 w-3" />, accent: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400', align: 'left' },
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'answering', label: 'Answering' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]

function statusMeta(s: string) {
  return STATUS_META[s] ?? {
    label: s,
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
    icon: <Sparkles className="h-3 w-3" />,
  }
}
function priorityMeta(p: string) {
  return PRIORITY_META[p] ?? PRIORITY_META.normal
}
function roleMeta(r: string) {
  return ROLE_META[r] ?? ROLE_META.system
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function SupportView() {
  const [tickets, setTickets] = React.useState<SupportTicket[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [statusFilter, setStatusFilter] = React.useState<string>('all')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [showNew, setShowNew] = React.useState(false)

  // --- load tickets ----------------------------------------------------------
  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filter = statusFilter === 'all' ? undefined : { status: statusFilter }
      const { tickets } = await supportApi.listTickets(filter)
      setTickets(tickets)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  React.useEffect(() => {
    void load()
  }, [load])

  const selected = tickets.find((t) => t.id === selectedId) || null

  function handleTicketPatched(updated: Partial<SupportTicket> & { id: string }) {
    setTickets((prev) =>
      prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
    )
  }

  function handleTicketMessage(updated: Partial<SupportTicket> & { id: string }, msg: SupportMessage) {
    setTickets((prev) =>
      prev.map((t) =>
        t.id === updated.id
          ? {
              ...t,
              ...updated,
              messages: [...t.messages, msg],
            }
          : t,
      ),
    )
  }

  function handleCreated(ticket: SupportTicket) {
    setTickets((prev) => [ticket, ...prev])
    setSelectedId(ticket.id)
  }

  // --- empty / loading states -----------------------------------------------
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
            <Headphones className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">Customer Support</h1>
            <p className="text-xs text-muted-foreground">AI-triaged ticket inbox with agent escalation.</p>
          </div>
        </motion.div>
        <Button onClick={() => setShowNew(true)} className="gap-2">
          <Mail className="h-4 w-4" />
          New ticket
        </Button>
      </div>

      {error && (
        <Card className="mb-4 border-amber-300 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/10">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(280px,360px)_1fr]">
        {/* ─────────────── LEFT: Ticket list ─────────────── */}
        <div className="md:h-[calc(100vh-220px)]">
          {/* Status filter */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition',
                  statusFilter === f.value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground/40',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Card className="flex h-[calc(100%-2.5rem)] flex-col overflow-hidden">
            <CardHeader className="border-b px-3 py-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Inbox className="h-4 w-4" />
                Inbox
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {tickets.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                {loading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
                    <Inbox className="h-6 w-6 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">No tickets yet.</p>
                  </div>
                ) : (
                  <motion.div
                    className="space-y-1 p-2"
                    initial="hidden"
                    animate="visible"
                    variants={{
                      hidden: { opacity: 0 },
                      visible: { opacity: 1, transition: { staggerChildren: 0.02 } },
                    }}
                  >
                    {tickets.map((t) => (
                      <TicketRow
                        key={t.id}
                        ticket={t}
                        active={t.id === selectedId}
                        onClick={() => setSelectedId(t.id)}
                      />
                    ))}
                  </motion.div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* ─────────────── RIGHT: Conversation thread + actions ─────────────── */}
        <div className="md:h-[calc(100vh-220px)]">
          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Card className="border-dashed">
                  <CardContent className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                    <Headphones className="h-10 w-10 text-sky-500/50" />
                    <p className="font-medium">No ticket selected</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Pick a ticket from the inbox or create a new one to start chatting.
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <TicketDetail
                key={selected.id}
                ticket={selected}
                onBack={() => setSelectedId(null)}
                onPatched={handleTicketPatched}
                onMessage={handleTicketMessage}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* New ticket dialog */}
      <AnimatePresence>
        {showNew && (
          <NewTicketDialog
            onClose={() => setShowNew(false)}
            onCreated={(t) => {
              handleCreated(t)
              setShowNew(false)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ticket row (left pane)
// ---------------------------------------------------------------------------

function TicketRow({
  ticket,
  active,
  onClick,
}: {
  ticket: SupportTicket
  active: boolean
  onClick: () => void
}) {
  const sm = statusMeta(ticket.status)
  const pm = priorityMeta(ticket.priority)
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-md border p-2.5 text-left transition',
        active
          ? 'border-sky-400 bg-sky-50/50 dark:border-sky-700 dark:bg-sky-950/20'
          : 'border-border hover:border-sky-300 hover:bg-accent/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-1 text-sm font-medium">{ticket.subject}</p>
        <span className="flex-shrink-0 text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: false })}
        </span>
      </div>
      <p className="line-clamp-1 text-xs text-muted-foreground">
        {ticket.customerName ? `${ticket.customerName} · ` : ''}
        {ticket.customerEmail}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', sm.chip)}>
          {sm.icon}
          {sm.label}
        </span>
        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', pm.chip)}>
          {pm.label}
        </span>
        {ticket.csatRating !== null && (
          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Star className="h-2.5 w-2.5 fill-current" />
            {ticket.csatRating}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {ticket.messages.length} msg
        </span>
      </div>
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Ticket detail (right pane)
// ---------------------------------------------------------------------------

interface TicketDetailProps {
  ticket: SupportTicket
  onBack: () => void
  onPatched: (updated: Partial<SupportTicket> & { id: string }) => void
  onMessage: (updated: Partial<SupportTicket> & { id: string }, msg: SupportMessage) => void
}

function TicketDetail({ ticket, onBack, onPatched, onMessage }: TicketDetailProps) {
  const [reply, setReply] = React.useState('')
  const [sending, setSending] = React.useState<'reply' | 'regen' | null>(null)
  const [actionPending, setActionPending] = React.useState<string | null>(null)
  const [csatHover, setCsatHover] = React.useState(0)
  const [csatComment, setCsatComment] = React.useState('')

  const sm = statusMeta(ticket.status)
  const pm = priorityMeta(ticket.priority)
  const isClosed = ticket.status === 'resolved' || ticket.status === 'closed'
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [ticket.messages.length])

  async function handleSendReply() {
    if (reply.trim().length < 2) {
      toast.error('Please enter a reply.')
      return
    }
    setSending('reply')
    const t = toast.loading('Sending reply + regenerating AI…')
    try {
      const res = await supportApi.respond(ticket.id, {
        message: reply.trim(),
        role: 'human',
      })
      onMessage(res.ticket, res.message)
      setReply('')
      toast.dismiss(t)
      if (res.parseError) {
        toast.warning('Reply sent, but AI draft had a parse warning.', {
          description: res.parseError,
        })
      } else {
        toast.success('Reply sent + AI response generated.')
      }
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'reply_failed')
    } finally {
      setSending(null)
    }
  }

  async function handleRegenerate() {
    setSending('regen')
    const t = toast.loading('Regenerating AI response…')
    try {
      const res = await supportApi.respond(ticket.id, { regenerate: true })
      onMessage(res.ticket, res.message)
      toast.dismiss(t)
      if (res.parseError) {
        toast.warning('Regenerated, but with a parse warning.', {
          description: res.parseError,
        })
      } else {
        toast.success('AI response regenerated.')
      }
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'regenerate_failed')
    } finally {
      setSending(null)
    }
  }

  async function handleResolve() {
    setActionPending('resolve')
    try {
      const res = await supportApi.resolve(ticket.id)
      onPatched(res.ticket)
      if (res.alreadyResolved) {
        toast.info('Ticket was already resolved.')
      } else {
        toast.success('Ticket resolved.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'resolve_failed')
    } finally {
      setActionPending(null)
    }
  }

  async function handleEscalate() {
    setActionPending('escalate')
    try {
      const res = await supportApi.escalate(ticket.id)
      onPatched(res.ticket)
      if (res.alreadyEscalated) {
        toast.info('Ticket was already escalated.')
      } else {
        toast.warning('Ticket escalated. Priority bumped.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'escalate_failed')
    } finally {
      setActionPending(null)
    }
  }

  async function handleSetCsat(rating: number) {
    setActionPending(`csat-${rating}`)
    try {
      const res = await supportApi.csat(ticket.id, rating, csatComment.trim() || undefined)
      onPatched(res.ticket)
      toast.success(`CSAT set to ${rating}/5.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'csat_failed')
    } finally {
      setActionPending(null)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="flex h-full flex-col"
    >
      <Card className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <CardHeader className="border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <button
                onClick={onBack}
                className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to inbox
              </button>
              <CardTitle className="text-base">{ticket.subject}</CardTitle>
              <CardDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span>{ticket.customerName || ticket.customerEmail}</span>
                <span className="text-muted-foreground/60">·</span>
                <span className="font-mono text-[10px]">{ticket.customerEmail}</span>
              </CardDescription>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', sm.chip)}>
                  {sm.icon}
                  {sm.label}
                </span>
                <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', pm.chip)}>
                  {pm.label} priority
                </span>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {ticket.category}
                </Badge>
                {ticket.aiConfidence !== null && (
                  <Badge variant="secondary" className="text-[10px]">
                    AI {(ticket.aiConfidence * 100).toFixed(0)}%
                  </Badge>
                )}
                {ticket.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    #{tag}
                  </Badge>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>
        </CardHeader>

        {/* Conversation thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {ticket.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Inbox className="h-6 w-6" />
              <p className="text-xs">No messages yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ticket.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        {/* Reply + actions panel */}
        <div className="border-t bg-muted/20">
          {/* Action buttons row */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleResolve}
              disabled={actionPending === 'resolve' || isClosed}
              className="gap-1.5 text-xs"
            >
              {actionPending === 'resolve' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Resolve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleEscalate}
              disabled={actionPending === 'escalate' || ticket.status === 'escalated'}
              className="gap-1.5 text-xs"
            >
              {actionPending === 'escalate' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              Escalate
            </Button>

            {/* CSAT rater */}
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">CSAT</span>
              {[1, 2, 3, 4, 5].map((n) => {
                const active = (csatHover || ticket.csatRating || 0) >= n
                return (
                  <button
                    key={n}
                    onClick={() => void handleSetCsat(n)}
                    onMouseEnter={() => setCsatHover(n)}
                    onMouseLeave={() => setCsatHover(0)}
                    disabled={actionPending === `csat-${n}`}
                    className="transition hover:scale-110 disabled:opacity-60"
                    aria-label={`Rate ${n} stars`}
                  >
                    <Star
                      className={cn(
                        'h-3.5 w-3.5',
                        active
                          ? 'fill-amber-400 text-amber-500'
                          : 'text-muted-foreground/40',
                      )}
                    />
                  </button>
                )
              })}
              {ticket.csatRating !== null && (
                <Input
                  placeholder="Optional comment…"
                  value={csatComment}
                  onChange={(e) => setCsatComment(e.target.value)}
                  className="ml-2 h-7 w-40 text-[11px]"
                />
              )}
            </div>
          </div>

          {/* Reply composer */}
          <div className="space-y-2 p-3">
            <Textarea
              placeholder={isClosed ? 'Ticket is closed.' : 'Type a reply — AI will draft a follow-up…'}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              className="resize-none text-sm"
              disabled={isClosed}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRegenerate}
                disabled={sending !== null || ticket.messages.length === 0}
                className="gap-1.5 text-xs"
              >
                {sending === 'regen' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Regenerate AI
              </Button>
              <Button
                size="sm"
                onClick={handleSendReply}
                disabled={sending !== null || isClosed || reply.trim().length < 2}
                className="gap-1.5"
              >
                {sending === 'reply' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send + regenerate
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: SupportMessage }) {
  const meta = roleMeta(message.role)
  const isSystem = message.role === 'system'
  const isAgent = message.role === 'human'

  if (isSystem) {
    return (
      <div className="flex items-center justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {meta.icon}
          <span className="ml-1">{message.content}</span>
        </span>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-2', meta.align === 'right' && 'flex-row-reverse')}
    >
      <span
        className={cn(
          'mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full',
          meta.accent,
        )}
      >
        {meta.icon}
      </span>
      <div className={cn('min-w-0 max-w-[80%]', meta.align === 'right' && 'text-right')}>
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-medium">{meta.label}</span>
          <span>· {formatDistanceToNow(new Date(message.createdAt), { addSuffix: false })} ago</span>
        </div>
        <div
          className={cn(
            'inline-block rounded-lg px-3 py-2 text-sm',
            isAgent
              ? 'bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-500/15 dark:text-fuchsia-100'
              : message.role === 'ai'
                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100'
                : 'bg-blue-100 text-blue-900 dark:bg-blue-500/15 dark:text-blue-100',
            meta.align === 'right' && 'text-left',
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          {message.role === 'ai' && typeof message.metadata.confidence === 'number' && (
            <p className="mt-1 border-t border-current/10 pt-1 text-[10px] opacity-70">
              confidence: {(Number(message.metadata.confidence) * 100).toFixed(0)}%
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// New ticket dialog
// ---------------------------------------------------------------------------

function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (ticket: SupportTicket) => void
}) {
  const [subject, setSubject] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [customerEmail, setCustomerEmail] = React.useState('')
  const [customerName, setCustomerName] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  async function handleCreate() {
    if (subject.trim().length < 3) {
      toast.error('Subject must be at least 3 characters.')
      return
    }
    if (message.trim().length < 10) {
      toast.error('Message must be at least 10 characters.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      toast.error('Please enter a valid customer email.')
      return
    }
    setCreating(true)
    const t = toast.loading('Creating ticket + running AI triage…')
    try {
      const res = await supportApi.createTicket({
        subject: subject.trim(),
        message: message.trim(),
        customerEmail: customerEmail.trim(),
        customerName: customerName.trim() || undefined,
      })
      toast.dismiss(t)
      toast.success('Ticket created + AI response sent.', {
        description: `Category: ${res.ticket.category} · Priority: ${res.ticket.priority}`,
      })
      onCreated(res.ticket)
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'create_failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Mail className="h-5 w-5 text-sky-600" />
                  New support ticket
                </CardTitle>
                <CardDescription>
                  The AI will auto-triage the category, priority, and draft a reply.
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
              <Input
                placeholder="e.g. Can't reset my password"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Customer email</label>
                <Input
                  type="email"
                  placeholder="customer@example.com"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Customer name (optional)</label>
                <Input
                  placeholder="Jane Doe"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Message</label>
              <Textarea
                placeholder="Describe the customer's issue in detail…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={creating}
              className="w-full gap-2"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create + AI triage
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
