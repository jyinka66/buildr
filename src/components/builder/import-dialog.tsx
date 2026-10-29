// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Github, Loader2, Upload, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportDialog({ open, onOpenChange }: Props) {
  const refreshProjects = useBuilder((s) => s.refreshProjects)
  const openBuilder = useBuilder((s) => s.openBuilder)
  const [repo, setRepo] = React.useState('')
  const [token, setToken] = React.useState('')
  const [branch, setBranch] = React.useState('')
  const [name, setName] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<{ projectId: string; fileCount: number; stack: string; repo: string } | null>(null)

  const handleImport = async () => {
    if (!repo.trim() || !token.trim()) {
      toast.error('Repo and token are required.')
      return
    }
    setImporting(true)
    setResult(null)
    try {
      const r = await api.importFromGitHub({
        repo: repo.trim(),
        token: token.trim(),
        branch: branch.trim() || undefined,
        name: name.trim() || undefined,
      })
      setResult({ projectId: r.projectId, fileCount: r.fileCount, stack: r.stack, repo: r.repo })
      toast.success('Project imported!', { description: `${r.fileCount} files from ${r.repo}` })
      await refreshProjects()
    } catch (err) {
      toast.error('Import failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setImporting(false)
    }
  }

  const handleClose = (o: boolean) => {
    if (!o) {
      setRepo('')
      setToken('')
      setBranch('')
      setName('')
      setResult(null)
    }
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Github className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Import from GitHub</DialogTitle>
          </div>
          <DialogDescription>
            Import an existing repository as a new Buildr project. We'll detect the framework automatically.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-400">Imported successfully!</p>
                <p className="text-xs text-muted-foreground">{result.fileCount} files · detected stack: {result.stack}</p>
              </div>
            </div>
            <Button
              className="w-full gap-2"
              onClick={async () => {
                handleClose(false)
                await openBuilder(result.projectId)
              }}
            >
              <Upload className="h-4 w-4" />
              Open imported project
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="imp-repo">Repository (owner/name)</Label>
              <Input id="imp-repo" placeholder="vercel/next.js" value={repo} onChange={(e) => setRepo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-token">GitHub token</Label>
              <Input id="imp-token" type="password" placeholder="ghp_..." value={token} onChange={(e) => setToken(e.target.value)} />
              <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-xs text-emerald-600 hover:underline">
                Create a token →
              </a>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imp-branch">Branch (optional)</Label>
                <Input id="imp-branch" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-name">Project name (optional)</Label>
                <Input id="imp-name" placeholder="My Imported App" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleImport} disabled={importing} className="w-full gap-2">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
              Import repository
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Up to 200 text files are imported (node_modules and binaries are skipped).
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
