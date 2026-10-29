'use client'

// Code viewer / editor for the selected file. Defaults to a read view rendered
// with react-syntax-highlighter (Prism, oneDark). An "Edit" button switches to
// a textarea editor with a line-number gutter and Tab=2 indentation. Saving
// calls `saveFile` and returns to read view. The code surface is dark
// (bg-zinc-950) regardless of the surrounding theme — code editors look best
// dark. A Copy button copies the current content and toasts on success.

import * as React from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy, FileCode, Pencil, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// Map our internal language strings to prism language ids. Defaults to
// "tsx"/"typescript" so unknowns still highlight reasonably.
function prismLanguage(language: string | undefined): string {
  const lang = (language || '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'markup',
    xml: 'markup',
    md: 'markdown',
    markdown: 'markdown',
    sh: 'bash',
    bash: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    prisma: 'graphql',
    graphql: 'graphql',
    dockerfile: 'docker',
    py: 'python',
    go: 'go',
    rust: 'rust',
  }
  return map[lang] || 'tsx'
}

function lineNumbers(content: string): number[] {
  const n = content.split('\n').length
  return Array.from({ length: n }, (_, i) => i + 1)
}

export function CodeViewer() {
  const selectedFilePath = useBuilder((s) => s.selectedFilePath)
  const files = useBuilder((s) => s.files)
  const saveFile = useBuilder((s) => s.saveFile)

  const file = React.useMemo(
    () => files.find((f) => f.path === selectedFilePath) ?? null,
    [files, selectedFilePath],
  )

  const [mode, setMode] = React.useState<'read' | 'edit'>('read')
  const [draft, setDraft] = React.useState<string>('')

  // Reset to read view and clear draft whenever the selected file changes.
  React.useEffect(() => {
    setMode('read')
    setDraft(file?.content ?? '')
  }, [file?.path, file?.content])

  if (!file) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <FileCode className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Select a file from the explorer.</p>
      </div>
    )
  }

  const language = file.language || 'tsx'
  const content = mode === 'edit' ? draft : file.content
  const dirty = mode === 'edit' && draft !== file.content

  const startEdit = () => {
    setDraft(file.content)
    setMode('edit')
  }

  const handleSave = async () => {
    if (!dirty) {
      setMode('read')
      return
    }
    try {
      await saveFile(file.path, draft, file.language)
      toast.success('File saved', { description: file.path })
      setMode('read')
    } catch (err) {
      toast.error('Save failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('Copied to clipboard', { description: file.path })
    } catch {
      toast.error('Copy failed')
    }
  }

  const lines = lineNumbers(content)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-muted-foreground">{file.path}</span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] uppercase">
          {language}
        </Badge>
        {file.generated ? (
          <Badge variant="outline" className="h-5 gap-0.5 px-1.5 text-[10px] text-emerald-600">
            generated
          </Badge>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          {mode === 'edit' ? (
            <>
              <Button
                size="sm"
                variant={dirty ? 'default' : 'secondary'}
                className="h-7 gap-1 px-2 text-xs"
                onClick={handleSave}
              >
                {dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                {dirty ? 'Save' : 'Saved'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setDraft(file.content)
                  setMode('read')
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                <Check className="h-3 w-3 text-emerald-600" /> Saved
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={startEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleCopy}
            aria-label="Copy contents"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copy</span>
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 bg-zinc-950 text-zinc-100">
        {mode === 'read' ? (
          <ScrollArea className="h-full">
            <SyntaxHighlighter
              language={prismLanguage(language)}
              style={oneDark}
              showLineNumbers
              wrapLongLines={false}
              customStyle={{
                margin: 0,
                padding: '0.875rem 1rem',
                background: 'transparent',
                fontSize: '0.8125rem',
                lineHeight: '1.5rem',
                fontFamily: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
                minHeight: '100%',
              }}
              lineNumberStyle={{
                color: 'rgba(255,255,255,0.25)',
                paddingRight: '1rem',
                minWidth: '2.5rem',
                userSelect: 'none',
              }}
              codeTagProps={{
                style: {
                  fontFamily: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
                },
              }}
            >
              {content}
            </SyntaxHighlighter>
          </ScrollArea>
        ) : (
          <div className="flex h-full overflow-auto">
            <pre
              aria-hidden
              className="select-none border-r border-white/5 px-3 py-3.5 text-right font-mono text-[0.8125rem] leading-[1.5rem] text-white/25"
            >
              {lines.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </pre>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Tab inserts two spaces (and preserves selection).
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const el = e.currentTarget
                  const start = el.selectionStart
                  const end = el.selectionEnd
                  const next = draft.slice(0, start) + '  ' + draft.slice(end)
                  setDraft(next)
                  requestAnimationFrame(() => {
                    el.selectionStart = el.selectionEnd = start + 2
                  })
                }
              }}
              spellCheck={false}
              className={cn(
                'min-h-full w-full flex-1 resize-none bg-transparent px-4 py-3.5 font-mono text-[0.8125rem] leading-[1.5rem] text-zinc-100 outline-none',
                'placeholder:text-zinc-500',
              )}
              style={{ tabSize: 2 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
