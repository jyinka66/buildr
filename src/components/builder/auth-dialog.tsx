'use client'

// Authentication modal. One dialog, several steps driven by the store:
//   login / register  – email + password and (when configured) Google / GitHub
//   two-factor        – shown after the password is accepted for a 2FA account
//   forgot            – request a password reset email
//   reset             – choose a new password from an emailed link (/?reset=<token>)

import { useEffect, useState } from 'react'
import { Loader2, LogIn, UserPlus, ShieldCheck, ArrowLeft, MailCheck } from 'lucide-react'
import { BuildrLogo } from '@/components/builder/buildr-logo'
import { useBuilder } from '@/lib/store'
import { api } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { GoogleIcon, GithubIcon } from '@/components/builder/oauth-icons'

type Provider = 'google' | 'github'

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">
      <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
      {children}
    </p>
  )
}

export function AuthDialog() {
  const open = useBuilder((s) => s.authOpen)
  const mode = useBuilder((s) => s.authMode)
  const loading = useBuilder((s) => s.authLoading)
  const error = useBuilder((s) => s.authError)
  const notice = useBuilder((s) => s.authNotice)
  const unverifiedEmail = useBuilder((s) => s.unverifiedEmail)
  const twoFactorRequired = useBuilder((s) => s.twoFactorRequired)
  const setMode = useBuilder((s) => s.setAuthMode)
  const close = useBuilder((s) => s.closeAuth)
  const register = useBuilder((s) => s.register)
  const login = useBuilder((s) => s.login)
  const completeTwoFactor = useBuilder((s) => s.completeTwoFactor)
  const cancelTwoFactor = useBuilder((s) => s.cancelTwoFactor)
  const forgotPassword = useBuilder((s) => s.forgotPassword)
  const resetPassword = useBuilder((s) => s.resetPassword)
  const resendVerification = useBuilder((s) => s.resendVerification)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])

  // Only offer the providers the server actually has credentials for.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.getOAuthProviders().then((p) => { if (!cancelled) setProviders(p) })
    return () => { cancelled = true }
  }, [open])

  // Never keep secrets in component state once the dialog closes.
  function handleOpenChange(o: boolean) {
    if (o) return
    setPassword(''); setConfirm(''); setCode(''); setLocalError(null)
    close()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (mode === 'register') {
      const ok = await register({ email, password, name: name || undefined })
      if (ok) toast.success('Check your email', { description: 'We sent a verification link. You must confirm your email before signing in.' })
    } else {
      const ok = await login(email, password)
      if (ok) toast.success('Signed in', { description: email })
    }
  }

  async function handleTwoFactor(e: React.FormEvent) {
    e.preventDefault()
    const ok = await completeTwoFactor(code)
    if (ok) toast.success('Signed in')
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    await forgotPassword(email)
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (password.length < 8) return setLocalError('Password must be at least 8 characters.')
    if (new TextEncoder().encode(password).length > 72) return setLocalError('Password must be no more than 72 bytes.')
    if (password !== confirm) return setLocalError('The two passwords do not match.')
    const ok = await resetPassword(password)
    if (ok) { setPassword(''); setConfirm(''); toast.success('Password updated', { description: 'Sign in with your new password.' }) }
  }

  const shownError = localError ?? error
  const isTabs = (mode === 'login' || mode === 'register') && !twoFactorRequired

  let title = mode === 'register' ? 'Create your account' : 'Welcome back'
  let description = mode === 'register'
    ? 'Start building production-ready apps in seconds. No credit card required.'
    : 'Sign in to access your projects and builder workspace.'
  if (twoFactorRequired) {
    title = 'Two-factor authentication'
    description = 'Enter the 6-digit code from your authenticator app, or one of your backup codes.'
  } else if (mode === 'forgot') {
    title = 'Reset your password'
    description = 'Enter your account email and we will send you a reset link.'
  } else if (mode === 'reset') {
    title = 'Choose a new password'
    description = 'Pick a password you have not used elsewhere. The reset link works once.'
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <BuildrLogo withWordmark={false} size={32} />
            <DialogTitle className="text-xl">{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* ---------------------------- Two-factor step ---------------------------- */}
        {twoFactorRequired && (
          <form onSubmit={handleTwoFactor} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="auth-code">Authentication code</Label>
              <Input
                id="auth-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoComplete="one-time-code"
                inputMode="text"
                autoFocus
                required
                maxLength={12}
              />
            </div>
            {shownError && <ErrorText>{shownError}</ErrorText>}
            <Button type="submit" disabled={loading || code.trim().length < 6} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify and sign in
            </Button>
            <button type="button" onClick={() => { setCode(''); cancelTwoFactor() }} className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </button>
          </form>
        )}

        {/* ------------------------------ Forgot password ------------------------------ */}
        {!twoFactorRequired && mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">Email</Label>
              <Input id="forgot-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoFocus />
            </div>
            {notice && <Notice>{notice}</Notice>}
            {shownError && <ErrorText>{shownError}</ErrorText>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
            <button type="button" onClick={() => setMode('login')} className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </button>
          </form>
        )}

        {/* ------------------------------- Reset password ------------------------------- */}
        {!twoFactorRequired && mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New password</Label>
              <Input id="reset-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm">Confirm new password</Label>
              <Input id="reset-confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
            {shownError && <ErrorText>{shownError}</ErrorText>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update password
            </Button>
            <button type="button" onClick={() => setMode('forgot')} className="mx-auto block text-xs text-muted-foreground hover:text-foreground">
              Link expired? Request a new one
            </button>
          </form>
        )}

        {/* --------------------------- Login / register --------------------------- */}
        {isTabs && (
          <>
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="register" className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  Register
                </TabsTrigger>
                <TabsTrigger value="login" className="gap-1.5">
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {providers.length > 0 && (
              <>
                <div className={`grid gap-2 ${providers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {providers.includes('google') && (
                    <button
                      type="button"
                      onClick={() => api.signInWithProvider('google')}
                      className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                    >
                      <GoogleIcon className="h-4 w-4" />
                      Google
                    </button>
                  )}
                  {providers.includes('github') && (
                    <button
                      type="button"
                      onClick={() => api.signInWithProvider('github')}
                      className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                    >
                      <GithubIcon className="h-4 w-4" />
                      GitHub
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  or with email
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">Name (optional)</Label>
                  <Input
                    id="auth-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auth-password">Password</Label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => setMode('forgot')} className="text-xs text-muted-foreground hover:text-foreground">
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </div>

              {notice && <Notice>{notice}</Notice>}
              {shownError && <ErrorText>{shownError}</ErrorText>}
              {unverifiedEmail && (
                <Button type="button" variant="outline" disabled={loading} onClick={() => void resendVerification()} className="w-full">
                  Resend verification email
                </Button>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'register' ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          </>
        )}

        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Passwords are hashed with bcrypt. We never store them in plain text.
        </p>
      </DialogContent>
    </Dialog>
  )
}
