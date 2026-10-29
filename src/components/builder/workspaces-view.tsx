'use client'

// WorkspacesView — team workspace management.
// ------------------------------------------------------------------
// Two-pane responsive layout:
//   ┌───────────────────┬────────────────────────────────────┐
//   │ Workspace list    │ Detail: members + invite form       │
//   │ (Create button)   │ Role badges · accept/decline/remove │
//   └───────────────────┴────────────────────────────────────┘
//
// On narrow screens the panes stack: list first, then detail when a
// workspace is selected (with a back button).
//
// Self-contained — does not depend on editing api-client.ts or store.ts.
// Uses framer-motion + sonner + shadcn/ui.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Crown,
  Loader2,
  Mail,
  Plus,
  Shield,
  UserMinus,
  Users,
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Local API client (we are not allowed to edit api-client.ts).
// ---------------------------------------------------------------------------

interface Workspace {
  id: string
  slug: string
  name: string
  description: string
  ownerId: string
  planId: string
  status: string
  role: string
  memberStatus: string
  memberCount: number
  createdAt: string
  updatedAt: string
}

interface Member {
  id: string
  userId: string
  role: string
  invitedBy: string | null
  invitedEmail: string | null
  status: string
  joinedAt: string
  email: string
  name: string | null
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

const workspacesApi = {
  async list(): Promise<{ workspaces: Workspace[] }> {
    const res = await fetch('/api/workspaces', { cache: 'no-store' })
    return json(res)
  },
  async create(body: { name: string; description?: string }): Promise<{ workspace: Workspace }> {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
  async members(id: string): Promise<{ members: Member[] }> {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/members`, { cache: 'no-store' })
    return json(res)
  },
  async invite(id: string, body: { email: string; role: string }): Promise<{ member: Member; alreadyMember?: boolean }> {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },
  async patchMember(
    workspaceId: string,
    memberId: string,
    body: { action: 'accept' | 'decline' | 'change_role'; role?: string },
  ): Promise<{ member: Member }> {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    return json(res)
  },
  async removeMember(workspaceId: string, memberId: string): Promise<{ ok: boolean }> {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    )
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Role metadata.
// ---------------------------------------------------------------------------

const ROLE_META: Record<string, { label: string; chip: string; icon: React.ReactNode }> = {
  owner: {
    label: 'Owner',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    icon: <Crown className="h-3 w-3" />,
  },
  admin: {
    label: 'Admin',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    icon: <Shield className="h-3 w-3" />,
  },
  member: {
    label: 'Member',
    chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
    icon: <Users className="h-3 w-3" />,
  },
  viewer: {
    label: 'Viewer',
    chip: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-500/10 dark:text-zinc-400',
    icon: <Users className="h-3 w-3" />,
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WorkspacesView() {
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  // create form
  const [showCreate, setShowCreate] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [creating, setCreating] = React.useState(false)

  async function load() {
    setLoading(true)
    try {
      const { workspaces } = await workspacesApi.list()
      setWorkspaces(workspaces)
      // Auto-select first workspace if none selected.
      if (!selectedId && workspaces.length > 0) {
        setSelectedId(workspaces[0].id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function handleCreate() {
    if (name.trim().length < 3) {
      toast.error('Name must be at least 3 characters.')
      return
    }
    setCreating(true)
    const t = toast.loading('Creating workspace…')
    try {
      const { workspace } = await workspacesApi.create({
        name: name.trim(),
        description: description.trim(),
      })
      toast.dismiss(t)
      toast.success('Workspace created.')
      setName('')
      setDescription('')
      setShowCreate(false)
      await load()
      setSelectedId(workspace.id)
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  const selected = workspaces.find((w) => w.id === selectedId) || null

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
            <Users className="h-5 w-5" />
          </span>
          Workspaces
        </motion.h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Collaborate on projects with your team. Invite members by email and assign role-based access.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* Workspace list pane */}
        <div className={cn('space-y-3', selectedId && 'hidden md:block')}>
          <Button
            onClick={() => setShowCreate((s) => !s)}
            variant="outline"
            className="w-full gap-2"
          >
            <Plus className="h-4 w-4" />
            {showCreate ? 'Cancel' : 'New Workspace'}
          </Button>

          <AnimatePresence>
            {showCreate && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <Card>
                  <CardContent className="space-y-3 pt-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="ws-name" className="text-xs">Name</Label>
                      <Input
                        id="ws-name"
                        placeholder="Acme Team"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ws-desc" className="text-xs">Description (optional)</Label>
                      <Input
                        id="ws-desc"
                        placeholder="What is this workspace for?"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={handleCreate}
                      disabled={creating}
                      className="w-full gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700"
                    >
                      {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Create
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : workspaces.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <Users className="h-8 w-8 text-violet-500/50" />
                <p className="text-sm font-medium">No workspaces yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Create a workspace to start collaborating with your team.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {workspaces.map((ws) => {
                const sm = ROLE_META[ws.role] || ROLE_META.member
                const isSelected = ws.id === selectedId
                return (
                  <motion.button
                    key={ws.id}
                    layout
                    onClick={() => setSelectedId(ws.id)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition',
                      isSelected
                        ? 'border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-500/10'
                        : 'border-border hover:border-violet-300',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{ws.name}</p>
                        {ws.description && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {ws.description}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={cn('flex-shrink-0 gap-1 text-[10px]', sm.chip)}>
                        {sm.icon}
                        {sm.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-2.5 w-2.5" />
                        {ws.memberCount} {ws.memberCount === 1 ? 'member' : 'members'}
                      </span>
                      <span>{ws.planId}</span>
                      <span>{formatDistanceToNow(new Date(ws.createdAt), { addSuffix: true })}</span>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail pane */}
        {!selectedId || !selected ? (
          <div className={cn('hidden md:block')}>
            <Card className="border-dashed">
              <CardContent className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 p-12 text-center">
                <Users className="h-10 w-10 text-violet-500/40" />
                <p className="font-medium">Select a workspace</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Pick a workspace from the list to manage members, invitations, and roles.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <WorkspaceDetail key={selected.id} workspace={selected} onBack={() => setSelectedId(null)} onChanged={load} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkspaceDetail — the right pane.
// ---------------------------------------------------------------------------

function WorkspaceDetail({
  workspace,
  onBack,
  onChanged,
}: {
  workspace: Workspace
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const [members, setMembers] = React.useState<Member[]>([])
  const [loading, setLoading] = React.useState(true)

  // invite form
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState('member')
  const [inviting, setInviting] = React.useState(false)

  // per-member ops
  const [busyMemberId, setBusyMemberId] = React.useState<string | null>(null)

  const canManage = workspace.role === 'owner' || workspace.role === 'admin'
  const isPendingInvite = workspace.memberStatus === 'pending'

  async function loadMembers() {
    setLoading(true)
    try {
      const { members } = await workspacesApi.members(workspace.id)
      setMembers(members)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void loadMembers()
  }, [workspace.id])

  async function handleInvite() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
      toast.error('Please enter a valid email address.')
      return
    }
    setInviting(true)
    const t = toast.loading('Sending invite…')
    try {
      const { member, alreadyMember } = await workspacesApi.invite(workspace.id, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      })
      toast.dismiss(t)
      if (alreadyMember) {
        toast.info('That user is already a member.')
      } else {
        toast.success('Invite sent.', {
          description: `${member.email} will see a pending invitation.`,
        })
      }
      setInviteEmail('')
      setInviteRole('member')
      await loadMembers()
      await onChanged()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Invite failed')
    } finally {
      setInviting(false)
    }
  }

  async function handleAccept(m: Member) {
    setBusyMemberId(m.id)
    const t = toast.loading('Accepting invite…')
    try {
      await workspacesApi.patchMember(workspace.id, m.id, { action: 'accept' })
      toast.dismiss(t)
      toast.success('You joined the workspace.')
      await loadMembers()
      await onChanged()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Accept failed')
    } finally {
      setBusyMemberId(null)
    }
  }

  async function handleDecline(m: Member) {
    if (!confirm('Decline this invitation?')) return
    setBusyMemberId(m.id)
    const t = toast.loading('Declining…')
    try {
      await workspacesApi.patchMember(workspace.id, m.id, { action: 'decline' })
      toast.dismiss(t)
      toast.success('Invitation declined.')
      await loadMembers()
      await onChanged()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Decline failed')
    } finally {
      setBusyMemberId(null)
    }
  }

  async function handleChangeRole(m: Member, role: string) {
    setBusyMemberId(m.id)
    const t = toast.loading('Updating role…')
    try {
      await workspacesApi.patchMember(workspace.id, m.id, { action: 'change_role', role })
      toast.dismiss(t)
      toast.success(`${m.email} is now ${role}.`)
      await loadMembers()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Role change failed')
    } finally {
      setBusyMemberId(null)
    }
  }

  async function handleRemove(m: Member) {
    const isSelf = m.userId === workspace.ownerId && m.role === 'owner'
    if (m.role === 'owner') {
      toast.error('Owners cannot be removed here. Transfer ownership first.')
      return
    }
    if (!confirm(`Remove ${m.email} from this workspace?`)) return
    setBusyMemberId(m.id)
    const t = toast.loading('Removing…')
    try {
      await workspacesApi.removeMember(workspace.id, m.id)
      toast.dismiss(t)
      toast.success('Member removed.')
      await loadMembers()
      await onChanged()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusyMemberId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={onBack}
                  className="grid h-7 w-7 place-items-center rounded-md border md:hidden"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <CardTitle className="truncate text-lg">{workspace.name}</CardTitle>
                <Badge variant="outline" className="flex-shrink-0 gap-1 text-[10px]">
                  {workspace.planId}
                </Badge>
              </div>
              <CardDescription className="mt-1">
                {workspace.description || 'No description set.'}
              </CardDescription>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-2.5 w-2.5" />
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </span>
                <span>slug: <code className="rounded bg-muted/50 px-1 font-mono text-[10px]">{workspace.slug}</code></span>
                <span>created {formatDistanceToNow(new Date(workspace.createdAt), { addSuffix: true })}</span>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Invite form */}
      {canManage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-violet-600" />
              Invite Member
            </CardTitle>
            <CardDescription>
              Invite by email. The user must have an existing Buildr account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleInvite()
                }}
              />
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleInvite}
                disabled={inviting}
                className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700"
              >
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Invite
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending self-invite banner */}
      {isPendingInvite && (
        <Card className="border-2 border-amber-400 dark:border-amber-700">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">You have a pending invitation to this workspace.</p>
              <p className="text-xs text-muted-foreground">Accept to join, or decline to dismiss.</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyMemberId === 'self'}
                onClick={async () => {
                  // Find the user's own member row — the membership matching
                  // the workspace's role/memberStatus is the current user's.
                  const self = members.find((m) => m.status === 'pending')
                  if (!self) return
                  setBusyMemberId('self')
                  const t = toast.loading('Accepting invite…')
                  try {
                    await workspacesApi.patchMember(workspace.id, self.id, { action: 'accept' })
                    toast.dismiss(t)
                    toast.success('You joined the workspace.')
                    await loadMembers()
                    await onChanged()
                  } catch (err) {
                    toast.dismiss(t)
                    toast.error(err instanceof Error ? err.message : 'Accept failed')
                  } finally {
                    setBusyMemberId(null)
                  }
                }}
              >
                {busyMemberId === 'self' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500"
                disabled={busyMemberId === 'self'}
                onClick={async () => {
                  if (!confirm('Decline this invitation?')) return
                  const self = members.find((m) => m.status === 'pending')
                  if (!self) return
                  setBusyMemberId('self')
                  const t = toast.loading('Declining…')
                  try {
                    await workspacesApi.patchMember(workspace.id, self.id, { action: 'decline' })
                    toast.dismiss(t)
                    toast.success('Invitation declined.')
                    await loadMembers()
                    await onChanged()
                  } catch (err) {
                    toast.dismiss(t)
                    toast.error(err instanceof Error ? err.message : 'Decline failed')
                  } finally {
                    setBusyMemberId(null)
                  }
                }}
              >
                <X className="h-3 w-3" />
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No members found.</p>
          ) : (
            <div className="divide-y">
              {members.map((m) => {
                const sm = ROLE_META[m.role] || ROLE_META.member
                const isOwner = m.role === 'owner'
                const isPending = m.status === 'pending'
                const isRemoved = m.status === 'removed'
                return (
                  <div
                    key={m.id}
                    className={cn('flex items-center justify-between gap-3 py-3', isRemoved && 'opacity-50')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{m.name || m.email}</p>
                        {m.name && <span className="text-xs text-muted-foreground">{m.email}</span>}
                        <Badge variant="outline" className={cn('gap-1 text-[10px]', sm.chip)}>
                          {sm.icon}
                          {sm.label}
                        </Badge>
                        {isPending && (
                          <Badge variant="secondary" className="gap-1 text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            pending
                          </Badge>
                        )}
                        {isRemoved && (
                          <Badge variant="secondary" className="gap-1 text-[10px] bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400">
                            removed
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        joined {formatDistanceToNow(new Date(m.joinedAt), { addSuffix: true })}
                      </p>
                    </div>

                    {canManage && !isOwner && !isRemoved && (
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {isPending && m.userId !== workspace.ownerId && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              disabled={busyMemberId === m.id}
                              onClick={() => handleAccept(m)}
                            >
                              <Check className="h-3 w-3" />
                              Accept
                            </Button>
                          </>
                        )}
                        <Select
                          value={m.role}
                          onValueChange={(r) => handleChangeRole(m, r)}
                          disabled={busyMemberId === m.id}
                        >
                          <SelectTrigger size="sm" className="h-7 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                          disabled={busyMemberId === m.id}
                          onClick={() => handleRemove(m)}
                          title="Remove"
                        >
                          {busyMemberId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
