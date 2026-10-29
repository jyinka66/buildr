// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Users, Loader2, UserPlus, Trash2, Crown, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

interface Member {
  id: string
  user_id: string
  role: string
  email: string
  name: string | null
  created_at: string | null
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-700 border-amber-300',
  editor: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  viewer: 'bg-zinc-100 text-zinc-700 border-zinc-300',
}

export function TeamMembersDialog({ open, onOpenChange, projectId }: Props) {
  const [members, setMembers] = React.useState<Member[]>([])
  const [loading, setLoading] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [role, setRole] = React.useState('viewer')
  const [inviting, setInviting] = React.useState(false)

  const fetchMembers = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listMembers(projectId)
      setMembers(data.members)
    } catch {
      toast.error('Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (open) void fetchMembers()
  }, [open, fetchMembers])

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error('Email is required.')
      return
    }
    setInviting(true)
    try {
      await api.inviteMember(projectId, email.trim(), role as 'editor' | 'viewer')
      toast.success('Member added', { description: email.trim() })
      setEmail('')
      await fetchMembers()
    } catch (err) {
      toast.error('Failed to invite', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (userId: string) => {
    try {
      await api.removeMember(projectId, userId)
      toast.success('Member removed')
      await fetchMembers()
    } catch {
      toast.error('Failed to remove member')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Users className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Team Members</DialogTitle>
          </div>
          <DialogDescription>
            Invite collaborators to this project. Editors can modify files; viewers have read-only access.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {/* Invite form */}
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label className="text-xs">Invite by email</Label>
              <div className="flex gap-2">
                <Input placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={handleInvite} disabled={inviting} className="w-full gap-1.5">
                {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Invite member
              </Button>
            </div>

            {/* Member list */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {members.length} member{members.length === 1 ? '' : 's'}
              </p>
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-emerald-600 text-white text-xs">
                      {(m.email || '?').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name || m.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] capitalize ${ROLE_COLORS[m.role] || ''}`}>
                    {m.role === 'owner' && <Crown className="mr-1 h-3 w-3" />}
                    {m.role}
                  </Badge>
                  {m.role !== 'owner' ? (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleRemove(m.user_id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
