'use client'

// Live preview iframe. Fetches the rendered HTML bundle from
// /api/projects/{id}/preview and injects it via srcDoc so we can sandbox it
// safely. Provides a device toolbar (desktop / mobile widths), a manual
// refresh button, and an "open in new tab" link to the raw preview endpoint.
// A small banner explains this is a structural preview only.

import * as React from 'react'
import { ExternalLink, Eye, Monitor, RefreshCw, Smartphone } from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type DeviceMode = 'desktop' | 'mobile'

export function PreviewPanel() {
  const currentProject = useBuilder((s) => s.currentProject)
  const projectId = currentProject?.id ?? null
  const files = useBuilder((s) => s.files)
  const generating = useBuilder((s) => s.generating)
  const builderTab = useBuilder((s) => s.builderTab)

  const [html, setHtml] = React.useState<string>('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [device, setDevice] = React.useState<DeviceMode>('desktop')

  const fetchPreview = React.useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${id}/preview`, { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`preview_unavailable (${res.status})`)
      }
      const text = await res.text()
      setHtml(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'preview_failed')
      setHtml('')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load preview when project changes.
  React.useEffect(() => {
    if (!projectId) return
    void fetchPreview(projectId)
  }, [projectId, fetchPreview])

  // AUTO-REFRESH preview when generation completes (generating goes from true → false)
  // or when the preview tab is selected.
  const prevGenerating = React.useRef(generating)
  React.useEffect(() => {
    // Refresh when generation just finished (generating was true, now false)
    if (prevGenerating.current && !generating && projectId) {
      void fetchPreview(projectId)
    }
    prevGenerating.current = generating
  }, [generating, projectId, fetchPreview])

  // Also refresh when switching to the preview tab.
  React.useEffect(() => {
    if (builderTab === 'preview' && projectId && !generating) {
      void fetchPreview(projectId)
    }
  }, [builderTab, projectId, generating, fetchPreview])

  if (!projectId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        No project loaded.
      </div>
    )
  }

  const previewUrl = `/api/projects/${projectId}/preview`

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Eye className="h-3.5 w-3.5 text-emerald-600" />
        <span className="text-sm font-medium">Live preview</span>

        <div className="ml-2 flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <Button
            size="sm"
            variant={device === 'desktop' ? 'secondary' : 'ghost'}
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => setDevice('desktop')}
            aria-pressed={device === 'desktop'}
          >
            <Monitor className="h-3 w-3" />
            <span className="hidden sm:inline">Desktop</span>
          </Button>
          <Button
            size="sm"
            variant={device === 'mobile' ? 'secondary' : 'ghost'}
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => setDevice('mobile')}
            aria-pressed={device === 'mobile'}
          >
            <Smartphone className="h-3 w-3" />
            <span className="hidden sm:inline">Mobile</span>
          </Button>
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void fetchPreview(projectId)}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>

        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs hover:bg-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Open in new tab</span>
        </a>
      </div>

      {/* banner */}
      <div className="border-b border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
        Interactive preview — React components render live. API routes require export.
      </div>

      {/* viewport */}
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-900">
        <div
          className={cn(
            'mx-auto h-full transition-[max-width] duration-300',
            device === 'mobile' ? 'max-w-[390px]' : 'max-w-full',
          )}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading preview…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm font-medium text-destructive">Preview failed</p>
              <p className="max-w-sm text-xs text-muted-foreground">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-7 gap-1 px-2 text-xs"
                onClick={() => void fetchPreview(projectId)}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : html ? (
            <iframe
              title="App preview"
              srcDoc={html}
              sandbox="allow-scripts"
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No preview yet.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
