'use client'

// ApiKeysView — personal API keys + public API quick-start.
// ------------------------------------------------------------------
// Layout:
//   1. Header
//   2. Quick-start curl examples (auto-fills the user's API base URL)
//   3. Create form (name + scope checkboxes + optional expiry)
//   4. One-time token reveal banner (appears after create — dismissible)
//   5. Key list (prefix, scopes, last used, request count, revoke button)
//
// Self-contained — does not depend on editing api-client.ts or store.ts.
// Uses framer-motion + sonner + shadcn/ui.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  ShieldOff,
  Terminal,
  Trash2,
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

// ---------------------------------------------------------------------------
// Local API client (we are not allowed to edit api-client.ts).
// ---------------------------------------------------------------------------

interface ApiKey {
  id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  lastUsedIp: string | null
  requestCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
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

const keysApi = {
  async list(): Promise<{ keys: ApiKey[] }> {
    const res = await fetch('/api/api-keys', { cache: 'no-store' })
    return json(res)
  },
  async create(body: {
    name: string
    scopes: string[]
    expiresAt?: string | null
  }): Promise<{ key: ApiKey; token: string }> {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
  async revoke(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/api-keys/${encodeURIComponent(id)}/revoke`, { method: 'POST' })
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Scope catalogue.
// ---------------------------------------------------------------------------

const SCOPES: { value: string; label: string; description: string }[] = [
  { value: 'projects:read', label: 'projects:read', description: 'List and view your projects.' },
  { value: 'projects:write', label: 'projects:write', description: 'Create new projects.' },
  { value: 'deploy', label: 'deploy', description: 'Trigger project deployments.' },
  { value: 'tickets:write', label: 'tickets:write', description: 'Create support tickets.' },
  { value: 'usage:read', label: 'usage:read', description: 'Read monthly usage + plan info.' },
  { value: 'notifications:read', label: 'notifications:read', description: 'List notifications.' },
  { value: '*', label: '*', description: 'Full access (all scopes). Use with care.' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApiKeysView() {
  const [keys, setKeys] = React.useState<ApiKey[]>([])
  const [loading, setLoading] = React.useState(true)

  // create form
  const [name, setName] = React.useState('')
  const [selectedScopes, setSelectedScopes] = React.useState<string[]>(['projects:read'])
  const [expiresAt, setExpiresAt] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [showCreate, setShowCreate] = React.useState(false)

  // one-time token reveal
  const [revealed, setRevealed] = React.useState<{ token: string; name: string } | null>(null)
  const [showToken, setShowToken] = React.useState(true)

  const [revokingId, setRevokingId] = React.useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const { keys } = await keysApi.list()
      setKeys(keys)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { void load() }, [])

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
  }

  async function handleCreate() {
    if (name.trim().length < 3) {
      toast.error('Name must be at least 3 characters.')
      return
    }
    if (selectedScopes.length === 0) {
      toast.error('Please select at least one scope.')
      return
    }
    setCreating(true)
    const t = toast.loading('Creating API key…')
    try {
      const result = await keysApi.create({
        name: name.trim(),
        scopes: selectedScopes,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
      toast.dismiss(t)
      toast.success('API key created.', {
        description: 'Copy the token now — it will not be shown again.',
      })
      setRevealed({ token: result.token, name: result.key.name })
      setShowToken(true)
      setName('')
      setExpiresAt('')
      setSelectedScopes(['projects:read'])
      setShowCreate(false)
      await load()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(key: ApiKey) {
    if (!confirm(`Revoke "${key.name}"? This permanently disables the token.`)) return
    setRevokingId(key.id)
    const t = toast.loading('Revoking…')
    try {
      await keysApi.revoke(key.id)
      toast.dismiss(t)
      toast.success('Key revoked.')
      await load()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Revoke failed')
    } finally {
      setRevokingId(null)
    }
  }

  async function copyToClipboard(text: string, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(label)
    } catch {
      toast.error('Clipboard unavailable — copy manually.')
    }
  }

  // Quick-start curl examples. Use the current origin as the API base.
  const apiBase = typeof window !== 'undefined' ? window.location.origin : 'https://your-buildr.app'

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
            <KeyRound className="h-5 w-5" />
          </span>
          API Keys
        </motion.h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Generate personal access tokens to drive the Buildr public API. Tokens are shown once — store them safely.
        </p>
      </div>

      {/* Quick-start curl examples */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4 text-amber-600" />
            Quick Start
          </CardTitle>
          <CardDescription>
            Authenticate with a Bearer token. All v1 endpoints return JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <CurlExample
            title="List projects"
            cmd={`curl -H "Authorization: Bearer $BUILDR_TOKEN" \\\n  ${apiBase}/api/v1/projects`}
          />
          <CurlExample
            title="Create a project"
            cmd={`curl -X POST -H "Authorization: Bearer $BUILDR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"My API Project","prompt":"A todo app"}' \\\n  ${apiBase}/api/v1/projects`}
          />
          <CurlExample
            title="Read usage"
            cmd={`curl -H "Authorization: Bearer $BUILDR_TOKEN" \\\n  ${apiBase}/api/v1/usage`}
          />
        </CardContent>
      </Card>

      {/* One-time token reveal banner */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-6"
          >
            <Card className="border-2 border-amber-400 dark:border-amber-700">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-300">
                    <KeyRound className="h-4 w-4" />
                    Token for "{revealed.name}"
                  </CardTitle>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRevealed(null)}>
                    Dismiss
                  </Button>
                </div>
                <CardDescription>
                  This token will never be shown again. Copy it now and store it securely.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-xs dark:bg-amber-950/20">
                    {showToken ? revealed.token : '•'.repeat(revealed.token.length)}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => setShowToken((s) => !s)}
                    title={showToken ? 'Hide' : 'Show'}
                  >
                    {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={() => copyToClipboard(revealed.token, 'Token copied')}
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
              <Plus className="h-4 w-4 text-amber-600" />
              Create New Key
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="key-name" className="text-xs">Name</Label>
                    <Input
                      id="key-name"
                      placeholder="Production CI / Personal script"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="key-expiry" className="text-xs">Expires at (optional)</Label>
                    <Input
                      id="key-expiry"
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Scopes</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SCOPES.map((s) => {
                      const checked = selectedScopes.includes(s.value)
                      return (
                        <label
                          key={s.value}
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition',
                            checked
                              ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-500/10'
                              : 'border-border hover:border-amber-300',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleScope(s.value)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-xs font-medium">{s.label}</p>
                            <p className="text-[10px] text-muted-foreground">{s.description}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full gap-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:from-amber-700 hover:to-orange-700"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Generate Token
                </Button>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Key list */}
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Your Keys ({keys.length})
      </h2>
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <KeyRound className="h-8 w-8 text-amber-500/50" />
            <p className="font-medium">No API keys yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Generate a personal access token to start using the Buildr public API.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => {
            const isRevoked = !!key.revokedAt
            const isExpired = key.expiresAt ? new Date(key.expiresAt) < new Date() : false
            return (
              <motion.div key={key.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className={cn(isRevoked && 'opacity-60')}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{key.name}</p>
                          {isRevoked && (
                            <Badge variant="secondary" className="gap-1 text-xs bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                              <ShieldOff className="h-3 w-3" /> revoked
                            </Badge>
                          )}
                          {!isRevoked && isExpired && (
                            <Badge variant="secondary" className="gap-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              expired
                            </Badge>
                          )}
                          {!isRevoked && !isExpired && (
                            <Badge variant="secondary" className="gap-1 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> active
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {key.tokenPrefix}…
                          </code>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {key.scopes.map((s) => (
                            <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{key.requestCount} requests</span>
                          {key.lastUsedAt && (
                            <span>last used {formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}</span>
                          )}
                          {key.expiresAt && (
                            <span>
                              expires {formatDistanceToNow(new Date(key.expiresAt), { addSuffix: true })}
                            </span>
                          )}
                          <span>created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}</span>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        {!isRevoked && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs text-red-500 hover:text-red-600"
                            disabled={revokingId === key.id}
                            onClick={() => handleRevoke(key)}
                          >
                            {revokingId === key.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            Revoke
                          </Button>
                        )}
                      </div>
                    </div>
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
// CurlExample — small helper component.
// ---------------------------------------------------------------------------

function CurlExample({ title, cmd }: { title: string; cmd: string }) {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Clipboard unavailable — copy manually.')
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-medium">{title}</p>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100 dark:bg-black/60">
        <code>{cmd}</code>
      </pre>
    </div>
  )
}
