'use client'

// Plan review for a God Mode goal that has not started yet.
// ------------------------------------------------------------------
// Shows the plan the AI made and lets the person edit it before anything is
// built: rename or rewrite tasks, change what each one does, reorder, remove,
// or add their own. "Start building" saves the edits (if any) and begins.

import * as React from 'react'
import { ChevronDown, ChevronUp, Loader2, Lock, Plus, Rocket, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { godMode, type GoalDetail, type PlanEditTask } from '@/lib/god-mode/client'
import { EDITABLE_TOOLS, MAX_TASKS, isAutoTool, type PlanTask, type TaskTool } from '@/lib/god-mode/plan'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export const TOOL_LABELS: Record<string, string> = {
  scaffold: 'Create project',
  'code-generator': 'Build code',
  'schema-design': 'Data model',
  seed: 'Sample data',
  seo: 'SEO',
  'code-review': 'Review and fix',
  'image-generator': 'Images (you)',
  deploy: 'Deploy (you)',
  manual: 'Manual (you)',
}

interface DraftTask {
  key: string
  id?: number
  name: string
  description: string
  tool: TaskTool
  dependencies: number[]
}

let keyCounter = 0
const newKey = () => `d-${keyCounter++}`

function toDraft(tasks: PlanTask[]): DraftTask[] {
  return tasks
    .filter((t) => t.tool !== 'scaffold')
    .map((t) => ({
      key: newKey(),
      id: t.id,
      name: t.name,
      description: t.description,
      tool: t.tool,
      dependencies: t.dependencies,
    }))
}

export function PlanEditor({
  detail,
  onStarted,
  onDiscarded,
}: {
  detail: GoalDetail
  onStarted: (detail: GoalDetail) => void
  onDiscarded: () => void
}) {
  const goalId = detail.goal.id
  const scaffold = detail.taskGraph.find((t) => t.tool === 'scaffold')
  const [draft, setDraft] = React.useState<DraftTask[]>(() => toDraft(detail.taskGraph))
  const [dirty, setDirty] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [discarding, setDiscarding] = React.useState(false)

  // A different goal (or a fresh plan from the server) replaces the draft.
  const planVersion = detail.goal.updatedAt
  React.useEffect(() => {
    setDraft(toDraft(detail.taskGraph))
    setDirty(false)
  }, [goalId, planVersion])

  const edit = (key: string, patch: Partial<DraftTask>) => {
    setDraft((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)))
    setDirty(true)
  }
  const move = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }
  const remove = (key: string) => {
    setDraft((prev) => prev.filter((t) => t.key !== key))
    setDirty(true)
  }
  const add = () => {
    setDraft((prev) => [
      ...prev,
      { key: newKey(), name: '', description: '', tool: 'code-generator', dependencies: [] },
    ])
    setDirty(true)
  }

  const blank = draft.some((t) => !t.name.trim())
  const tooMany = draft.length >= MAX_TASKS - 1

  async function start() {
    if (draft.length === 0) {
      toast.error('Add at least one task before starting.')
      return
    }
    if (blank) {
      toast.error('Every task needs a name.')
      return
    }
    setStarting(true)
    try {
      if (dirty) {
        const tasks: PlanEditTask[] = draft.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          tool: t.tool,
          dependencies: t.dependencies,
        }))
        await godMode.updatePlan(goalId, tasks)
      }
      const started = await godMode.approve(goalId)
      toast.success('God Mode started. Building the first version now.')
      onStarted(started)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  async function discard() {
    if (!window.confirm('Discard this plan? This cannot be undone.')) return
    setDiscarding(true)
    try {
      await godMode.remove(goalId)
      onDiscarded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not discard the plan.')
    } finally {
      setDiscarding(false)
    }
  }

  const { summary, deliverables, successCriteria } = detail.plan

  return (
    <div className="mt-4 space-y-4">
      {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}

      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Review the plan, change anything you like, then press <strong>Start building</strong>. Nothing is built until
        you do. Tasks marked <em>(you)</em> pause and wait for you; everything else runs automatically.
      </div>

      <div className="space-y-2">
        {scaffold ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{scaffold.name}</span>
                <Badge variant="outline" className="text-[10px]">Automatic, always first</Badge>
              </div>
              <p className="mt-0.5 text-muted-foreground">{scaffold.description}</p>
            </div>
          </div>
        ) : null}

        {draft.map((t, i) => (
          <div key={t.key} className="space-y-2 rounded-md border border-border p-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-center text-[11px] text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={t.name}
                  onChange={(e) => edit(t.key, { name: e.target.value })}
                  placeholder="Task name"
                  maxLength={80}
                  className="h-8 text-sm"
                  aria-label={`Task ${i + 1} name`}
                />
                <Textarea
                  value={t.description}
                  onChange={(e) => edit(t.key, { description: e.target.value })}
                  placeholder="What should this task change in the app?"
                  maxLength={400}
                  rows={2}
                  className="resize-none text-xs"
                  aria-label={`Task ${i + 1} description`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={t.tool} onValueChange={(v) => edit(t.key, { tool: v as TaskTool })}>
                    <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Task ${i + 1} type`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EDITABLE_TOOLS.map((tool) => (
                        <SelectItem key={tool} value={tool} className="text-xs">
                          {TOOL_LABELS[tool]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!isAutoTool(t.tool) ? (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">Pauses for you</span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label="Move down">
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(t.key)} aria-label="Remove task">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={add} disabled={tooMany}>
          <Plus className="h-3.5 w-3.5" /> Add a task
        </Button>
      </div>

      {deliverables.length > 0 || successCriteria.length > 0 ? (
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          {deliverables.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">You will get</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {deliverables.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {successCriteria.length > 0 ? (
            <div>
              <p className="mb-1 font-medium">Done when</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {successCriteria.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive" onClick={discard} disabled={starting || discarding}>
          {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Discard plan
        </Button>
        <Button
          type="button"
          onClick={start}
          disabled={starting || discarding || draft.length === 0}
          className="gap-2 bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white hover:from-fuchsia-700 hover:to-purple-700"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          {dirty ? 'Save changes and start building' : 'Start building'}
          <Zap className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
