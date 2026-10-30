'use client'

// Buildr — single user-visible route ("/").
// Renders the global shell + the active view from the Zustand store.

import React, { useEffect } from 'react'
import { useBuilder, authMessage } from '@/lib/store'
import { AppHeader, AppFooter } from '@/components/builder/app-shell'
import { AppSidebar, AppTopBar } from '@/components/builder/app-sidebar'
import { LandingView } from '@/components/builder/landing-view'
import DashboardView from '@/components/builder/dashboard-view'
import { BuilderWorkspace } from '@/components/builder/builder-workspace'
import { SettingsView } from '@/components/builder/settings-view'
import BusinessLaunchView from '@/components/builder/business-launch-view'
import JobsView from '@/components/builder/jobs-view'
import GodModeView from '@/components/builder/god-mode-view'
import BillingView from '@/components/builder/billing-view'
import MarketingView from '@/components/builder/marketing-view'
import SupportView from '@/components/builder/support-view'
import OperationsView from '@/components/builder/operations-view'
import NotificationsView from '@/components/builder/notifications-view'
import ApiKeysView from '@/components/builder/api-keys-view'
import WebhooksView from '@/components/builder/webhooks-view'
import WorkspacesView from '@/components/builder/workspaces-view'
import AdminView from '@/components/builder/admin-view'
import OnboardingView from '@/components/builder/onboarding-view'
import AnalyticsView from '@/components/builder/analytics-view'
import { SharedProjectView } from '@/components/builder/shared-project-view'
import { AuthDialog } from '@/components/builder/auth-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Loader2, TriangleAlert, Wrench } from 'lucide-react'

