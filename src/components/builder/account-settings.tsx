'use client'

// Account settings for every signed-in user (Settings page):
//   ProfileCard      change the display name (email is the sign-in identity and is read-only)
//   PasswordCard     change password (current password, plus a 2FA code when 2FA is on)
//   DataPrivacyCard  download all your data, or permanently delete the account

import { useState } from 'react'
import { Download, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback)

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function ProfileCard() {
  const session = useBuilder((s) => s.session)
  const currentName = session?.user.name ?? ''
  const [name, setName] = useState(currentName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const unchanged = trimmed === currentName.trim()

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmed || unchanged) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.updateProfileName(trimmed)
      // Keep the name shown in the sidebar and header in step with what was saved.
      useBuilder.setState((s) => (s.session ? { session: { ...s.session, user: { ...s.session.user, name: res.name } } } : s))
      setName(res.name)
      toast.success('Name updated')
    } catch (err) {
      setError(messageOf(err, 'Could not update your name.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2 px-5 py-5">
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>How your name appears across Buildr.</CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={session?.user.email ?? ''} readOnly disabled />
              <p className="text-[11px] text-muted-foreground">Your email is your sign-in and cannot be changed here.</p>
            </div>
          </div>
          <ErrorLine message={error} />
          <Button type="submit" disabled={busy || !trimmed || unchanged}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save name
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < 8
  const ready = current.length > 0 && next.length >= 8 && next === confirm

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api.changePassword({
        currentPassword: current,
        newPassword: next,
        ...(code.trim() ? { totpCode: code.trim() } : {}),
      })
      setCurrent('')
      setNext('')
      setConfirm('')
      setCode('')
      toast.success('Password updated')
    } catch (err) {
      setError(messageOf(err, 'Could not change your password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2 px-5 py-5">
        <CardTitle className="text-base">Password</CardTitle>
        <CardDescription>
          Use at least 8 characters. If you signed up with Google or GitHub and have no password yet, use “Forgot
          password” on the sign-in page to set one.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input
              id="pw-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className="max-w-sm"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pw-new">New password</Label>
              <Input
                id="pw-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
              {tooShort && <p className="text-[11px] text-destructive">At least 8 characters.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
              {mismatch && <p className="text-[11px] text-destructive">The passwords do not match.</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-code">Authenticator code (only if two-factor is on)</Label>
            <Input
              id="pw-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="max-w-40"
            />
          </div>
          <ErrorLine message={error} />
          <Button type="submit" disabled={busy || !ready}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Data and privacy
// ---------------------------------------------------------------------------

export function DataPrivacyCard() {
  const logout = useBuilder((s) => s.logout)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPassword('')
    setCode('')
    setTyped('')
    setError(null)
  }

  async function remove(e: React.FormEvent) {
    e.preventDefault()
    if (typed !== 'DELETE' || !password) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount({ password, confirm: 'DELETE', ...(code.trim() ? { totpCode: code.trim() } : {}) })
      toast.success('Your account was deleted')
      setOpen(false)
      reset()
      await logout()
    } catch (err) {
      setError(messageOf(err, 'Could not delete your account.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2 px-5 py-5">
        <CardTitle className="text-base">Data and privacy</CardTitle>
        <CardDescription>Your data belongs to you. Take a copy, or remove it from Buildr.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Download your data</p>
            <p className="text-xs text-muted-foreground">
              A JSON file with your profile, projects, businesses, tickets and activity.
            </p>
          </div>
          <Button asChild variant="outline">
            <a href="/api/account/export" download>
              <Download className="mr-2 h-4 w-4" /> Download
            </a>
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanently removes your account and everything in it. This cannot be undone.
            </p>
          </div>
          <Button variant="destructive" onClick={() => { reset(); setOpen(true) }}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete account
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); if (!v) reset() } }}>
        <AlertDialogContent>
          <form onSubmit={remove} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                All your projects, businesses, tickets and settings will be permanently deleted. Download your data
                first if you want a copy.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="del-password">Your password</Label>
              <Input
                id="del-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="del-code">Authenticator code (only if two-factor is on)</Label>
              <Input
                id="del-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="max-w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="del-confirm">Type DELETE to confirm</Label>
              <Input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
            <ErrorLine message={error} />
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={busy || typed !== 'DELETE' || !password}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete permanently
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
