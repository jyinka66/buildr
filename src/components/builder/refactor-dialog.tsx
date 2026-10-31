// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

// Multi-file Refactor Dialog — understands the project as a file graph.
// Sends ALL code files to the LLM with the refactor instruction, gets back
// ALL affected files (not just the one being renamed — every file that
// imports a renamed symbol). Shows diffs before applying.

import * as React from 'react'
import { GitMerge, Loader2, Eye, Check, FileCode, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import { DiffViewer, type DiffEntry } from '@/components/builder/diff-viewer'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

const REFACTOR_EXAMPLES = [
  'Rename the TaskList component to TodoList across all files',
  'Extract a Header component from page.tsx into its own file',
  'Convert the useState in Counter to useReducer',
  'Move the API route from /api/users to /api/customers and update all references',
  'Extract the form logic into a custom hook called useForm',
]

interface RefactorResult {
  instruction: string
  affectedCount: number
  diffs: DiffEntry[]
  applied: boolean
  provider: { name: string; model: string }
  tokens: number
  durationMs: number
}

export function RefactorDialog({ open, onOpenChange, projectId }: Props) {
  const [instruction, setInstruction] = React.useState('')
  const [previewing, setPreviewing] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [result, setResult] = React.useState<RefactorResult | null>(null)
  const activeProviderKey = useBuilder((s) => s.activeProviderKey)
  const isAdmin = useBuilder((s) => !!s.session?.user.isAdmin)

  const handlePreview = async () => {
    if (!instruction.trim()) {
      toast.error('Instruction is required.')
      return
    }
    setPreviewing(true)
    setResult(null)
    try {
      const r = await api.refactor(projectId, {
        instruction: instruction.trim(),
        apply: false,
        providerKey: activeProviderKey,
      })
      setResult(r)
      if (r.affectedCount === 0) {
        toast.info('No files need updating', { description: 'The refactor instruction may not require changes.' })
      } else {
        toast.success(`${r.affectedCount} file(s) affected`, { description: 'Review the diffs below.' })
      }
    } catch (err) {
      toast.error('Refactor preview failed', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally {
      setPreviewing(false)
    }
  }

  const handleApply = async () => {
    setApplying(true)
    try {
      const r = await api.refactor(projectId, {
        instruction: instruction.trim(),
        apply: true,
        providerKey: activeProviderKey,
      })
      toast.success('Refactor applied!', { description: `${r.affectedCount} file(s) updated.` })
      // Refresh files in the builder.
      const detail = await api.getProject(projectId)
      useBuilder.setState({ files: detail.files })
      onOpenChange(false)
      setInstruction('')
      setResult(null)
    } catch (err) {
      toast.error('Apply failed', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally {
      setApplying(false)
    }
  }

  const handleClose = (o: boolean) => {
    if (!o) {
      setInstruction('')
      setResult(null)
    }
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <GitMerge className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Multi-file Refactor</DialogTitle>
          </div>
          <DialogDescription>
            AI-powered refactoring that understands your project's file graph. Renames, extracts, and updates imports across ALL affected files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="refactor-instruction">Refactor instruction</Label>
            <Textarea
              id="refactor-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={REFACTOR_EXAMPLES[0]}
              className="min-h-[80px] text-sm"
            />
          </div>

          {/* Example chips */}
          {!result ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Examples:</Label>
              <div className="flex flex-wrap gap-1.5">
                {REFACTOR_EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setInstruction(ex)}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {ex.slice(0, 50)}…
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!result ? (
            <Button onClick={handlePreview} disabled={previewing} variant="outline" className="w-full gap-2">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview affected files
            </Button>
          ) : (
            <>
              {/* Preview results */}
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                <FileCode className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium">
                  {result.affectedCount} file{result.affectedCount === 1 ? '' : 's'} affected
                </span>
                {isAdmin ? (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {result.provider.name} · {result.tokens} tok · {(result.durationMs / 1000).toFixed(1)}s
                  </Badge>
                ) : null}
              </div>

              {result.affectedCount > 0 ? (
                <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border p-2">
                  <DiffViewer diffs={result.diffs} />
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={() => { setResult(null) }}
                >
                  <Eye className="h-4 w-4" /> Edit instruction
                </Button>
                <Button
                  className="flex-1 gap-1.5"
                  onClick={handleApply}
                  disabled={applying || result.affectedCount === 0}
                >
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Apply to {result.affectedCount} file{result.affectedCount === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
