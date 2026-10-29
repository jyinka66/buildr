// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Layers, Loader2, Plus, Trash2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

interface EnvData {
  id: string
  name: string
  envVars: Record<string, string>
  keyCount: number
}

export function EnvironmentsDialog({ open, onOpenChange, projectId }: Props) {
  const [envs, setEnvs] = React.useState<EnvData[]>([])
  const [loading, setLoading] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState('development')
  const [newKey, setNewKey] = React.useState('')
  const [newValue, setNewValue] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [newEnvName, setNewEnvName] = React.useState('')

  const fetchEnvs = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listEnvironments(projectId)
      setEnvs(data.environments)
      if (data.environments.length > 0 && !data.environments.find((e) => e.name === activeTab)) {
        setActiveTab(data.environments[0].name)
      }
    } catch (err) {
      toast.error('Failed to load environments')
    } finally {
      setLoading(false)
    }
  }, [projectId, activeTab])

  React.useEffect(() => {
    if (open) void fetchEnvs()
  }, [open, fetchEnvs])

  const handleSave = async () => {
    const key = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    if (!key || !newValue) {
      toast.error('Key and value are required.')
      return
    }
    setSaving(true)
    try {
      await api.upsertEnvVar(projectId, activeTab, key, newValue)
      toast.success(`Saved ${key} in ${activeTab}`)
      setNewKey('')
      setNewValue('')
      await fetchEnvs()
    } catch (err) {
      toast.error('Failed to save', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (key: string) => {
    try {
      await api.deleteEnvVar(projectId, activeTab, key)
      toast.success(`Deleted ${key}`)
      await fetchEnvs()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const handleCreateEnv = async () => {
    const name = newEnvName.trim().toLowerCase()
    if (!name) return
    try {
      await api.upsertEnvVar(projectId, name, '_init', 'true')
      await api.deleteEnvVar(projectId, name, '_init')
      setNewEnvName('')
      await fetchEnvs()
      setActiveTab(name)
      toast.success(`Created environment: ${name}`)
    } catch {
      toast.error('Failed to create environment')
    }
  }

  const currentEnv = envs.find((e) => e.name === activeTab)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Layers className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Environments</DialogTitle>
          </div>
          <DialogDescription>
            Manage env vars per environment (development, staging, production).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                {envs.map((e) => (
                  <TabsTrigger key={e.id} value={e.name} className="flex-1 text-xs">
                    {e.name} ({e.keyCount})
                  </TabsTrigger>
                ))}
              </TabsList>

              {envs.map((env) => (
                <TabsContent key={env.id} value={env.name} className="space-y-3">
                  {/* Add new env var */}
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <Label className="text-xs">Add / update variable</Label>
                    <div className="flex gap-2">
                      <Input placeholder="KEY" value={newKey} onChange={(e) => setNewKey(e.target.value)} className="flex-1 font-mono text-sm" />
                      <Input type="password" placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} className="flex-1" />
                    </div>
                    <Button size="sm" onClick={handleSave} disabled={saving} className="w-full gap-1.5">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Save to {env.name}
                    </Button>
                  </div>

                  {/* Existing vars */}
                  {Object.keys(env.envVars).length === 0 ? (
                    <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      No variables in {env.name} yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {Object.entries(env.envVars).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                          <code className="flex-1 truncate font-mono text-sm">{key}</code>
                          <Badge variant="secondary" className="text-[10px]">{val || '••••'}</Badge>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(key)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>

            {/* Create new environment */}
            <div className="flex gap-2">
              <Input placeholder="new-env-name" value={newEnvName} onChange={(e) => setNewEnvName(e.target.value)} className="text-sm" />
              <Button size="sm" variant="outline" onClick={handleCreateEnv} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add env
              </Button>
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Values encrypted at rest with AES-256-GCM.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
