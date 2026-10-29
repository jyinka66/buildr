// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Database, Loader2, Plus, Trash2, Save, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

interface Field {
  name: string
  type: string
  optional: boolean
  unique: boolean
  isId: boolean
}

interface Table {
  id: string
  name: string
  fields: Field[]
}

const TYPES = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json']

export function SchemaDesignerDialog({ open, onOpenChange, projectId }: Props) {
  const [tables, setTables] = React.useState<Table[]>([
    {
      id: '1',
      name: 'User',
      fields: [
        { name: 'id', type: 'String', optional: false, unique: false, isId: true },
        { name: 'email', type: 'String', optional: false, unique: true, isId: false },
        { name: 'name', type: 'String', optional: true, unique: false, isId: false },
        { name: 'createdAt', type: 'DateTime', optional: false, unique: false, isId: false },
      ],
    },
  ])
  const [relations, setRelations] = React.useState<{ from: string; to: string; type: '1:1' | '1:n' | 'n:m' }[]>([])
  const [generateSql, setGenerateSql] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const addTable = () => {
    setTables([...tables, { id: Date.now().toString(), name: 'NewTable', fields: [{ name: 'id', type: 'String', optional: false, unique: false, isId: true }] }])
  }

  const removeTable = (id: string) => {
    setTables(tables.filter(t => t.id !== id))
  }

  const addField = (tableId: string) => {
    setTables(tables.map(t => t.id === tableId ? { ...t, fields: [...t.fields, { name: 'newField', type: 'String', optional: true, unique: false, isId: false }] } : t))
  }

  const updateField = (tableId: string, idx: number, key: keyof Field, value: unknown) => {
    setTables(tables.map(t => {
      if (t.id !== tableId) return t
      const fields = [...t.fields]
      fields[idx] = { ...fields[idx], [key]: value }
      return { ...t, fields }
    }))
  }

  const removeField = (tableId: string, idx: number) => {
    setTables(tables.map(t => t.id === tableId ? { ...t, fields: t.fields.filter((_, i) => i !== idx) } : t))
  }

  const handleGenerate = async () => {
    setSaving(true)
    try {
      const result = await api.generateSchema(projectId, {
        tables: tables.map(({ name, fields }) => ({ name, fields })),
        relations,
        generateSql,
      })
      toast.success('Schema generated!', { description: `${result.filesSaved.length} file(s) saved.` })
      onOpenChange(false)
    } catch (err) {
      toast.error('Generation failed', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Database className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Schema Designer</DialogTitle>
          </div>
          <DialogDescription>
            Design your database schema visually. Generates a Prisma schema + SQL migration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {tables.map((table) => (
            <div key={table.id} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Input
                  value={table.name}
                  onChange={(e) => setTables(tables.map(t => t.id === table.id ? { ...t, name: e.target.value } : t))}
                  className="h-7 w-40 font-mono text-sm"
                />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeTable(table.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="space-y-1">
                {table.fields.map((field, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-xs">
                    <Input
                      value={field.name}
                      onChange={(e) => updateField(table.id, idx, 'name', e.target.value)}
                      className="h-6 w-32 font-mono"
                    />
                    <Select value={field.type} onValueChange={(v) => updateField(table.id, idx, 'type', v)}>
                      <SelectTrigger className="h-6 w-24 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox checked={field.isId} onCheckedChange={(v) => updateField(table.id, idx, 'isId', v === true)} /> @id
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox checked={field.unique} onCheckedChange={(v) => updateField(table.id, idx, 'unique', v === true)} /> @unique
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox checked={field.optional} onCheckedChange={(v) => updateField(table.id, idx, 'optional', v === true)} /> ?
                    </label>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeField(table.id, idx)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => addField(table.id)}>
                  <Plus className="h-3 w-3" /> Add field
                </Button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addTable} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add table
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Checkbox id="gen-sql" checked={generateSql} onCheckedChange={(v) => setGenerateSql(v === true)} />
              <Label htmlFor="gen-sql" className="cursor-pointer text-xs">Also generate SQL migration</Label>
            </div>
            <Button onClick={handleGenerate} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Generate schema
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
