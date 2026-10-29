'use client'

// WebhooksView — outgoing webhook management.
// ------------------------------------------------------------------
// Layout (top → bottom):
//   1. Header
//   2. One-time secret reveal banner (appears after create — dismissible)
//   3. Create form (URL + event selector + description)
//   4. Webhook list:
//      - URL, events, enable/disable, last delivery status
//      - "Send test" button → calls /test endpoint
//      - "View deliveries" expandable → calls /deliveries endpoint
//      - Delete button
//
// Self-contained — does not depend on editing api-client.ts or store.ts.
// Uses framer-motion + sonner + shadcn/ui.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Send,
  Trash2,
  Webhook,
  XCircle,
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Local API client (we are not allowed to edit api-client.ts).
// ---------------------------------------------------------------------------

interface Webhook {
  id: string
  url: string
  events: string[]
  description: string
  enabled: boolean
  lastTriggeredAt: string | null
  lastStatus: string | null
  lastStatusCode: number | null
  deliveryCount: number
  failCount: number
  createdAt: string
  updatedAt: string
}

interface Delivery {
  id: string
  eventType: string
  status: string
  statusCode: number | null
  responseBody: string | null
  attempt: number
  deliveredAt: string | null
  nextRetryAt: string | null
  createdAt: string
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

const webhooksApi = {
  async list(): Promise<{ webhooks: Webhook[]; events: string[] }> {
    const res = await fetch('/api/webhooks', { cache: 'no-store' })
    return json(res)
  },
  async create(body: {
    url: string
    events: string[]
    description?: string
  }): Promise<{ webhook: Webhook; secret: string }> {
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
  async remove(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/webhooks?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    return json(res)
  },
  async test(id: string): Promise<{
    ok: boolean
    status: string
    statusCode: number | null
    responseBody: string
  }> {
    const res = await fetch(`/api/webhooks/${encodeURIComponent(id)}/test`, { method: 'POST' })
    return json(res)
  },
  async deliveries(id: string): Promise<{ deliveries: Delivery[] }> {
    const res = await fetch(`/api/webhooks/${encodeURIComponent(id)}/deliveries`, { cache: 'no-store' })
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WebhooksView() {
  const [webhooks, setWebhooks] = React.useState<Webhook[]>([])
  const [events, setEvents] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)

  // create form
  const [url, setUrl] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [selectedEvents, setSelectedEvents] = React.useState<string[]>([])
  const [creating, setCreating] = React.useState(false)
  const [showCreate, setShowCreate] = React.useState(false)

  // one-time secret reveal
  const [revealed, setRevealed] = React.useState<{ secret: string; url: string } | null>(null)
  const [showSecret, setShowSecret] = React.useState(true)

  // per-webhook UI state
  const [testingId, setTestingId] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [deliveries, setDeliveries] = React.useState<Delivery[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = React.useState(false)
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { webhooks, events } = await webhooksApi.list()
      setWebhooks(webhooks)
      setEvents(events)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load webhooks')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    )
  }

  async function handleCreate() {
    if (!/^https?:\/\//i.test(url.trim())) {
      toast.error('Please provide a valid HTTP(S) URL.')
      return
    }
    if (selectedEvents.length === 0) {
      toast.error('Please select at least one event.')
      return
    }
    setCreating(true)
    const t = toast.loading('Creating webhook…')
    try {
      const result = await webhooksApi.create({
        url: url.trim(),
        events: selectedEvents,
        description: description.trim(),
      })
      toast.dismiss(t)
      toast.success('Webhook created.', {
        description: 'Copy the signing secret now — it will not be shown again.',
      })
      setRevealed({ secret: result.secret, url: result.webhook.url })
      setShowSecret(true)
      setUrl('')
      setDescription('')
      setSelectedEvents([])
      setShowCreate(false)
      await load()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Failed to create webhook')
    } finally {
      setCreating(false)
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Delete this webhook? This cannot be undone.')) return
    setRemovingId(id)
    const t = toast.loading('Deleting…')
    try {
      await webhooksApi.remove(id)
      toast.dismiss(t)
      toast.success('Webhook deleted.')
      if (expandedId === id) setExpandedId(null)
      await load()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setRemovingId(null)
    }
  }

  async function handleTest(wh: Webhook) {
    setTestingId(wh.id)
    const t = toast.loading('Sending test event…')
    try {
      const result = await webhooksApi.test(wh.id)
      toast.dismiss(t)
      if (result.ok) {
        toast.success('Test delivered.', {
          description: `HTTP ${result.statusCode ?? '—'}`,
        })
      } else {
        toast.error('Test failed.', {
          description: `HTTP ${result.statusCode ?? 'network'} — ${result.responseBody.slice(0, 120) || 'no response body'}`,
        })
      }
      await load()
      if (expandedId === wh.id) {
        void loadDeliveries(wh.id)
      }
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setTestingId(null)
    }
  }

  async function loadDeliveries(id: string) {
    setLoadingDeliveries(true)
    try {
      const { deliveries } = await webhooksApi.deliveries(id)
      setDeliveries(deliveries)
    } catch {
      setDeliveries([])
    } finally {
      setLoadingDeliveries(false)
    }
  }

  async function toggleExpand(wh: Webhook) {
    if (expandedId === wh.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(wh.id)
    await loadDeliveries(wh.id)
  }

  async function copyToClipboard(text: string, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
    } catch {
      toast.error('Clipboard unavailable — copy manually.')
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white">
            <Webhook className="h-5 w-5" />
          </span>
          Webhooks
        </motion.h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Outgoing webhooks fire when events happen in your account. Each webhook is signed with an
          HMAC-SHA256 secret — verify it on the receiver with the <code className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[11px]">x-buildr-signature</code> header.
        </p>
      </div>

      {/* One-time secret reveal banner */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-6"
          >
            <Card className="border-2 border-sky-400 dark:border-sky-700">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base text-sky-700 dark:text-sky-300">
                    <Webhook className="h-4 w-4" />
                    Signing secret for {revealed.url}
                  </CardTitle>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRevealed(null)}>
                    Dismiss
                  </Button>
                </div>
                <CardDescription>
                  This secret will never be shown again. Copy it now and store it securely — you&apos;ll need it to verify webhook signatures.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border border-sky-300 bg-sky-50 px-3 py-2 font-mono text-xs dark:bg-sky-950/20">
                    {showSecret ? revealed.secret : '•'.repeat(revealed.secret.length)}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setShowSecret((s) => !s)}
                    title={showSecret ? 'Hide' : 'Show'}
                  >
                    {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => copyToClipboard(revealed.secret, 'Secret copied')}
                    title="Copy"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form (collapsible) */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader
          className="cursor-pointer select-none bg-muted/30"
          onClick={() => setShowCreate((s) => !s)}
        >
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-sky-600" />
              Create Webhook
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
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wh-url" className="text-xs">Endpoint URL</Label>
                  <Input
                    id="wh-url"
                    placeholder="https://api.example.com/hooks/buildr"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wh-desc" className="text-xs">Description (optional)</Label>
                  <Input
                    id="wh-desc"
                    placeholder="Production webhook — Slack notifications"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Events to subscribe to ({selectedEvents.length} selected)
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {events.map((event) => {
                      const checked = selectedEvents.includes(event)
                      return (
                        <label
                          key={event}
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition',
                            checked
                              ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-500/10'
                              : 'border-border hover:border-sky-300',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleEvent(event)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-xs font-medium">{event}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full gap-2 bg-gradient-to-r from-sky-600 to-blue-600 text-white hover:from-sky-700 hover:to-blue-700"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create Webhook
                </Button>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Webhook list */}
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Your Webhooks ({webhooks.length})
      </h2>
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <Webhook className="h-8 w-8 text-sky-500/50" />
            <p className="font-medium">No webhooks yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a webhook to receive signed event notifications on your own server.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => {
            const isExpanded = expandedId === wh.id
            return (
              <motion.div key={wh.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{wh.url}</p>
                          {wh.enabled ? (
                            <Badge variant="secondary" className="gap-1 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 text-xs bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300">
                              disabled
                            </Badge>
                          )}
                          {wh.failCount > 0 && (
                            <Badge variant="secondary" className="gap-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              {wh.failCount} failures
                            </Badge>
                          )}
                        </div>
                        {wh.description && (
                          <p className="mt-1 text-xs text-muted-foreground">{wh.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {wh.events.map((e) => (
                            <Badge key={e} variant="outline" className="font-mono text-[10px]">{e}</Badge>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{wh.deliveryCount} deliveries</span>
                          {wh.lastTriggeredAt && (
                            <span>
                              last fired {formatDistanceToNow(new Date(wh.lastTriggeredAt), { addSuffix: true })}
                            </span>
                          )}
                          {wh.lastStatus && (
                            <LastStatusBadge status={wh.lastStatus} code={wh.lastStatusCode} />
                          )}
                          <span>created {formatDistanceToNow(new Date(wh.createdAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          disabled={testingId === wh.id}
                          onClick={() => handleTest(wh)}
                        >
                          {testingId === wh.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs text-red-500 hover:text-red-600"
                          disabled={removingId === wh.id}
                          onClick={() => handleRemove(wh.id)}
                        >
                          {removingId === wh.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <button
                      onClick={() => toggleExpand(wh)}
                      className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {isExpanded ? 'Hide delivery log' : 'View delivery log'}
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 space-y-1.5">
                            {loadingDeliveries ? (
                              <div className="flex h-16 items-center justify-center">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            ) : deliveries.length === 0 ? (
                              <p className="py-4 text-center text-xs text-muted-foreground">
                                No deliveries yet. Trigger one with the Test button.
                              </p>
                            ) : (
                              deliveries.slice(0, 20).map((d) => <DeliveryRow key={d.id} delivery={d} />)
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
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeliveryRow — single delivery history entry.
// ---------------------------------------------------------------------------

function DeliveryRow({ delivery }: { delivery: Delivery }) {
  const isOk = delivery.status === 'success'
  const isPending = delivery.status === 'pending' || delivery.status === 'retrying'
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
      <span className="mt-0.5 flex-shrink-0">
        {isOk ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">{delivery.eventType}</Badge>
          <Badge variant="secondary" className={cn(
            'text-[10px]',
            isOk
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : isPending
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
          )}>
            {delivery.status}
          </Badge>
          {delivery.statusCode !== null && (
            <span className="text-[10px] text-muted-foreground">HTTP {delivery.statusCode}</span>
          )}
          {delivery.attempt > 1 && (
            <span className="text-[10px] text-muted-foreground">attempt {delivery.attempt}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          <span>{formatDistanceToNow(new Date(delivery.createdAt), { addSuffix: true })}</span>
          {delivery.deliveredAt && (
            <span>delivered {formatDistanceToNow(new Date(delivery.deliveredAt), { addSuffix: true })}</span>
          )}
          {delivery.nextRetryAt && (
            <span>retry {formatDistanceToNow(new Date(delivery.nextRetryAt), { addSuffix: true })}</span>
          )}
        </div>
        {delivery.responseBody && (
          <pre className="mt-1 max-h-20 overflow-auto rounded bg-zinc-950 p-2 text-[10px] leading-relaxed text-zinc-100 dark:bg-black/60">
            <code>{delivery.responseBody.slice(0, 400)}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LastStatusBadge — small inline badge for the webhook's last delivery.
// ---------------------------------------------------------------------------

function LastStatusBadge({ status, code }: { status: string; code: number | null }) {
  const isOk = status === 'success'
  const isPending = status === 'pending' || status === 'retrying'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        isOk
          ? 'text-emerald-600 dark:text-emerald-400'
          : isPending
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-red-600 dark:text-red-400',
      )}
    >
      <Activity className="h-2.5 w-2.5" />
      last: {status}{code ? ` · ${code}` : ''}
    </span>
  )
}
