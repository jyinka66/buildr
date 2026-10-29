'use client'

// Authentication modal — login + register in one dialog. Driven by the store's
// authOpen / authMode / authLoading / authError state.

import { useState } from 'react'
import { Loader2, LogIn, UserPlus, ShieldCheck } from 'lucide-react'
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

export function AuthDialog() {
  const open = useBuilder((s) => s.authOpen)
  const mode = useBuilder((s) => s.authMode)
  const loading = useBuilder((s) => s.authLoading)
  const error = useBuilder((s) => s.authError)
  const setMode = useBuilder((s) => s.setAuthMode)
  const close = useBuilder((s) => s.closeAuth)
  const register = useBuilder((s) => s.register)
  const login = useBuilder((s) => s.login)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode === 'register') {
      const ok = await register({ email, password, name: name || undefined })
      if (ok) toast.success('Welcome to Buildr!', { description: 'Your account is ready.' })
    } else {
      const ok = await login(email, password)
      if (ok) toast.success('Signed in', { description: email })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <BuildrLogo withWordmark={false} size={32} />
            <DialogTitle className="text-xl">
              {mode === 'register' ? 'Create your account' : 'Welcome back'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {mode === 'register'
              ? 'Start building production-ready apps in seconds. No credit card required.'
              : 'Sign in to access your projects and builder workspace.'}
          </DialogDescription>
        </DialogHeader>

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

        {/* OAuth providers */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => api.signInWithProvider('google')}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <GoogleIcon className="h-4 w-4" />
            Google
          </button>
          <button
            type="button"
            onClick={() => api.signInWithProvider('github')}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <GithubIcon className="h-4 w-4" />
            GitHub
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or with email
          <div className="h-px flex-1 bg-border" />
        </div>

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
            <Label htmlFor="auth-password">Password</Label>
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

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Passwords are hashed with bcrypt. We never store them in plain text.
        </p>
      </DialogContent>
    </Dialog>
  )
}
