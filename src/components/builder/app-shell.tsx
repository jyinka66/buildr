'use client'

// Global app shell: header + footer. Renders auth-aware nav.
// Logged-out: brand + "Sign in" / "Get started" CTAs.
// Logged-in: Chat / Settings + user menu with sign out.

import {
  BarChart3,
  Briefcase,
  Bell,
  CreditCard,
  Github,
  Globe,
  KeyRound,
  LogOut,
  Megaphone,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  User,
  Users,
  Webhook,
  Zap,
  LifeBuoy,
  Activity,
} from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BuildrLogo } from '@/components/builder/buildr-logo'
import { NotificationsBell } from '@/components/builder/notifications-bell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AppHeader() {
  const view = useBuilder((s) => s.view)
  const session = useBuilder((s) => s.session)
  const openLanding = useBuilder((s) => s.openLanding)
  const openDashboard = useBuilder((s) => s.openDashboard)
  const openSettings = useBuilder((s) => s.openSettings)
  const openBusiness = useBuilder((s) => s.openBusiness)
  const openJobs = useBuilder((s) => s.openJobs)
  const openGodMode = useBuilder((s) => s.openGodMode)
  const openBilling = useBuilder((s) => s.openBilling)
  const openMarketing = useBuilder((s) => s.openMarketing)
  const openSupport = useBuilder((s) => s.openSupport)
  const openOps = useBuilder((s) => s.openOps)
  const openNotifications = useBuilder((s) => s.openNotifications)
  const openAnalytics = useBuilder((s) => s.openAnalytics)
  const openApiKeys = useBuilder((s) => s.openApiKeys)
  const openWebhooks = useBuilder((s) => s.openWebhooks)
  const openWorkspaces = useBuilder((s) => s.openWorkspaces)
  const openAdmin = useBuilder((s) => s.openAdmin)
  const openAuth = useBuilder((s) => s.openAuth)
  const logout = useBuilder((s) => s.logout)
  const currentProject = useBuilder((s) => s.currentProject)
  const projects = useBuilder((s) => s.projects)

  const initial = (session?.user?.email ?? '?').slice(0, 1).toUpperCase()

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <button
          onClick={session ? openDashboard : openLanding}
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <BuildrLogo withWordmark={false} size={28} />
          <span className="hidden sm:inline">Buildr</span>
          <Badge variant="secondary" className="ml-1 hidden md:inline-flex">
            enterprise
          </Badge>
        </button>

        {session && (
          <nav className="ml-2 flex items-center gap-1">
            <Button
              variant={view === 'business' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openBusiness}
              className="h-8 gap-1.5"
            >
              <Rocket className="h-4 w-4" />
              <span className="hidden sm:inline">Launch</span>
            </Button>
            <Button
              variant={view === 'jobs' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openJobs}
              className="h-8 gap-1.5"
            >
              <Briefcase className="h-4 w-4" />
              <span className="hidden lg:inline">Jobs</span>
            </Button>
            <Button
              variant={view === 'godmode' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openGodMode}
              className="h-8 gap-1.5"
            >
              <Zap className="h-4 w-4" />
              <span className="hidden lg:inline">God Mode</span>
            </Button>
            <Button
              variant={view === 'marketing' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openMarketing}
              className="h-8 gap-1.5"
            >
              <Megaphone className="h-4 w-4" />
              <span className="hidden lg:inline">Marketing</span>
            </Button>
            <Button
              variant={view === 'support' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openSupport}
              className="h-8 gap-1.5"
            >
              <LifeBuoy className="h-4 w-4" />
              <span className="hidden lg:inline">Support</span>
            </Button>
            <Button
              variant={view === 'ops' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openOps}
              className="h-8 gap-1.5"
            >
              <Activity className="h-4 w-4" />
              <span className="hidden lg:inline">Ops</span>
            </Button>
            <Button
              variant={view === 'analytics' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openAnalytics}
              className="h-8 gap-1.5"
            >
              <BarChart3 className="h-4 w-4" />
              <span className="hidden lg:inline">Analytics</span>
            </Button>
            <Button
              variant={view === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={openSettings}
              className="h-8 gap-1.5"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {session ? (
            <>
              {currentProject ? (
                <span className="hidden md:inline">
                  <Sparkles className="mr-1 inline h-3 w-3" />
                  {currentProject.name}
                </span>
              ) : (
                <span className="hidden md:inline">
                  {projects.length} project{projects.length === 1 ? '' : 's'}
                </span>
              )}
              {/* Language selector */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
                    <Globe className="h-3.5 w-3.5" />
                    <span className="hidden text-xs sm:inline">{typeof window !== 'undefined' ? (localStorage.getItem('buildr-lang') || 'EN').toUpperCase() : 'EN'}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'en'); window.location.reload() }} className="gap-2 text-xs">English</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'fr'); window.location.reload() }} className="gap-2 text-xs">Français</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'es'); window.location.reload() }} className="gap-2 text-xs">Español</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'de'); window.location.reload() }} className="gap-2 text-xs">Deutsch</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'pt'); window.location.reload() }} className="gap-2 text-xs">Português</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'ar'); window.location.reload() }} className="gap-2 text-xs">العربية</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'zh'); window.location.reload() }} className="gap-2 text-xs">中文</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'ja'); window.location.reload() }} className="gap-2 text-xs">日本語</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'hi'); window.location.reload() }} className="gap-2 text-xs">हिन्दी</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'sw'); window.location.reload() }} className="gap-2 text-xs">Kiswahili</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <NotificationsBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="ml-1 flex items-center gap-1.5 rounded-full p-0.5 pr-2 transition hover:bg-accent"
                    aria-label="Account menu"
                  >
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-emerald-600 text-white text-xs">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden text-xs font-medium text-foreground sm:inline">
                      {session.user.name || session.user.email?.split('@')[0]}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">
                    {session.user.email}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={openSettings} className="gap-2">
                    <Settings className="h-4 w-4" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openBilling} className="gap-2">
                    <CreditCard className="h-4 w-4" /> Billing
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openWorkspaces} className="gap-2">
                    <Users className="h-4 w-4" /> Workspaces
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openApiKeys} className="gap-2">
                    <KeyRound className="h-4 w-4" /> API Keys
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openWebhooks} className="gap-2">
                    <Webhook className="h-4 w-4" /> Webhooks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openNotifications} className="gap-2">
                    <Bell className="h-4 w-4" /> Notifications
                  </DropdownMenuItem>
                  {session.user.isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={openAdmin} className="gap-2 text-emerald-600 focus:text-emerald-700 dark:text-emerald-400">
                        <Shield className="h-4 w-4" /> Admin Console
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logout()}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              {/* Language selector for logged-out users */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
                    <Globe className="h-3.5 w-3.5" />
                    <span className="hidden text-xs sm:inline">{typeof window !== 'undefined' ? (localStorage.getItem('buildr-lang') || 'EN').toUpperCase() : 'EN'}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'en'); window.location.reload() }} className="gap-2 text-xs">English</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'fr'); window.location.reload() }} className="gap-2 text-xs">Français</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'es'); window.location.reload() }} className="gap-2 text-xs">Español</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'de'); window.location.reload() }} className="gap-2 text-xs">Deutsch</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'pt'); window.location.reload() }} className="gap-2 text-xs">Português</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'ar'); window.location.reload() }} className="gap-2 text-xs">العربية</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'zh'); window.location.reload() }} className="gap-2 text-xs">中文</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'ja'); window.location.reload() }} className="gap-2 text-xs">日本語</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'hi'); window.location.reload() }} className="gap-2 text-xs">हिन्दी</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { localStorage.setItem('buildr-lang', 'sw'); window.location.reload() }} className="gap-2 text-xs">Kiswahili</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openAuth('login')}
                className="h-8"
              >
                Sign in
              </Button>
              <Button
                size="sm"
                onClick={() => openAuth('register')}
                className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <User className="mr-1.5 h-3.5 w-3.5" />
                Get started
              </Button>
            </>
          )}
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1 text-muted-foreground hover:text-foreground sm:flex"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  )
}

