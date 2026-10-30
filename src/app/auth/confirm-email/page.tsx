'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ConfirmationState = 'checking' | 'success' | 'error'

export default function ConfirmEmailPage() {
  const [state, setState] = useState<ConfirmationState>('checking')
  const [message, setMessage] = useState('Checking your confirmation with Supabase…')

  useEffect(() => {
    let cancelled = false

    async function confirm() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const accessToken = params.get('access_token')
      const errorDescription = params.get('error_description') || params.get('error')

      // Remove the bearer token from the address bar immediately.
      window.history.replaceState(null, '', window.location.pathname + window.location.search)

      if (errorDescription) {
        if (!cancelled) {
          setState('error')
          setMessage('Supabase could not confirm this email link. It may have expired; try registering again or contact support.')
        }
        return
      }
      if (!accessToken) {
        if (!cancelled) {
          setState('error')
          setMessage('The confirmation link did not contain a valid token. Check Supabase Auth email settings and try the link again.')
        }
        return
      }

      try {
        const response = await fetch('/api/auth/confirm-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ accessToken }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Email confirmation failed.')
        if (!cancelled) {
          setState('success')
          setMessage('Your email is confirmed. You can now return to Buildr and sign in.')
        }
      } catch (err) {
        if (!cancelled) {
          setState('error')
          setMessage(err instanceof Error ? err.message : 'Email confirmation failed. Please try again.')
        }
      }
    }

    void confirm()
    return () => { cancelled = true }
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-slate-900">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">Buildr</p>
        <h1 className="text-2xl font-semibold">
          {state === 'checking' ? 'Confirming your email' : state === 'success' ? 'Email confirmed' : 'Confirmation issue'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600" role="status">{message}</p>
        <div className="mt-6">
          <Link href="/" className="inline-flex rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800">
            Return to Buildr
          </Link>
        </div>
      </section>
    </main>
  )
}
