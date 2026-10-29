'use client'

// DiffViewer — renders a unified diff for files changed in a generation.
// Each entry becomes a Card-like section with a colored action badge
// (create=emerald, update=amber, delete=red) and a "+N / -M" counter,
// followed by a scrollable <pre> body (zinc-950, mono, text-xs) that
// renders context lines (zinc-400), additions (emerald-400 on
// emerald-950/30) and deletions (red-400 on red-950/30). Each line is its
// own div with the prefix char (+/-/space). No indigo/blue/violet —
// emerald / amber / red only, per the Buildr palette.

import * as React from 'react'
import { motion } from 'framer-motion'
import { diffFile, type DiffOp } from '@/lib/diff'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface DiffEntry {
  path: string
  oldContent: string | null
  newContent: string | null
  action: 'create' | 'update' | 'delete'
}

interface ActionStyle {
  label: string
  badgeClass: string
  dotClass: string
}

const ACTION_STYLES: Record<DiffEntry['action'], ActionStyle> = {
  create: {
    label: 'create',
    badgeClass:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  update: {
    label: 'update',
    badgeClass:
      'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  delete: {
    label: 'delete',
    badgeClass:
      'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
    dotClass: 'bg-red-500',
  },
}

function DiffLine({ op }: { op: DiffOp }) {
  if (op.type === 'context') {
    return (
      <div className="flex gap-2 px-2 py-px text-zinc-400">
        <span className="w-3 shrink-0 select-none" aria-hidden>
          {' '}
        </span>
        <span className="whitespace-pre-wrap break-all">{op.text || ' '}</span>
      </div>
    )
  }
  if (op.type === 'add') {
    return (
      <div className="flex gap-2 bg-emerald-950/30 px-2 py-px text-emerald-400">
        <span className="w-3 shrink-0 select-none" aria-hidden>
          +
        </span>
        <span className="whitespace-pre-wrap break-all">{op.text || ' '}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 bg-red-950/30 px-2 py-px text-red-400">
      <span className="w-3 shrink-0 select-none" aria-hidden>
        -
      </span>
      <span className="whitespace-pre-wrap break-all">{op.text || ' '}</span>
    </div>
  )
}

function FileDiffCard({ entry, index }: { entry: DiffEntry; index: number }) {
  const summary = React.useMemo(
    () => diffFile(entry.path, entry.oldContent, entry.newContent),
    [entry.path, entry.oldContent, entry.newContent],
  )
  const style = ACTION_STYLES[entry.action]

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.3) }}
    >
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-row items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              style.dotClass,
            )}
            aria-hidden
          />
          <code
            className="min-w-0 truncate font-mono text-xs text-foreground"
            title={entry.path}
          >
            {entry.path}
          </code>
          <Badge
            variant="outline"
            className={cn(
              'ml-auto border text-[10px] uppercase tracking-wide',
              style.badgeClass,
            )}
          >
            {style.label}
          </Badge>
          <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
            <span className="text-emerald-500">+{summary.additions}</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-red-500">-{summary.deletions}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <pre className="max-h-80 overflow-y-auto bg-zinc-950 p-0 font-mono text-xs leading-relaxed">
            <code className="block">
              {summary.ops.length === 0 ? (
                <div className="px-3 py-2 text-zinc-500">(empty file)</div>
              ) : (
                summary.ops.map((op, i) => <DiffLine key={i} op={op} />)
              )}
            </code>
          </pre>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function DiffViewer({ diffs }: { diffs: DiffEntry[] }) {
  if (!diffs || diffs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No file changes in this turn.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {diffs.map((entry, i) => (
        <FileDiffCard
          key={`${entry.action}:${entry.path}`}
          entry={entry}
          index={i}
        />
      ))}
    </div>
  )
}
