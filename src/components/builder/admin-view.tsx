'use client'

// AdminView — platform admin console.
// ------------------------------------------------------------------
// Three tabs:
//   1. Overview — platform-wide stat cards (users, projects, etc.)
//   2. Users    — searchable table with promote/demote, enable/disable.
//   3. Audit    — filterable log of admin + system actions.
//
// Self-contained — does not depend on editing api-client.ts or store.ts.
// Uses framer-motion + sonner + shadcn/ui.

import * as React from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  Crown,
  Database,
  KeyRound,
  LayoutDashboard,
  Loader2,
  ScrollText,
  Search,
  Shield,
  ShieldOff,
  Users as UsersIcon,
  Webhook,
  Zap,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// ---------------------------------------------------------------------------
// Local API client (we are not allowed to edit api-client.ts).
// ---------------------------------------------------------------------------

interface Stats {
  users: { total: number; disabled: number; admins: number; new7d: number }
  projects: number
  businesses: number
  godModeGoals: number
  workspaces: number
  webhooks: number
  apiKeys: number
  cronJobs: number
  deployments: number
  usageEvents: number
  activeSubscriptions: number
  auditLogs: number
  support: { total: number; open: number }
}

interface AdminUser {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
  isDisabled: boolean
  emailVerified: boolean
  totpEnabled: boolean
  onboardingCompleted: boolean
  createdAt: string
  updatedAt: string
}

