'use client'

// Shared markdown renderer for every chat surface. Explicit styling (no
// typography plugin) so headings, lists, tables and code always look
// structured, and every code block has a language label and a copy button.

import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export async function copyText(text: string, label = 'Copied'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label)
    return true
  } catch {
    toast.error('Copy failed. Select the text and copy it by hand.')
    return false
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  className,
  iconOnly = true,
}: {
  text: string
  label?: string
  className?: string
  iconOnly?: boolean
}) {
  const [done, setDone] = React.useState(false)
  React.useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text, 'Copied')) setDone(true)
      }}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground',
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {iconOnly ? null : <span>{done ? 'Copied' : label}</span>}
    </button>
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1 text-[11px] text-zinc-400">
        <span className="font-mono">{language || 'code'}</span>
        <CopyButton text={code} label="Copy code" iconOnly={false} className="text-zinc-400 hover:bg-white/10 hover:text-zinc-100" />
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        PreTag="div"
        customStyle={{ margin: 0, padding: '0.75rem', background: 'transparent', fontSize: '12px' }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-1 mt-3 text-sm font-medium first:mt-0">{children}</h5>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline underline-offset-2 dark:text-emerald-400">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-background/50 px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children ?? '')
    const match = /language-([\w-]+)/.exec(className ?? '')
    // Fenced blocks carry a language class or span several lines; the rest is inline code.
    if (match || text.includes('\n')) {
      return <CodeBlock language={match?.[1] ?? ''} code={text.replace(/\n$/, '')} />
    }
    return <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  },
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('min-w-0 break-words text-sm leading-relaxed', className)}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  )
}

// Plain-text transcript of a conversation, for "copy whole conversation".
export function formatTranscript(
  messages: { role: string; content: string }[],
  labels: { user: string; assistant: string } = { user: 'You', assistant: 'Buildr AI' },
): string {
  return messages
    .filter((m) => m.content?.trim())
    .map((m) => `${m.role === 'user' ? labels.user : labels.assistant}:\n${m.content.trim()}`)
    .join('\n\n---\n\n')
}
