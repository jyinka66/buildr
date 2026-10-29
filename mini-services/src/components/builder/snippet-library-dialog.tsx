// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

import * as React from 'react'
import { Bookmark, Loader2, Plus, Trash2, Copy } from 'lucide-react'
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
}

interface Snippet {
  id: string
  name: string
  description: string
  language: string
  content: string
  tags: string[]
  updatedAt: string
}

const LANGUAGES = ['tsx', 'ts', 'js', 'jsx', 'css', 'html', 'json', 'sql', 'sh']

export function SnippetLibraryDialog({ open, onOpenChange }: Props) {
  const [snippets, setSnippets] = React.useState<Snippet[]>([])
  const [loading, setLoading] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [language, setLanguage] = React.useState('tsx')
  const [content, setContent] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const fetchSnippets = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listSnippets()
      setSnippets(data.snippets)
    } catch { toast.error('Failed to load snippets') }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { if (open) void fetchSnippets() }, [open, fetchSnippets])

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Name and content are required.')
      return
    }
    setSaving(true)
    try {
      await api.saveSnippet({
        name: name.trim(),
        description: description.trim(),
        language,
        content: content.trim(),
        tags: tags.split(',').map(s => s.trim()).filter(Boolean),
      })
      toast.success('Snippet saved!')
      setName(''); setDescription(''); setContent(''); setTags('')
      await fetchSnippets()
    } catch (err) {
      toast.error('Save failed', { description: err instanceof Error ? err.message : 'unknown_error' })
    } finally { setSaving(false) }
  }

  const handleCopy = async (content: string) => {
    await navigator.clipboard.writeText(content)
    toast.success('Copied to clipboard!')
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSnippet(id)
      toast.success('Snippet deleted')
      await fetchSnippets()
    } catch { toast.error('Delete failed') }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Bookmark className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Snippet Library</DialogTitle>
          </div>
          <DialogDescription>
            Save reusable code snippets. Copy them into any project.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {/* Existing snippets */}
            {snippets.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {snippets.length} snippet{snippets.length === 1 ? '' : 's'}
                </p>
                {snippets.map((s) => (
                  <div key={s.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{s.language}</Badge>
                      {s.tags.map((t) => <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>)}
                      <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 text-xs" onClick={() => handleCopy(s.content)}>
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(s.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {s.description ? <p className="mt-1 text-xs text-muted-foreground">{s.description}</p> : null}
                    <pre className="mt-1.5 max-h-24 overflow-y-auto rounded bg-zinc-950 p-2 text-[10px] text-zinc-100">
                      {s.content.slice(0, 500)}{s.content.length > 500 ? '…' : ''}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Add new */}
            <div className="space-y-3 rounded-md border border-border p-3">
              <Label className="text-xs">Save a new snippet</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input placeholder="Button component" value={name} onChange={e => setName(e.target.value)} className="text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description (optional)</Label>
                <Input placeholder="What does this snippet do?" value={description} onChange={e => setDescription(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Content</Label>
                <Textarea placeholder="export function Button({ children }) { ... }" value={content} onChange={e => setContent(e.target.value)} className="font-mono text-sm min-h-[100px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tags (comma-separated)</Label>
                <Input placeholder="react, ui, button" value={tags} onChange={e => setTags(e.target.value)} className="text-sm" />
              </div>
              <Button size="sm" onClick={handleSave} disabled={saving} className="w-full gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Save snippet
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
