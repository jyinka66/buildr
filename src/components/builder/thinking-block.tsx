'use client'

// Collapsible "thinking" display shown above an assistant answer, in the same
// spirit as Claude: live reasoning text while the model thinks, then a quiet
// "Thought for 6s" line that can be expanded to read it.

import * as React from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export interface ThinkingBlockProps {
  text: string
  // True while the model is still thinking (answer has not started).
  active: boolean
  // How long it thought, once finished.
  ms?: number
}

function formatThought(ms?: number): string {
  if (!ms || ms < 1000) return 'Thought for a moment'
  const s = Math.round(ms / 1000)
  return s < 60 ? `Thought for ${s}s` : `Thought for ${Math.floor(s / 60)}m ${s % 60}s`
}

export function ThinkingBlock({ text, active, ms }: ThinkingBlockProps) {
  // Open while thinking, fold away once the answer starts. The reader can
  // still toggle it by hand; that choice resets whenever `active` flips.
  const [manual, setManual] = React.useState<boolean | null>(null)
  const [lastActive, setLastActive] = React.useState(active)
  if (lastActive !== active) {
    setLastActive(active)
    setManual(null)
  }
  const open = manual ?? active
  const bodyRef = React.useRef<HTMLDivElement>(null)

  // Keep the newest reasoning in view while it streams.
  React.useEffect(() => {
    if (active && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text, active])

  return (
    <Collapsible open={open} onOpenChange={setManual} className="w-full">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Brain className={cn('h-3.5 w-3.5', active && 'animate-pulse text-emerald-500')} />
        <span>{active ? 'Thinking…' : formatThought(ms)}</span>
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          ref={bodyRef}
          className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground"
        >
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
