'use client'

// Two-factor authentication management for the signed-in user (Settings → Security).
//   1. "Set up" asks the server for a secret (nothing is enabled yet).
//   2. The user adds it to an authenticator app and confirms with a 6-digit code.
//   3. Backup codes are shown exactly once; the server only keeps their hashes.
//   4. "Disable" needs a current code or the account password.

import { useEffect, useState } from 'react'
import { Copy, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Phase = 'loading' | 'off' | 'setup' | 'codes' | 'on' | 'disabling'

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error('Could not copy. Select the text and copy it manually.')
  }
}

export function TwoFactorCard() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ manualKey: string; otpauthUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    api.twoFactorStatus()
      .then(({ enabled }) => { if (alive) setPhase(enabled ? 'on' : 'off') })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load 2FA status.')
        setPhase('off')
      })
    return () => { alive = false }
  }, [])

  async function begin() {
    setBusy(true); setError(null)
    try {
      const res = await api.twoFactorBegin()
      setSetup({ manualKey: res.manualKey, otpauthUrl: res.otpauthUrl })
      setCode('')
      setPhase('setup')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.')
    } finally { setBusy(false) }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await api.twoFactorConfirm(code.trim())
      setBackupCodes(res.backupCodes)
      setSetup(null); setCode('')
      setPhase('codes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the code.')
    } finally { setBusy(false) }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const trimmed = code.trim()
      await api.twoFactorDisable(/^\d{6}$/.test(trimmed) ? { code: trimmed } : { password })
      setCode(''); setPassword('')
      setPhase('off')
      toast.success('Two-factor authentication disabled')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable 2FA.')
    } finally { setBusy(false) }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {phase === 'on' || phase === 'disabling' ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <ShieldOff className="h-5 w-5 text-muted-foreground" />}
            <CardTitle className="text-base">Two-factor authentication</CardTitle>
          </div>
          {phase === 'on' || phase === 'disabling' ? <Badge>Enabled</Badge> : phase !== 'loading' && phase !== 'codes' ? <Badge variant="outline">Off</Badge> : null}
        </div>
        <CardDescription>
          Require a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy) in addition to your password when you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {phase === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        )}

        {phase === 'off' && (
          <Button onClick={begin} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set up 2FA
          </Button>
        )}

        {phase === 'setup' && setup && (
          <form onSubmit={confirm} className="space-y-4">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>In your authenticator app choose “Add account” → “Enter a setup key”.</li>
              <li>Enter this key (time-based, 6 digits):</li>
            </ol>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm tracking-wider" data-testid="totp-manual-key">{setup.manualKey}</code>
              <Button type="button" variant="outline" size="icon" onClick={() => copy(setup.manualKey.replace(/\s/g, ''), 'Setup key')} aria-label="Copy setup key">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              On a phone you can also <a className="underline" href={setup.otpauthUrl}>open this link in your authenticator app</a>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="totp-confirm">Enter the 6-digit code it shows</Label>
              <Input id="totp-confirm" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required className="max-w-40" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify and enable
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setSetup(null); setCode(''); setError(null); setPhase('off') }}>Cancel</Button>
            </div>
          </form>
        )}

        {phase === 'codes' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">2FA is now on.</p>
            <p className="text-sm text-muted-foreground">
              Save these backup codes somewhere safe. Each works once if you lose your phone. They will not be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm" data-testid="backup-codes">
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => copy(backupCodes.join('\n'), 'Backup codes')}>
                <Copy className="mr-2 h-4 w-4" /> Copy codes
              </Button>
              <Button type="button" onClick={() => { setBackupCodes([]); setPhase('on') }}>I have saved them</Button>
            </div>
          </div>
        )}

        {phase === 'on' && (
          <Button variant="outline" onClick={() => { setError(null); setCode(''); setPassword(''); setPhase('disabling') }}>Disable 2FA</Button>
        )}

        {phase === 'disabling' && (
          <form onSubmit={disable} className="space-y-3">
            <p className="text-sm text-muted-foreground">Confirm with a current 6-digit code, or leave the code empty and enter your account password.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="totp-disable-code">Authenticator code</Label>
                <Input id="totp-disable-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totp-disable-password">Or password</Label>
                <Input id="totp-disable-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={busy || (code.length !== 6 && !password)}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Disable 2FA
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setError(null); setPhase('on') }}>Cancel</Button>
            </div>
          </form>
        )}

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  )
}

export default TwoFactorCard
