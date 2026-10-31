'use client'

// VersionHistory — dialog showing the project's generation timeline with
// rewind buttons on each assistant turn. Fetches /api/projects/{id} on
// open (via api.getProject), renders a vertical timeline (left border +
// dots), and POSTs to /api/projects/{id}/rewind with { generationId } to
// restore a snapshot. On success: toast, close the dialog, then
// useBuilder.openBuilder(projectId) to reload the project state.
// No indigo/blue/violet — emerald accents only, per the Buildr palette.

import * as React from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Clock,
  GitCommit,
  History,
  Loader2,
  RotateCcw,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import type { GenerationView } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface VersionHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

interface HistoryState {
  loading: boolean
  error: string | null
  generations: GenerationView[]
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return 'recently'
  }
}

function truncate(text: string, max = 220): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max).trimEnd() + '…'
}

function UserNode({ gen }: { gen: GenerationView }) {
  return (
    <div className="relative pl-6 pb-3">
      <span
        className="absolute left-0 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full border border-border bg-muted"
        aria-hidden
      />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <User className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{truncate(gen.content, 120)}</span>
      </div>
      <div className="mt-0.5 pl-4 text-[10px] text-muted-foreground/70">
        {formatRelative(gen.createdAt)}
      </div>
    </div>
  )
}

function AssistantNode({
  gen,
  rewindingId,
  onRewind,
}: {
  gen: GenerationView
  rewindingId: string | null
  onRewind: (gen: GenerationView) => void
}) {
  const isAdmin = useBuilder((s) => !!s.session?.user.isAdmin)
  const isRewinding = rewindingId === gen.id
  const fileCount = gen.fileOps.length
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="relative pl-6 pb-3"
    >
      <span
        className="absolute left-0 top-1.5 grid h-3.5 w-3.5 -translate-x-1/2 place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-background"
        aria-hidden
      >
        <GitCommit className="h-2.5 w-2.5" />
      </span>
      <div className="rounded-md border border-border bg-muted/20 p-2.5">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">
            {formatRelative(gen.createdAt)}
          </span>
          {isAdmin && gen.tokens > 0 ? (
            <Badge
              variant="secondary"
              className="ml-auto gap-1 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
            >
              {gen.tokens} tok
            </Badge>
          ) : null}
        </div>

        <p className="mt-1.5 line-clamp-2 text-xs text-foreground">
          {gen.content?.trim() || '(no message)'}
        </p>

        <div className="mt-2 flex items-center justify-between gap-2">
          <Badge
            variant="outline"
            className="gap-1 border-border px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
          >
            <GitCommit className="h-3 w-3" />
            {fileCount} file{fileCount === 1 ? '' : 's'}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRewind(gen)}
            disabled={isRewinding}
            className={cn(
              'h-7 gap-1.5 px-2.5 text-[11px]',
              'hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400',
            )}
          >
            {isRewinding ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Rewind to here
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-2 pl-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  )
}

function EmptyHistory() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    >
      <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
        <History className="h-4 w-4" />
      </div>
      <p className="text-sm text-muted-foreground">No generations yet.</p>
    </motion.div>
  )
}

export function VersionHistory({
  open,
  onOpenChange,
  projectId,
}: VersionHistoryProps) {
  const openBuilder = useBuilder((s) => s.openBuilder)
  const [state, setState] = React.useState<HistoryState>({
    loading: false,
    error: null,
    generations: [],
  })
  const [rewindingId, setRewindingId] = React.useState<string | null>(null)

  // Fetch generations whenever the dialog opens.
  React.useEffect(() => {
    if (!open || !projectId) return
    let cancelled = false
    setState({ loading: true, error: null, generations: [] })
    api
      .getProject(projectId)
      .then((detail) => {
        if (cancelled) return
        setState({
          loading: false,
          error: null,
          generations: detail.generations ?? [],
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'load_failed'
        setState({ loading: false, error: message, generations: [] })
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  const handleRewind = React.useCallback(
    async (gen: GenerationView) => {
      setRewindingId(gen.id)
      try {
        const res = await fetch(`/api/projects/${projectId}/rewind`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ generationId: gen.id }),
        })
        if (!res.ok) {
          let msg = `rewind_failed (${res.status})`
          try {
            const data = (await res.json()) as { error?: string }
            if (data?.error) msg = data.error
          } catch {
            /* ignore parse error */
          }
          throw new Error(msg)
        }
        toast.success('Rewound successfully', {
          description: 'Project restored to the selected generation.',
        })
        onOpenChange(false)
        // Reload the project so the builder reflects the rewound state.
        await openBuilder(projectId)
      } catch (err) {
        toast.error('Rewind failed', {
          description: err instanceof Error ? err.message : 'unknown_error',
        })
      } finally {
        setRewindingId(null)
      }
    },
    [projectId, onOpenChange, openBuilder],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-600" />
            Version History
          </DialogTitle>
          <DialogDescription>
            Browse every generation and rewind the project to any prior state.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="flex flex-col gap-1 pb-1">
            {state.loading ? (
              <HistorySkeleton />
            ) : state.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {state.error}
              </div>
            ) : state.generations.length === 0 ? (
              <EmptyHistory />
            ) : (
              <div className="relative ml-2 border-l border-border">
                {state.generations.map((gen) =>
                  gen.role === 'assistant' ? (
                    <AssistantNode
                      key={gen.id}
                      gen={gen}
                      rewindingId={rewindingId}
                      onRewind={handleRewind}
                    />
                  ) : (
                    <UserNode key={gen.id} gen={gen} />
                  ),
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