export default function Home() {
  const view = useBuilder((s) => s.view)
  const boot = useBuilder((s) => s.boot)
  const booted = useBuilder((s) => s.booted)
  const bootError = useBuilder((s) => s.bootError)
  const session = useBuilder((s) => s.session)
  const openAuth = useBuilder((s) => s.openAuth)
  const openReset = useBuilder((s) => s.openReset)
  const showAuthError = useBuilder((s) => s.showAuthError)

  useEffect(() => {
    if (!booted) boot()
  }, [booted, boot])

  // Email links and OAuth redirects land on "/" with a query string:
  //   /?reset=<64-hex token>   password reset email  -> choose-a-new-password step
  //   /?error=<NextAuth code>  failed OAuth sign-in   -> message in the sign-in dialog
  // The query is stripped right away so a token never stays in the address bar or history.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const reset = params.get('reset')
    const err = params.get('error')
    if (reset && /^[a-f0-9]{64}$/i.test(reset)) {
      openReset(reset)
    } else if (err) {
      showAuthError(authMessage(err))
    } else {
      return
    }
    params.delete('reset')
    params.delete('error')
    const rest = params.toString()
    window.history.replaceState({}, '', rest ? `/?${rest}` : '/')
  }, [openReset, showAuthError])

  // Hidden admin login: visiting /?admin=1 opens the auth dialog.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('admin') === '1' && !session) {
      openAuth('login')
      window.history.replaceState({}, '', '/')
    }
  }, [session, openAuth])

  // Screenshot gallery mode: visiting /?screenshots=1 shows the captured
  // dashboard + builder images directly. Used for preview-panel viewing.
  const [screenshotMode, setScreenshotMode] = React.useState(false)
  // Download mode: visiting /?download=1 shows the project download page.
  const [downloadMode, setDownloadMode] = React.useState(false)
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      setScreenshotMode(params.get('screenshots') === '1')
      setDownloadMode(params.get('download') === '1')
    }
  }, [])

  // Maintenance mode banner.
  const [maintenance, setMaintenance] = React.useState(false)
  React.useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then((d) => { if (d.maintenance) setMaintenance(true) }).catch(() => {})
  }, [])

  const showSetupScreen = bootError && view !== 'landing'

  // Download mode — shows a download page with a direct link to the ZIP.
  if (downloadMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl md:p-12">
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-2xl font-bold text-white shadow-lg">
            B
          </div>
          <h1 className="mb-2 text-2xl font-bold text-zinc-900">Buildr Source Code</h1>
          <p className="mb-8 text-sm text-zinc-500">
            Complete Next.js 16 project — AI streaming, Paystack payments, Social Scheduler,
            ROI Tracking, Brand Voice, Leads Pipeline, and more.
          </p>
          {/* Direct download link — works in preview panel iframe */}
          <a
            href={`${typeof window !== 'undefined' ? window.location.origin : ''}/buildr-project.zip`}
            download="buildr-project.zip"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg transition hover:from-emerald-700 hover:to-teal-700"
          >
            ⬇ Download ZIP (879 KB)
          </a>
          <p className="mt-6 text-xs text-zinc-400">
            538 files · 151 API routes · 57 components · 2 mini-services
          </p>
          <p className="mt-4 break-all text-[10px] text-zinc-300">
            If the button doesn&apos;t work, right-click → Save link as… → <code>buildr-project.zip</code>
          </p>
        </div>
      </div>
    )
  }

  // Screenshot gallery mode — early return after all hooks.
  if (screenshotMode) {
    return (
      <div className="min-h-screen bg-zinc-950 px-4 py-8 text-white md:px-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Buildr — Screenshots</h1>
          <p className="mb-8 text-sm text-zinc-400">
            Captured previews of the dashboard and builder workspace with an AI-generated chat app.
          </p>
          <div className="space-y-10">
            <div>
              <h2 className="mb-3 text-lg font-semibold text-emerald-400">1. Dashboard</h2>
              <img src="/screenshots/dashboard.png" alt="Buildr Dashboard" className="w-full rounded-xl border border-zinc-800 shadow-2xl" />
            </div>
            <div>
              <h2 className="mb-3 text-lg font-semibold text-emerald-400">2. Builder — Chat App Preview</h2>
              <img src="/screenshots/builder.png" alt="Buildr Builder with Chat App" className="w-full rounded-xl border border-zinc-800 shadow-2xl" />
            </div>
            <div>
              <h2 className="mb-3 text-lg font-semibold text-emerald-400">3. Builder — Rendered Chat UI (viewport)</h2>
              <img src="/screenshots/builder-preview.png" alt="Chat App UI in Preview" className="w-full rounded-xl border border-zinc-800 shadow-2xl" />
            </div>
          </div>
          <p className="mt-8 text-center text-xs text-zinc-500">
            Visit <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">/</code> for the live app.
          </p>
        </div>
      </div>
    )
  }

  // Determine which layout to use:
  // - "full" = full screen, no header/footer/sidebar (builder, shared, onboarding)
  // - "landing" = top header + content + footer (logged-out landing page)
  // - "sidebar" = left sidebar + slim top bar + content (all authenticated page views)
  const isFullScreenView = view === 'builder' || view === 'shared' || view === 'onboarding'
  const isLandingView = view === 'landing' || !session

  // Render the active view content.
  function renderView() {
    if (showSetupScreen) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-16">
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Couldn&apos;t start Buildr</AlertTitle>
            <AlertDescription className="mt-2">
              <p className="mb-3">{bootError}</p>
              <Button size="sm" onClick={() => boot()} variant="outline">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )
    }
    switch (view) {
      case 'landing': return <LandingView />
      case 'dashboard': return <DashboardView />
      case 'builder': return <BuilderWorkspace />
      case 'settings': return <SettingsView />
      case 'business': return <BusinessLaunchView />
      case 'jobs': return <JobsView />
      case 'godmode': return <GodModeView />
      case 'billing': return <BillingView />
      case 'marketing': return <MarketingView />
      case 'support': return <SupportView />
      case 'ops': return <OperationsView />
      case 'analytics': return <AnalyticsView />
      case 'notifications': return <NotificationsView />
      case 'api-keys': return <ApiKeysView />
      case 'webhooks': return <WebhooksView />
      case 'workspaces': return <WorkspacesView />
      case 'admin': return <AdminView />
      case 'onboarding': return <OnboardingView />
      case 'shared': return <SharedProjectView />
      default: return <LandingView />
    }
  }

  // ── Full-screen views (builder, shared, onboarding) ─────────────
  if (isFullScreenView) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {maintenance && (
          <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
            <Wrench className="h-4 w-4" />
            Buildr is in maintenance mode. Read-only access is available.
          </div>
        )}
        <main className="min-h-0 flex-1">
          {renderView()}
        </main>
        <AuthDialog />
      </div>
    )
  }

  // ── Landing layout (logged out) ─────────────────────────────────
  if (isLandingView) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {maintenance && (
          <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
            <Wrench className="h-4 w-4" />
            Buildr is in maintenance mode. Read-only access is available.
          </div>
        )}
        <AppHeader />
        <main className="flex-1">
          {renderView()}
        </main>
        <AppFooter />
        <AuthDialog />
      </div>
    )
  }

  // ── Sidebar layout (authenticated page views) ───────────────────
  return (
    <div className="flex min-h-screen bg-background">
      {maintenance && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
          <Wrench className="h-4 w-4" />
          Buildr is in maintenance mode. Read-only access is available.
        </div>
      )}
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <main className="min-h-0 flex-1 overflow-auto">
          {renderView()}
        </main>
      </div>
      <AuthDialog />
    </div>
  )
}
