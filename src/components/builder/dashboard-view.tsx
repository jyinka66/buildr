'use client'

// Dashboard view — the landing page of the app shell.
// Shows hero, stats, and the project grid. Owns the NewProjectDialog and
// the delete-confirm AlertDialog. Calls `useBuilder.boot()` on mount.

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { motion } from 'framer-motion'
import {
  Boxes,
  Clock,
  Cpu,
  Database,
  Download,
  FileCode2,
  FolderGit2,
  Layers,
  Link2,
  Loader2,
  MoreVertical,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { useBuilder } from '@/lib/store'
import type { ProjectView } from '@/lib/types'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { NewProjectDialog } from '@/components/builder/new-project-dialog'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Status badge colour map — kept neutral/emerald per the design contract.
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<ProjectView['status'], { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'bg-zinc-200/80 text-zinc-800 border-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700',
  },
  'preview-ready': {
    label: 'Preview ready',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-700',
  },
  deployed: {
    label: 'Deployed',
    className: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-700',
  },
  error: {
    label: 'Error',
    className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-500/15 dark:text-red-300 dark:border-red-700',
  },
}

const STACK_LABEL: Record<ProjectView['stack'], string> = {
  nextjs: 'Next.js',
  'node-express': 'Node + Express',
  'react-vite': 'React + Vite',
  'static-html': 'Static HTML',
}

const STYLING_LABEL: Record<ProjectView['styling'], string> = {
  tailwind: 'Tailwind',
  bootstrap: 'Bootstrap',
  plain: 'Plain CSS',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardView() {
  const projects = useBuilder((s) => s.projects)
  const projectsLoading = useBuilder((s) => s.projectsLoading)
  const bootError = useBuilder((s) => s.bootError)
  const booted = useBuilder((s) => s.booted)
  const providers = useBuilder((s) => s.providers)
  const integrations = useBuilder((s) => s.integrations)
  const boot = useBuilder((s) => s.boot)
  const openBuilder = useBuilder((s) => s.openBuilder)
  const deleteProject = useBuilder((s) => s.deleteProject)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectView | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  // Boot the store on mount if we haven't booted yet.
  React.useEffect(() => {
    if (!booted) {
      void boot()
    }
  }, [booted, boot])

  const enabledProviders = React.useMemo(
    () => providers.filter((p) => p.hasKey).length,
    [providers],
  )

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProject(deleteTarget.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">
      {/* Hero ------------------------------------------------------------ */}
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <Badge
            variant="outline"
            className="w-fit border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            <Sparkles className="h-3 w-3" />
            Build · Launch · Scale
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Your projects
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Create a new project, launch a business, or activate God Mode. Everything you build lives here.
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="h-10 self-start bg-emerald-600 text-white hover:bg-emerald-700 md:self-auto"
        >
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </section>

      {/* Stats ----------------------------------------------------------- */}
      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<FolderGit2 className="h-4 w-4" />}
          label="Projects"
          value={projects.length}
          loading={projectsLoading}
        />
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="Providers enabled"
          value={enabledProviders}
          loading={projectsLoading}
          hint={`${providers.length} configured`}
        />
        <StatCard
          icon={<Boxes className="h-4 w-4" />}
          label="Integrations available"
          value={integrations.length}
          loading={projectsLoading}
        />
      </section>

      {/* Boot error ------------------------------------------------------ */}
      {bootError && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-500/10 dark:text-red-300">
          Failed to load dashboard state: {bootError}
        </div>
      )}

      {/* Projects -------------------------------------------------------- */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium tracking-tight">Your projects</h2>
          {projectsLoading && projects.length === 0 && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </span>
          )}
        </div>

        {projects.length === 0 ? (
          <EmptyState onCreate={() => setDialogOpen(true)} loading={projectsLoading} />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={i}
                onOpen={() => openBuilder(project.id)}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Dialogs --------------------------------------------------------- */}
      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{deleteTarget?.name}</strong> and all of its
              generated files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  loading,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number
  loading?: boolean
  hint?: string
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-2xl font-semibold tabular-nums leading-tight">
            {loading ? '—' : value}
          </span>
          {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({ onCreate, loading }: { onCreate: () => void; loading?: boolean }) {
  return (
    <Card className="border-dashed py-10">
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <p className="text-base font-medium">No projects yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Spin up your first project — describe what you want to build and Buildr will scaffold
            the whole stack for you.
          </p>
        </div>
        <Button
          onClick={onCreate}
          disabled={loading}
          className="mt-1 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Create your first project
        </Button>
      </CardContent>
    </Card>
  )
}

function ProjectCard({
  project,
  index,
  onOpen,
  onDelete,
}: {
  project: ProjectView
  index: number
  onOpen: () => void
  onDelete: () => void
}) {
  const [sharing, setSharing] = React.useState(false)
  const [shareError, setShareError] = React.useState<string | null>(null)

  async function togglePublicSharing() {
    setSharing(true)
    setShareError(null)
    try {
      const result = await (await import('@/lib/api-client')).api.setProjectPublic(project.id, !project.isPublic)
      useBuilder.setState((state) => ({
        projects: state.projects.map((item) => item.id === project.id ? { ...item, isPublic: result.isPublic } : item),
      }))
      if (result.isPublic && result.shareUrl && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.shareUrl)
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not update public sharing.')
    } finally {
      setSharing(false)
    }
  }
  const status = STATUS_BADGE[project.status]
  const updatedLabel = React.useMemo(() => {
    try {
      return formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })
    } catch {
      return 'recently'
    }
  }, [project.updatedAt])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.24) }}
    >
      <Card className="group h-full transition-shadow hover:shadow-md">
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
                <FileCode2 className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">{project.name}</span>
            </CardTitle>
            <Badge variant="outline" className={cn('shrink-0', status.className)}>
              {status.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="gap-1 font-normal">
              <Layers className="h-3 w-3" />
              {STACK_LABEL[project.stack]}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {STYLING_LABEL[project.styling]}
            </Badge>
            <Badge variant="secondary" className="gap-1 font-normal">
              <Database className="h-3 w-3" />
              {project.dbConfig.engine}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pb-2">
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {project.description?.trim()
              ? project.description
              : project.prompt?.trim()
                ? project.prompt
                : 'No description provided.'}
          </p>
        </CardContent>

        <CardFooter className="mt-2 flex-col items-stretch gap-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileCode2 className="h-3 w-3" />
              {project.fileCount} file{project.fileCount === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {updatedLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onOpen} size="sm" className="flex-1">
              Open
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Project actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    if (typeof window !== 'undefined') {
                      window.open(`/api/export/${project.id}`, '_blank', 'noopener,noreferrer')
                    }
                  }}
                >
                  <Download className="h-4 w-4" />
                  Export ZIP
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void togglePublicSharing()} disabled={sharing}>
                  <Link2 className="h-4 w-4" />
                  {sharing ? 'Updating public link…' : project.isPublic ? 'Disable public link' : 'Enable public link'}
                </DropdownMenuItem>
                {shareError && <div role="alert" className="max-w-56 px-2 py-1 text-xs text-destructive">{shareError}</div>}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  )
}