export function AppFooter() {
  const openLanding = useBuilder((s) => s.openLanding)
  const session = useBuilder((s) => s.session)
  const openDashboard = useBuilder((s) => s.openDashboard)
  const openSettings = useBuilder((s) => s.openSettings)
  const openBilling = useBuilder((s) => s.openBilling)
  const openBusiness = useBuilder((s) => s.openBusiness)

  return (
    <footer className="mt-auto border-t border-border bg-muted/30">
      {/* Feature links */}
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 md:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <BuildrLogo withWordmark={true} size={28} />
            <p className="mt-2 text-xs text-muted-foreground">
              Build, launch, and scale your entire business with AI.
            </p>
          </div>

          {/* Platform */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform</p>
            <div className="flex flex-col gap-1.5">
              <button onClick={openLanding} className="text-left text-xs text-muted-foreground hover:text-foreground">Home</button>
              {session && (
                <>
                  <button onClick={openDashboard} className="text-left text-xs text-muted-foreground hover:text-foreground">Chat</button>
                  <button onClick={openBusiness} className="text-left text-xs text-muted-foreground hover:text-foreground">Launch</button>
                  <button onClick={openBilling} className="text-left text-xs text-muted-foreground hover:text-foreground">Pricing</button>
                  <button onClick={openSettings} className="text-left text-xs text-muted-foreground hover:text-foreground">Settings</button>
                </>
              )}
            </div>
          </div>

          {/* Features */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Features</p>
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <span>Business Launch</span>
              <span>God Mode</span>
              <span>Marketing</span>
              <span>24/7 Operations</span>
              <span>AI Support</span>
            </div>
          </div>

          {/* Security */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Security</p>
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <span>Two-Factor Auth</span>
              <span>GDPR Compliant</span>
              <span>API Keys</span>
              <span>Webhooks</span>
              <span>Team Workspaces</span>
            </div>
          </div>

          {/* Connect */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Connect</p>
            <div className="flex gap-2">
              <a href="https://github.com" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="GitHub">
                <Github className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row md:px-6">
          <p>
            © {new Date().getFullYear()} <span className="font-medium text-foreground">Buildr</span>. All rights reserved.
          </p>
          <p className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            All systems operational
          </p>
        </div>
      </div>
    </footer>
  )
}
