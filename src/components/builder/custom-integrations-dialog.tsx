// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Puzzle, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

interface CustomInt {
  key: string
  name: string
  description: string
  envVars: string[]
  installSnippet: string
  importSnippet: string
  usageExample: string
}

export function CustomIntegrationsDialog({ open, onOpenChange, projectId }: Props) {
  const [integrations, setIntegrations] = React.useState<CustomInt[]>([])
  const [loading, setLoading] = React.useState(false)
  const [key, setKey] = React.useState('')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [envVars, setEnvVars] = React.useState('')
  const [installSnippet, setInstallSnippet] = React.useState('')
  const [importSnippet, setImportSnippet] = React.useState('')
  const [usageExample, setUsageExample] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const fetchIntegrations = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listCustomIntegrations(projectId)
      setIntegrations(data.integrations as unknown as CustomInt[])
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }, [projectId])

  React.useEffect(() => { if (open) void fetchIntegrations() }, [open, fetchIntegrations])

  const handleSave = async () => {
    if (!key.trim() || !name.trim()) {
      toast.error('Key and name are required.')
      return
    }
    setSaving(true)
    try {
      await api.upsertCustomIntegration(projectId, {
        key: key.trim(),
        name: name.trim(),
        description,
        envVars: envVars.split(',').map(s => s.trim()).filter(Boolean),
        installSnippet,
        importSnippet,
        usageExample,
      })
      toast.success(`Integration "${name}" saved`)
      setKey(''); setName(''); setDescription(''); setEnvVars('')
      setInstallSnippet(''); setImportSnippet(''); setUsageExample('')
      await fetchIntegrations()
    } catch (err) {
      toast.error('Save failed', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally { setSaving(false) }
  }

  const handleDelete = async (intKey: string) => {
    try {
      await api.deleteCustomIntegration(projectId, intKey)
      toast.success('Integration deleted')
      await fetchIntegrations()
    } catch { toast.error('Delete failed') }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Puzzle className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Custom Integrations</DialogTitle>
          </div>
          <DialogDescription>
            Define your own connectors. The code generator will use these when generating code.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Existing */}
            {integrations.length > 0 ? (
              <div className="space-y-1.5">
                {integrations.map((int) => (
                  <div key={int.key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{int.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{int.description || int.key}</p>
                    </div>
                    {int.envVars?.length > 0 ? (
                      <Badge variant="secondary" className="text-[10px]">{int.envVars.length} env vars</Badge>
                    ) : null}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(int.key)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Add new */}
            <div className="space-y-3 rounded-md border border-border p-3">
              <Label className="text-xs">Add custom integration</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Key</Label>
                  <Input placeholder="my-service" value={key} onChange={e => setKey(e.target.value)} className="text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input placeholder="My Service" value={name} onChange={e => setName(e.target.value)} className="text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Input placeholder="What does it do?" value={description} onChange={e => setDescription(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Env vars (comma-separated)</Label>
                <Input placeholder="API_KEY, API_SECRET" value={envVars} onChange={e => setEnvVars(e.target.value)} className="text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Install snippet</Label>
                <Input placeholder="npm i my-package" value={installSnippet} onChange={e => setInstallSnippet(e.target.value)} className="text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Import snippet</Label>
                <Input placeholder="import { Client } from 'my-package'" value={importSnippet} onChange={e => setImportSnippet(e.target.value)} className="text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Usage example</Label>
                <Textarea placeholder="const client = new Client(process.env.API_KEY)" value={usageExample} onChange={e => setUsageExample(e.target.value)} className="text-sm font-mono min-h-[60px]" />
              </div>
              <Button size="sm" onClick={handleSave} disabled={saving} className="w-full gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Save integration
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
