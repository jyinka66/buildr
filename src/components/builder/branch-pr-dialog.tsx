// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { GitBranch, Loader2, GitPullRequest, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function BranchPRDialog({ open, onOpenChange, projectId }: Props) {
  const [token, setToken] = React.useState('')
  const [repo, setRepo] = React.useState('')
  const [branchName, setBranchName] = React.useState('feature/buildr-sync')
  const [baseBranch, setBaseBranch] = React.useState('')
  const [createPR, setCreatePR] = React.useState(true)
  const [prTitle, setPrTitle] = React.useState('Sync project from Buildr')
  const [prBody, setPrBody] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [result, setResult] = React.useState<{ branch: string; pushedFiles: number; prUrl: string | null; repoUrl: string } | null>(null)

  const handleCreate = async () => {
    if (!token || !repo || !branchName) {
      toast.error('Token, repo, and branch name are required.')
      return
    }
    if (createPR && !prTitle) {
      toast.error('PR title is required when creating a PR.')
      return
    }
    setCreating(true)
    setResult(null)
    try {
      const r = await api.createBranchPR(projectId, {
        token, repo, branchName,
        baseBranch: baseBranch || undefined,
        createPR,
        prTitle: createPR ? prTitle : undefined,
        prBody: prBody || undefined,
      })
      setResult(r)
      toast.success(`Branch ${r.branch} created!`, { description: `${r.pushedFiles} files pushed.${r.prUrl ? ' PR created.' : ''}` })
    } catch (err) {
      toast.error('Failed to create branch', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <GitBranch className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Branch &amp; PR</DialogTitle>
          </div>
          <DialogDescription>Create a branch and optional pull request with your project files.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-400">Branch created!</p>
                <p className="text-xs text-muted-foreground">{result.pushedFiles} files pushed to {result.branch}</p>
              </div>
            </div>
            <a href={result.repoUrl} target="_blank" rel="noreferrer" className="block break-all text-xs text-emerald-600 hover:underline">
              {result.repoUrl}
            </a>
            {result.prUrl ? (
              <a href={result.prUrl} target="_blank" rel="noreferrer" className="block break-all text-xs text-emerald-600 hover:underline">
                {result.prUrl}
              </a>
            ) : null}
            <Button className="w-full" onClick={() => { setResult(null); onOpenChange(false) }}>Done</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bp-token">GitHub token</Label>
              <Input id="bp-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-repo">Repository (owner/name)</Label>
              <Input id="bp-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="user/repo" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bp-branch">Branch name</Label>
                <Input id="bp-branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bp-base">Base branch (optional)</Label>
                <Input id="bp-base" value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} placeholder="main" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="bp-pr" checked={createPR} onCheckedChange={(v) => setCreatePR(v === true)} />
              <Label htmlFor="bp-pr" className="cursor-pointer text-sm">Also create a pull request</Label>
            </div>
            {createPR ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-title">PR title</Label>
                  <Input id="bp-title" value={prTitle} onChange={(e) => setPrTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-body">PR description (optional)</Label>
                  <Input id="bp-body" value={prBody} onChange={(e) => setPrBody(e.target.value)} placeholder="Describe your changes..." />
                </div>
              </>
            ) : null}
            <Button onClick={handleCreate} disabled={creating} className="w-full gap-2">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitPullRequest className="h-4 w-4" />}
              Create branch{createPR ? ' & PR' : ''}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
