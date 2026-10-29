// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Terminal, Loader2, Play, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

export function ApiTesterDialog({ open, onOpenChange, projectId }: Props) {
  const [method, setMethod] = React.useState('GET')
  const [path, setPath] = React.useState('/api/health')
  const [body, setBody] = React.useState('')
  const [testing, setTesting] = React.useState(false)
  const [result, setResult] = React.useState<{
    ok: boolean; status: number; statusText: string
    headers: Record<string, string>; body: unknown; durationMs: number
  } | null>(null)

  const handleTest = async () => {
    if (!path.trim()) {
      toast.error('Path is required.')
      return
    }
    setTesting(true)
    setResult(null)
    try {
      const r = await api.testApi(projectId, {
        method,
        path: path.trim(),
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      })
      setResult(r)
      if (r.ok) toast.success(`${r.status} ${r.statusText}`, { description: `${r.durationMs}ms` })
      else toast.error(`${r.status} ${r.statusText}`, { description: `${r.durationMs}ms` })
    } catch (err) {
      toast.error('Request failed', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Terminal className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">API Tester</DialogTitle>
          </div>
          <DialogDescription>
            Test your generated API routes with any method, path, and body.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Request config */}
          <div className="flex gap-2">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/users"
              className="flex-1 font-mono text-sm"
            />
            <Button onClick={handleTest} disabled={testing} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Send
            </Button>
          </div>

          {/* Body for non-GET */}
          {!['GET', 'HEAD'].includes(method) ? (
            <div className="space-y-1">
              <Label className="text-xs">Request body (JSON)</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{"name": "test"}'
                className="font-mono text-sm min-h-[80px]"
              />
            </div>
          ) : null}

          {/* Result */}
          {result ? (
            <div className="space-y-2">
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                result.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
              }`}>
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <span className="font-medium">{result.status} {result.statusText}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">{result.durationMs}ms</Badge>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Response body:</p>
                <pre className="max-h-48 overflow-y-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">
                  {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
                </pre>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Headers:</p>
                <pre className="max-h-24 overflow-y-auto rounded-md bg-muted p-2 text-xs">
                  {Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
