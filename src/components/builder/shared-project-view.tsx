'use client'

// SharedProjectView — public, read-only view of a shared project.
// Shows the project name + description, a live preview iframe, and a
// read-only file list. No auth required.

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Boxes, ExternalLink, FileCode, Eye, Github, Lock } from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useState, useEffect } from 'react'

export function SharedProjectView() {
  const shared = useBuilder((s) => s.sharedProject)
  const openLanding = useBuilder((s) => s.openLanding)
  const [previewHtml, setPreviewHtml] = useState('')

  const projectName = shared?.project.name ?? 'Shared Project'
  const files = shared?.files ?? []
  const previewUrl = shared?.previewUrl ?? ''

  useEffect(() => {
    if (!previewUrl) return
    let cancelled = false
    fetch(previewUrl)
      .then((res) => res.text())
      .then((html) => {
        if (!cancelled) setPreviewHtml(html)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [previewUrl])

  const fileCount = useMemo(() => files.length, [files])

  if (!shared) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Header bar */}
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
            <Boxes className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{projectName}</h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              Shared project · read-only
            </p>
          </div>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {shared.project.stack}
          </Badge>
          <Button size="sm" variant="outline" onClick={openLanding} className="gap-1.5">
            <Boxes className="h-3.5 w-3.5" />
            Try Buildr
          </Button>
        </div>
      </div>

      {/* Description */}
      {shared.project.description ? (
        <div className="border-b border-border bg-background px-4 py-3">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm text-muted-foreground">{shared.project.description}</p>
          </div>
        </div>
      ) : null}

      {/* Main: file list + preview */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* File list (read-only) */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileCode className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Files</span>
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {fileCount}
              </Badge>
            </div>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-0.5">
                {files.map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center gap-1.5 truncate px-2 py-1 text-xs text-muted-foreground"
                  >
                    <FileCode className="h-3 w-3 shrink-0 text-emerald-600" />
                    <span className="truncate font-mono">{f.path}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Live preview */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Eye className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Live Preview</span>
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
            <div className="h-[70vh] bg-white">
              {previewHtml ? (
                <iframe
                  title="Shared project preview"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts"
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading preview…
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
