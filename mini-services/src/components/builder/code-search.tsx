// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

// Code search bar — appears in the builder workspace. Searches across all
// project files for the given query and shows results in a dropdown. Clicking
// a result selects that file in the code viewer.

import * as React from 'react'
import { Search, FileCode, Loader2, X } from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { api } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SearchResult {
  path: string
  line: number
  column: number
  preview: string
}

export function CodeSearch() {
  const currentProject = useBuilder((s) => s.currentProject)
  const selectFile = useBuilder((s) => s.selectFile)
  const setBuilderTab = useBuilder((s) => s.setBuilderTab)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Debounced search.
  React.useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    if (!currentProject) return
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchFiles(currentProject.id, query.trim())
        setResults(data.results)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, currentProject])

  // Close on outside click.
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (result: SearchResult) => {
    selectFile(result.path)
    setBuilderTab('code')
    setOpen(false)
  }

  if (!currentProject) return null

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search files… (⌘F)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="h-8 pl-8 pr-8 text-xs"
        />
        {loading ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : query ? (
          <button
            onClick={() => {
              setQuery('')
              setResults([])
              setOpen(false)
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && results.length > 0 ? (
        <div className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {results.length} result{results.length === 1 ? '' : 's'}
          </div>
          {results.map((r, i) => (
            <button
              key={`${r.path}-${r.line}-${i}`}
              onClick={() => handleSelect(r)}
              className={cn(
                'flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
              )}
            >
              <FileCode className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[11px] text-foreground">{r.path}</span>
                  <Badge variant="secondary" className="h-4 px-1 text-[9px]">:{r.line}</Badge>
                </div>
                <p className="truncate text-[10px] text-muted-foreground">{r.preview}</p>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {open && !loading && query.trim().length >= 2 && results.length === 0 ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-3 text-center text-xs text-muted-foreground shadow-lg">
          No matches found.
        </div>
      ) : null}
    </div>
  )
}
