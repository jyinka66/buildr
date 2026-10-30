'use client'

// Buildr — Left Sidebar Navigation.
// ------------------------------------------------------------------
// All standalone features (Dashboard, Launch, Jobs, God Mode, Marketing,
// Support, Ops, Analytics, Settings) sit in a left sidebar, grouped by
// category — NOT crammed into a top nav bar.
//
// Layout:
//   ┌──────────────────────────┐
//   │ Logo + Brand              │
//   │ ─────────────────────     │
//   │ WORKSPACE                 │
//   │   Dashboard               │
//   │ ─────────────────────     │
//   │ BUILD & LAUNCH            │
//   │   Launch Business         │
//   │   Jobs                    │
//   │   God Mode                │
//   │ ─────────────────────     │
//   │ GROW & OPERATE            │
//   │   Marketing               │
//   │   Support                 │
//   │   Operations              │
//   │   Analytics               │
//   │ ─────────────────────     │
//   │ ACCOUNT                   │
//   │   Settings                │
//   │   Billing                 │
//   │   Workspaces              │
//   │   API Keys                │
//   │   Webhooks                │
//   │ ─────────────────────     │
//   │ [Admin Console]  (if admin)│
//   │ ─────────────────────     │
//   │ User Profile + Sign out   │
//   └──────────────────────────┘
//
// On mobile, the sidebar collapses into a slide-out Sheet (hamburger menu).
// The sidebar only appears on authenticated "page" views — NOT on the
// landing page or the builder workspace (which needs full width).

import * as React from 'react'
import {
  Activity,
  BarChart3,
  Briefcase,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  LogOut,
  Megaphone,
  Rocket,
  Settings,
  Shield,
  Users,
  Webhook,
  Zap,
  Bell,
} from 'lucide-react'
import { useBuilder, type View } from '@/lib/store'
import { BuildrLogo } from '@/components/builder/buildr-logo'
import { NotificationsBell } from '@/components/builder/notifications-bell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// Nav item definition.
interface NavItem {
  icon: React.ElementType
  label: string
  view: View
  action: () => void
}

// Group of nav items under a section heading.
interface NavGroup {
  label: string
  items: NavItem[]
}

function useNavGroups() {
  const s = useBuilder()
  const groups: NavGroup[] = [
    {
      label: 'Workspace',
      items: [
        { icon: LayoutDashboard, label: 'Dashboard', view: 'dashboard', action: s.openDashboard },
        { icon: MessageSquare, label: 'AI Chat', view: 'chat', action: s.openChat },
      ],
    },
    {
      label: 'Build & Launch',
      items: [
        { icon: Rocket, label: 'Launch Business', view: 'business', action: s.openBusiness },
        { icon: Briefcase, label: 'Jobs', view: 'jobs', action: s.openJobs },
        { icon: Zap, label: 'God Mode', view: 'godmode', action: s.openGodMode },
      ],
    },
    {
      label: 'Grow & Operate',
      items: [
        { icon: Megaphone, label: 'Marketing', view: 'marketing', action: s.openMarketing },
        { icon: LifeBuoy, label: 'Support', view: 'support', action: s.openSupport },
        { icon: Activity, label: 'Operations', view: 'ops', action: s.openOps },
        { icon: BarChart3, label: 'Analytics', view: 'analytics', action: s.openAnalytics },
      ],
    },
    {
      label: 'Account',
      items: [
        { icon: Settings, label: 'Settings', view: 'settings', action: s.openSettings },
        { icon: CreditCard, label: 'Billing', view: 'billing', action: s.openBilling },
        { icon: Users, label: 'Workspaces', view: 'workspaces', action: s.openWorkspaces },
        { icon: KeyRound, label: 'API Keys', view: 'api-keys', action: s.openApiKeys },
        { icon: Webhook, label: 'Webhooks', view: 'webhooks', action: s.openWebhooks },
        { icon: Bell, label: 'Notifications', view: 'notifications', action: s.openNotifications },
      ],
    },
  ]
  return { groups, session: s.session, logout: s.logout, openAdmin: s.openAdmin }
}

// Renders the sidebar content (shared between desktop sidebar and mobile sheet).
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { groups, session, logout, openAdmin } = useNavGroups()
  const currentView = useBuilder((s) => s.view)

  if (!session) return null

  const initial = (session.user?.email ?? '?').slice(0, 1).toUpperCase()
  const name = session.user?.name || session.user?.email?.split('@')[0] || 'User'

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <BuildrLogo withWordmark={false} size={28} />
        <span className="text-sm font-bold tracking-tight">Buildr</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">enterprise</Badge>
      </div>

      {/* Nav groups — scrollable */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = currentView === item.view
                return (
                  <button
                    key={item.view}
                    onClick={() => {
                      item.action()
                      onNavigate?.()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Admin console */}
        {session.user.isAdmin && (
          <div className="mb-4">
            <Separator className="mb-2" />
            <button
              onClick={() => {
                openAdmin()
                onNavigate?.()
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                currentView === 'admin'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              <span>Admin Console</span>
            </button>
          </div>
        )}
      </nav>

      {/* User profile + sign out */}
      <div className="border-t border-border p-2">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-emerald-600 text-xs text-white">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{name}</p>
            <p className="truncate text-[10px] text-muted-foreground">{session.user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => {
              logout()
              onNavigate?.()
            }}
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// Mobile sidebar — uses a Sheet (slide-out drawer) triggered by a hamburger.
function MobileSidebar() {
  const [open, setOpen] = React.useState(false)
  const currentProject = useBuilder((s) => s.currentProject)
  const projects = useBuilder((s) => s.projects)
  const session = useBuilder((s) => s.session)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" aria-label="Open menu">
          <span className="flex flex-col gap-1">
            <span className="h-0.5 w-4 bg-current" />
            <span className="h-0.5 w-4 bg-current" />
            <span className="h-0.5 w-4 bg-current" />
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

// Full sidebar component — renders the desktop sidebar (lg+) and the mobile
// hamburger trigger (below lg). The parent decides when to show this.
export function AppSidebar() {
  return (
    <>
      {/* Desktop sidebar — fixed on the left */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar trigger — shown in the top bar */}
      <MobileSidebar />
    </>
  )
}

// Slim top bar for authenticated views — shows project name, notifications,
// and the mobile hamburger. Much cleaner than the old full-width nav bar.
export function AppTopBar() {
  const session = useBuilder((s) => s.session)
  const currentProject = useBuilder((s) => s.currentProject)
  const projects = useBuilder((s) => s.projects)

  if (!session) return null

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      {/* Mobile hamburger */}
      <MobileSidebar />

      {/* Current context */}
      <div className="flex items-center gap-2 text-sm">
        {currentProject ? (
          <>
            <span className="font-medium">{currentProject.name}</span>
            <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">
              {currentProject.status === 'preview-ready' ? 'Preview ready' : currentProject.status}
            </Badge>
          </>
        ) : (
          <span className="text-muted-foreground">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
      </div>
    </header>
  )
}
