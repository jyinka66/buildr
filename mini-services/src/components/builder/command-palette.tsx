'use client'

// Command palette (⌘K / Ctrl+K) for Buildr.
//
// Global discovery surface: quick navigation, project switching, file
// jumping, and common actions (export, version history, auth). Uses the
// existing cmdk-backed `CommandDialog` from `@/components/ui/command` so the
// overlay + a11y wiring is handled for us — we just compose the command list.
//
// Design contract: emerald accent only (no indigo/blue/violet), sticky
// footer-friendly floating hint button at bottom-right.

import * as React from 'react'
import {
  Command as CommandIcon,
  Download,
  FileCode,
  FolderOpen,
  History,
  Home,
  LayoutDashboard,
  LogIn,
  LogOut,
  Plus,
  Settings,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'

import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'

export function CommandPalette() {
  const [open, setOpen] = React.useState(false)

  // Store hooks — one selector per slice to minimise re-renders.
  const view = useBuilder((s) => s.view)
  const session = useBuilder((s) => s.session)
  const projects = useBuilder((s) => s.projects)
  const currentProject = useBuilder((s) => s.currentProject)
  const files = useBuilder((s) => s.files)
  const openLanding = useBuilder((s) => s.openLanding)
  const openDashboard = useBuilder((s) => s.openDashboard)
  const openSettings = useBuilder((s) => s.openSettings)
  const openBuilder = useBuilder((s) => s.openBuilder)
  const openAuth = useBuilder((s) => s.openAuth)
  const logout = useBuilder((s) => s.logout)
  const selectFile = useBuilder((s) => s.selectFile)
  const setBuilderTab = useBuilder((s) => s.setBuilderTab)

  // Global ⌘K (Mac) / Ctrl+K (others) toggle. Escape closes — Radix Dialog
  // already handles Escape, but we add an explicit document listener so the
  // behaviour is guaranteed regardless of focus restoration timing.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const close = React.useCallback(() => setOpen(false), [])

  // Open a file from the palette. If we're already in the builder, just select
  // it and switch to the code tab. Otherwise re-open the project (which
  // repopulates files) and then select the requested file.
  const handleOpenFile = React.useCallback(
    async (path: string) => {
      close()
      if (view === 'builder') {
        selectFile(path)
        setBuilderTab('code')
        return
      }
      if (currentProject) {
        await openBuilder(currentProject.id)
        selectFile(path)
        setBuilderTab('code')
      }
    },
    [close, view, currentProject, selectFile, setBuilderTab, openBuilder],
  )

  // "New project" — the create dialog lives in DashboardView's local state.
  // Rather than touching the store, we navigate to the dashboard and let the
  // user click the prominent "New project" button. We also dispatch a
  // `buildr:new-project` custom event so a future listener can auto-open the
  // dialog once the dashboard has mounted.
  const handleNewProject = React.useCallback(() => {
    close()
    openDashboard()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('buildr:new-project'))
    }
    toast('Click “New project” on the dashboard to create one.')
  }, [close, openDashboard])

  // Export current project as a ZIP via the backend export endpoint.
  const handleExport = React.useCallback(() => {
    close()
    if (!currentProject) return
    if (typeof window !== 'undefined') {
      window.open(
        `/api/export/${currentProject.id}`,
        '_blank',
        'noopener,noreferrer',
      )
    }
    toast('Preparing ZIP export…', {
      description: currentProject.name,
    })
  }, [close, currentProject])

  // Emit a custom event that any view can listen for to surface history.
  const handleHistory = React.useCallback(() => {
    close()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('buildr:show-history'))
    }
    toast('Opening version history…')
  }, [close])

  const handleSignOut = React.useCallback(() => {
    close()
    void logout()
    toast.success('Signed out')
  }, [close, logout])

  const handleAuth = React.useCallback(
    (mode: 'login' | 'register') => {
      close()
      openAuth(mode)
    },
    [close, openAuth],
  )

  const go = React.useCallback(
    (fn: () => void | Promise<void>) => () => {
      close()
      void fn()
    },
    [close],
  )

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Buildr command palette"
        description="Search for a command to run…"
      >
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Navigation ------------------------------------------------ */}
          <CommandGroup heading="Navigation">
            <CommandItem
              value="go to dashboard"
              onSelect={go(() => openDashboard())}
            >
              <LayoutDashboard />
              <span>Go to Dashboard</span>
            </CommandItem>
            <CommandItem
              value="go to settings"
              onSelect={go(() => openSettings())}
            >
              <Settings />
              <span>Go to Settings</span>
            </CommandItem>
            <CommandItem
              value="back to landing home"
              onSelect={go(() => openLanding())}
            >
              <Home />
              <span>Back to landing</span>
            </CommandItem>
          </CommandGroup>

          {/* Projects -------------------------------------------------- */}
          {projects.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Projects">
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`open project ${project.name} ${project.description ?? ''}`}
                    onSelect={go(() => openBuilder(project.id))}
                  >
                    <FolderOpen />
                    <span className="truncate">Open project: {project.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Files ----------------------------------------------------- */}
          {currentProject && files.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup
                heading={`Files · ${currentProject.name}`}
              >
                {files.map((file) => (
                  <CommandItem
                    key={file.id}
                    value={`open file ${file.path}`}
                    onSelect={() => {
                      void handleOpenFile(file.path)
                    }}
                  >
                    <FileCode />
                    <span className="truncate">Open file: {file.path}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Actions --------------------------------------------------- */}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem
              value="new project create"
              onSelect={handleNewProject}
            >
              <Plus />
              <span>New project</span>
            </CommandItem>
            {currentProject && (
              <CommandItem
                value="export project zip download"
                onSelect={handleExport}
              >
                <Download />
                <span>Export project</span>
                <CommandShortcut>ZIP</CommandShortcut>
              </CommandItem>
            )}
            <CommandItem
              value="view version history"
              onSelect={handleHistory}
            >
              <History />
              <span>View version history</span>
            </CommandItem>
          </CommandGroup>

          {/* Account / Auth ------------------------------------------- */}
          {!session ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Account">
                <CommandItem
                  value="sign in login"
                  onSelect={() => handleAuth('login')}
                >
                  <LogIn />
                  <span>Sign in</span>
                </CommandItem>
                <CommandItem
                  value="create account register sign up"
                  onSelect={() => handleAuth('register')}
                >
                  <UserPlus />
                  <span>Create account</span>
                </CommandItem>
              </CommandGroup>
            </>
          ) : (
            <>
              <CommandSeparator />
              <CommandGroup heading="Account">
                <CommandItem
                  value="sign out logout"
                  onSelect={handleSignOut}
                >
                  <LogOut />
                  <span>Sign out</span>
                  <CommandShortcut>{session.user.email}</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {/* Floating discovery button — bottom-right, emerald, subtle. */}
      {!open && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label="Open command palette"
          className="fixed bottom-4 right-4 z-40 h-9 gap-1.5 rounded-full border-emerald-300/70 bg-emerald-50/90 px-3 text-emerald-700 shadow-sm backdrop-blur transition-colors hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-200"
        >
          <CommandIcon className="h-4 w-4" />
          <kbd className="hidden text-[10px] font-medium tracking-wide sm:inline">
            ⌘K
          </kbd>
        </Button>
      )}
    </>
  )
}
