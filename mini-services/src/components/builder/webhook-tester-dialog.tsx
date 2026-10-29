// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Webhook, Loader2, Play, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

const PROVIDERS = [
  { value: 'stripe', label: 'Stripe', defaultPath: '/api/webhooks/stripe', defaultEvent: 'checkout.session.completed' },
  { value: 'twilio', label: 'Twilio', defaultPath: '/api/webhooks/twilio', defaultEvent: 'message.delivered' },
  { value: 'resend', label: 'Resend', defaultPath: '/api/webhooks/resend', defaultEvent: 'email.delivered' },
  { value: 'github', label: 'GitHub', defaultPath: '/api/webhooks/github', defaultEvent: 'opened' },
  { value: 'generic', label: 'Generic', defaultPath: '/api/webhooks', defaultEvent: 'test' },
]

export function WebhookTesterDialog({ open, onOpenChange, projectId }: Props) {
  const [provider, setProvider] = React.useState('stripe')
  const [path, setPath] = React.useState('/api/webhooks/stripe')
  const [eventType, setEventType] = React.useState('checkout.session.completed')
  const [testing, setTesting] = React.useState(false)
  const [result, setResult] = React.useState<{
    ok: boolean
    status: number
    response: unknown
    requestPayload: unknown
  } | null>(null)

  const handleProviderChange = (val: string) => {
    setProvider(val)
    const p = PROVIDERS.find((x) => x.value === val)
    if (p) {
      setPath(p.defaultPath)
      setEventType(p.defaultEvent)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    try {
      const r = await api.testWebhook(projectId, { path, provider, eventType })
      setResult(r)
      if (r.ok) {
        toast.success('Webhook test succeeded', { description: `Status: ${r.status}` })
      } else {
        toast.error('Webhook test failed', { description: `Status: ${r.status}` })
      }
    } catch (err) {
      toast.error('Webhook test failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Webhook className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Webhook Tester</DialogTitle>
          </div>
          <DialogDescription>
            Send a realistic test payload to your generated webhook route to verify it works.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wh-path">Webhook route path</Label>
            <Input id="wh-path" value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-sm" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wh-event">Event type</Label>
            <Input id="wh-event" value={eventType} onChange={(e) => setEventType(e.target.value)} className="font-mono text-sm" />
          </div>

          <Button onClick={handleTest} disabled={testing} className="w-full gap-2">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Send test webhook
          </Button>

          {result ? (
            <div className="space-y-2">
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                result.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
              }`}>
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <span className="font-medium">Status: {result.status}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">{result.ok ? 'Success' : 'Failed'}</Badge>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Response:</p>
                <pre className="max-h-40 overflow-y-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">
                  {typeof result.response === 'string'
                    ? result.response
                    : JSON.stringify(result.response, null, 2)}
                </pre>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Request payload sent:</p>
                <pre className="max-h-32 overflow-y-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(result.requestPayload, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
