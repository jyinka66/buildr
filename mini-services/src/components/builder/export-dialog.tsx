'use client'

// Export dialog. Two tabs:
// 1) ZIP Export — packages the project as a .zip via the backend and
//    downloads it through /api/export/{id}. Includes a checklist of what's
//    bundled.
// 2) GitHub Sync — pushes the project files to a repo via api.pushToGitHub.
//    On success shows the repo URL as a link + toast. On error shows the
//    message inline. Includes a help link for creating a PAT.

import * as React from 'react'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

const ZIP_INCLUDES = [
  'Project scaffold (Next.js / Node / Vite / HTML)',
  'Generated application code',
  'Integration configuration & env.example',
  'Dockerfile & docker-compose',
  'README with run instructions',
]

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function ExportDialog({ open, onOpenChange, projectId }: ExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export &amp; Deploy</DialogTitle>
          <DialogDescription>
            Download a self-contained .zip of your project or push it to a GitHub
            repository.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="zip" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="zip" className="flex-1 gap-1.5">
              <Download className="h-3.5 w-3.5" /> ZIP Export
            </TabsTrigger>
            <TabsTrigger value="github" className="flex-1 gap-1.5">
              <Github className="h-3.5 w-3.5" /> GitHub Sync
            </TabsTrigger>
          </TabsList>

          <TabsContent value="zip">
            <ZipExportTab projectId={projectId} onOpenChange={onOpenChange} />
          </TabsContent>

          <TabsContent value="github">
            <GitHubSyncTab projectId={projectId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function ZipExportTab({
  projectId,
  onOpenChange,
}: {
  projectId: string
  onOpenChange: (open: boolean) => void
}) {
  const [downloading, setDownloading] = React.useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const url = await api.exportZipUrl(projectId)
      // Use an anchor element so the browser treats it as a download.
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectId}.zip`
      a.target = '_blank'
      a.rel = 'noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      toast.success('Download started', {
        description: 'Your .zip is being prepared.',
      })
      onOpenChange(false)
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Packages your project as a portable <code className="rounded bg-muted px-1 py-0.5 text-xs">.zip</code>{' '}
          archive. You can unzip and run it locally or upload to any host.
        </p>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Includes
        </p>
        <ul className="flex flex-col gap-1.5">
          {ZIP_INCLUDES.map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="text-foreground">{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={handleDownload}
          disabled={downloading}
          className="gap-2"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download .zip
        </Button>
      </div>
    </div>
  )
}

function GitHubSyncTab({ projectId }: { projectId: string }) {
  const [token, setToken] = React.useState('')
  const [repo, setRepo] = React.useState('')
  const [branch, setBranch] = React.useState('main')
  const [commitMessage, setCommitMessage] = React.useState('')
  const [pushing, setPushing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ url: string; pushedFiles: number; commitSha: string } | null>(null)

  const handlePush = async () => {
    setError(null)
    setResult(null)
    if (!token.trim()) {
      setError('A GitHub personal access token is required.')
      return
    }
    if (!repo.trim()) {
      setError('A target repository (owner/name) is required.')
      return
    }
    setPushing(true)
    try {
      const res = await api.pushToGitHub({
        projectId,
        token: token.trim(),
        repo: repo.trim(),
        branch: branch.trim() || 'main',
        commitMessage: commitMessage.trim() || undefined,
      })
      setResult({
        url: res.deployment.url,
        pushedFiles: res.deployment.pushedFiles,
        commitSha: res.deployment.commitSha,
      })
      toast.success('Pushed to GitHub', {
        description: `${res.deployment.pushedFiles} files → ${res.deployment.repo}`,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'push_failed')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="gh-token">Personal access token</Label>
        <div className="relative">
          <KeyRound className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="gh-token"
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="h-8 pl-8"
            autoComplete="off"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Needs the <code className="rounded bg-muted px-1 py-0.5">repo</code> scope.{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=Buildr"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-emerald-600 hover:underline"
          >
            Create a token <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="gh-repo">Repository</Label>
        <Input
          id="gh-repo"
          placeholder="owner/name"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="h-8"
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="gh-branch">Branch</Label>
          <Input
            id="gh-branch"
            placeholder="main"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="h-8"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="gh-commit">Commit message</Label>
          <Input
            id="gh-commit"
            placeholder="chore: ship via Buildr"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            className="h-8"
            autoComplete="off"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Pushed {result.pushedFiles} files.
          </p>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 break-all text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {result.url} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <div className="mt-1">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {result.commitSha.slice(0, 7)}
            </Badge>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={handlePush} disabled={pushing} className="gap-2">
          {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
          Push to GitHub
        </Button>
      </div>
    </div>
  )
}