interface AuditEntry {
  id: string
  userId: string | null
  action: string
  details: unknown
  projectId: string | null
  createdAt: string
  user: { id: string; email: string; name: string | null } | null
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

const adminApi = {
  async stats(): Promise<{ stats: Stats }> {
    const res = await fetch('/api/admin/stats', { cache: 'no-store' })
    return json(res)
  },
  async users(params: { q?: string; role?: string; limit?: number; offset?: number }): Promise<{ users: AdminUser[]; total: number }> {
    const sp = new URLSearchParams()
    if (params.q) sp.set('q', params.q)
    if (params.role) sp.set('role', params.role)
    if (params.limit) sp.set('limit', String(params.limit))
    if (params.offset) sp.set('offset', String(params.offset))
    const qs = sp.toString()
    const res = await fetch(`/api/admin/users${qs ? '?' + qs : ''}`, { cache: 'no-store' })
    return json(res)
  },
  async patchUser(id: string, body: { isAdmin?: boolean; isDisabled?: boolean }): Promise<{ user: AdminUser }> {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    return json(res)
  },
  async audit(params: { q?: string; action?: string; userId?: string; limit?: number; offset?: number }): Promise<{ entries: AuditEntry[]; total: number }> {
    const sp = new URLSearchParams()
    if (params.q) sp.set('q', params.q)
    if (params.action) sp.set('action', params.action)
    if (params.userId) sp.set('userId', params.userId)
    if (params.limit) sp.set('limit', String(params.limit))
    if (params.offset) sp.set('offset', String(params.offset))
    const qs = sp.toString()
    const res = await fetch(`/api/admin/audit${qs ? '?' + qs : ''}`, { cache: 'no-store' })
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminView() {
  const [tab, setTab] = React.useState<'overview' | 'users' | 'audit'>('overview')

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-rose-500 to-red-600 text-white">
            <Shield className="h-5 w-5" />
          </span>
          Admin Console
        </motion.h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Platform-wide oversight. Manage users, monitor activity, and review the audit trail.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-1">
            <LayoutDashboard className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1">
            <UsersIcon className="h-3.5 w-3.5" />
            Users
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1">
            <ScrollText className="h-3.5 w-3.5" />
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview tab — stat cards.
// ---------------------------------------------------------------------------

function OverviewTab() {
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { stats } = await adminApi.stats()
        if (!cancelled) setStats(stats)
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load stats')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!stats) return null

  const cards: { label: string; value: number; icon: React.ReactNode; hint?: string; tone: string }[] = [
    {
      label: 'Total Users',
      value: stats.users.total,
      icon: <UsersIcon className="h-4 w-4" />,
      hint: `${stats.users.new7d} new in last 7 days`,
      tone: 'from-sky-500/10 to-blue-500/5',
    },
    {
      label: 'Projects',
      value: stats.projects,
      icon: <LayoutDashboard className="h-4 w-4" />,
      tone: 'from-emerald-500/10 to-teal-500/5',
    },
    {
      label: 'Workspaces',
      value: stats.workspaces,
      icon: <UsersIcon className="h-4 w-4" />,
      tone: 'from-violet-500/10 to-purple-500/5',
    },
    {
      label: 'Businesses',
      value: stats.businesses,
      icon: <Zap className="h-4 w-4" />,
      tone: 'from-fuchsia-500/10 to-pink-500/5',
    },
    {
      label: 'God Mode Goals',
      value: stats.godModeGoals,
      icon: <Zap className="h-4 w-4" />,
      tone: 'from-amber-500/10 to-orange-500/5',
    },
    {
      label: 'Webhooks',
      value: stats.webhooks,
      icon: <Webhook className="h-4 w-4" />,
      tone: 'from-sky-500/10 to-blue-500/5',
    },
    {
      label: 'API Keys',
      value: stats.apiKeys,
      icon: <KeyRound className="h-4 w-4" />,
      tone: 'from-amber-500/10 to-orange-500/5',
    },
    {
      label: 'Cron Jobs',
      value: stats.cronJobs,
      icon: <Activity className="h-4 w-4" />,
      tone: 'from-teal-500/10 to-emerald-500/5',
    },
    {
      label: 'Deployments',
      value: stats.deployments,
      icon: <Activity className="h-4 w-4" />,
      tone: 'from-cyan-500/10 to-sky-500/5',
    },
    {
      label: 'Active Subscriptions',
      value: stats.activeSubscriptions,
      icon: <Crown className="h-4 w-4" />,
      hint: `${stats.users.admins} admins · ${stats.users.disabled} disabled`,
      tone: 'from-rose-500/10 to-red-500/5',
    },
    {
      label: 'Usage Events',
      value: stats.usageEvents,
      icon: <Database className="h-4 w-4" />,
      tone: 'from-zinc-500/10 to-zinc-400/5',
    },
    {
      label: 'Support Tickets',
      value: stats.support.total,
      icon: <ScrollText className="h-4 w-4" />,
      hint: `${stats.support.open} open`,
      tone: 'from-amber-500/10 to-orange-500/5',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card>
              <CardContent className={cn('p-4 bg-gradient-to-br', c.tone)}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                  <span className="text-muted-foreground">{c.icon}</span>
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
                  {c.value.toLocaleString()}
                </p>
                {c.hint && <p className="mt-1 text-[10px] text-muted-foreground">{c.hint}</p>}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Trail</CardTitle>
          <CardDescription>
            {stats.auditLogs.toLocaleString()} total audit log entries have been recorded across all platform actions.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Users tab — searchable table with promote/demote + enable/disable.
// ---------------------------------------------------------------------------

function UsersTab() {
  const [users, setUsers] = React.useState<AdminUser[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [q, setQ] = React.useState('')
  const [role, setRole] = React.useState<string>('')
  const [offset, setOffset] = React.useState(0)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const limit = 25

  async function load() {
    setLoading(true)
    try {
      const { users, total } = await adminApi.users({
        q: q.trim() || undefined,
        role: role || undefined,
        limit,
        offset,
      })
      setUsers(users)
      setTotal(total)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    setOffset(0)
    void load()
  }, [q, role])

  React.useEffect(() => {
    void load()
  }, [offset])

  async function patch(user: AdminUser, body: { isAdmin?: boolean; isDisabled?: boolean }) {
    setBusyId(user.id)
    const t = toast.loading('Updating…')
    try {
      const { user: updated } = await adminApi.patchUser(user.id, body)
      toast.dismiss(t)
      toast.success('User updated.')
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by email or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={role || 'all'} onValueChange={(v) => setRole(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              <SelectItem value="admin">Admins only</SelectItem>
              <SelectItem value="user">Standard users</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No users match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">2FA</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isBusy = busyId === u.id
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{u.name || u.email}</span>
                          {u.name && <span className="text-xs text-muted-foreground">{u.email}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.isAdmin ? (
                          <Badge variant="outline" className="gap-1 text-xs bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            <Crown className="h-3 w-3" /> admin
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">user</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.isDisabled ? (
                          <Badge variant="secondary" className="gap-1 text-xs bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                            <ShieldOff className="h-3 w-3" /> disabled
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            active
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {u.totpEnabled ? (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Shield className="h-2.5 w-2.5" /> 2FA
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            disabled={isBusy}
                            onClick={() => patch(u, { isAdmin: !u.isAdmin })}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crown className="h-3 w-3" />}
                            {u.isAdmin ? 'Demote' : 'Promote'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs"
                            disabled={isBusy}
                            onClick={() => patch(u, { isDisabled: !u.isDisabled })}
                          >
                            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldOff className="h-3 w-3" />}
                            {u.isDisabled ? 'Enable' : 'Disable'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              Prev
            </Button>
            <span className="px-2 py-1">{currentPage} / {totalPages}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + limit >= total || loading}
              onClick={() => setOffset((o) => o + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Audit tab — filterable log of admin + system actions.
// ---------------------------------------------------------------------------

function AuditTab() {
  const [entries, setEntries] = React.useState<AuditEntry[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [q, setQ] = React.useState('')
  const [action, setAction] = React.useState('')
  const [offset, setOffset] = React.useState(0)
  const limit = 50

  async function load() {
    setLoading(true)
    try {
      const { entries, total } = await adminApi.audit({
        q: q.trim() || undefined,
        action: action || undefined,
        limit,
        offset,
      })
      setEntries(entries)
      setTotal(total)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    setOffset(0)
    void load()
  }, [q, action])

  React.useEffect(() => {
    void load()
  }, [offset])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search audit details…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <Input
            placeholder="Filter by action (e.g. admin.user.update)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="sm:w-[260px]"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No audit entries match.</p>
          ) : (
            <div className="divide-y">
              {entries.map((e) => (
                <div key={e.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{e.action}</Badge>
                    {e.user && (
                      <span className="text-xs text-muted-foreground">
                        by <span className="font-medium text-foreground">{e.user.name || e.user.email}</span>
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  {e.details && typeof e.details === 'object' && Object.keys(e.details as object).length > 0 ? (
                    <pre className="mt-2 overflow-x-auto rounded bg-zinc-950 p-2 text-[10px] leading-relaxed text-zinc-100 dark:bg-black/60">
                      <code>{JSON.stringify(e.details, null, 2)}</code>
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {total > limit && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + limit >= total || loading}
              onClick={() => setOffset((o) => o + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
