'use client'

// Left conversation panel. Renders the chat history (user messages right,
// assistant messages left with markdown + file-op badges + provider meta),
// an inline error alert with retry hint, an empty-state with example
// prompts, and a sticky composer (textarea + send button) at the bottom.
// Enter sends, Shift+Enter inserts a newline. All state is read from the
// builder store; `onSend` is provided by the parent.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Bot,
  Clock,
  FileCode,
  FilePlus,
  FilePen,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  Zap,
} from 'lucide-react'
import { useBuilder, type ChatMode } from '@/lib/store'
import { Markdown, CopyButton, formatTranscript } from '@/components/builder/markdown'
import { ThinkingBlock } from '@/components/builder/thinking-block'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { FileOp, GenerationView, ProviderConfig } from '@/lib/types'
import { cn } from '@/lib/utils'

type ProviderWithKey = ProviderConfig & { hasKey: boolean }

const EXAMPLE_PROMPTS = [
  'Explain how this project is structured',
  'What should I add next to make this app better?',
  'Add a login page with email + password',
  'Create a products list with search and filter',
]

const CHAT_MODES: { value: ChatMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Buildr AI decides: it chats, or builds when you ask for changes' },
  { value: 'chat', label: 'Chat', hint: 'Only talk: ask questions and plan. Nothing is changed in your app' },
  { value: 'build', label: 'Build', hint: 'Always build: every message changes your app' },
]

function FileOpBadge({ op }: { op: FileOp }) {
  const isCreate = op.action === 'create'
  const isUpdate = op.action === 'update'
  const isDelete = op.action === 'delete'
  const label = isCreate ? 'created' : isUpdate ? 'updated' : isDelete ? 'deleted' : 'touched'
  const Icon = isCreate ? FilePlus : isUpdate ? FilePen : isDelete ? Trash2 : FileCode
  return (
    <Badge
      key={`${op.action}-${op.path}`}
      variant="secondary"
      className="gap-1 font-normal text-muted-foreground"
    >
      <Icon className="h-3 w-3" />
      <span className="truncate font-mono text-[11px]">{label} {op.path}</span>
    </Badge>
  )
}

function MessageBubble({ msg, providers, streaming, streamingActive, isAdmin }: { msg: GenerationView; providers: ProviderWithKey[]; streaming?: boolean; streamingActive?: boolean; isAdmin?: boolean }) {
  const isUser = msg.role === 'user'
  const isAssistant = msg.role === 'assistant'
  const provider = msg.providerId
    ? providers.find((p) => p.id === msg.providerId)
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn('flex w-full gap-2', isUser ? 'justify-end' : 'justify-start')}
    >
      {isAssistant ? (
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Bot className={cn('h-4 w-4', streaming && 'animate-pulse')} />
        </div>
      ) : null}
      <div className={cn('flex max-w-[85%] flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
        {isAssistant && msg.thinking ? (
          <div className="w-full rounded-lg bg-muted/60 px-3 py-2">
            <ThinkingBlock
              text={msg.thinking}
              active={!!streaming}
              ms={msg.thinkingMs}
            />
          </div>
        ) : null}

        {streaming && !msg.thinking ? (
          // "thinking…" indicator while the first token hasn't arrived yet.
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.2s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.1s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" />
              <span className="ml-1.5">thinking…</span>
            </span>
          </div>
        ) : streaming ? null : (
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-sm leading-relaxed',
              isUser
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground',
            )}
          >
            {isAssistant ? (
              <div>
                <Markdown>{msg.content || ''}</Markdown>
                {streamingActive ? (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-emerald-500 align-middle" />
                ) : null}
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
            )}
          </div>
        )}

        {isAssistant && !streaming && msg.fileOps.length > 0 ? (
          <div className="flex flex-wrap gap-1 pl-0.5">
            {msg.fileOps.map((op) => (
              <FileOpBadge key={`${op.action}-${op.path}`} op={op} />
            ))}
          </div>
        ) : null}

        {!streaming && msg.content ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-0.5 text-[11px] text-muted-foreground">
            <CopyButton text={msg.content} label="Copy message" iconOnly={false} className="-ml-1.5" />
            {isAssistant && isAdmin && provider ? <span>{provider.name}</span> : null}
            {isAssistant && isAdmin && msg.tokens > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <Zap className="h-3 w-3" /> {msg.tokens} tok
              </span>
            ) : null}
            {isAssistant && isAdmin && msg.durationMs > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <Clock className="h-3 w-3" /> {(msg.durationMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {isUser ? (
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </motion.div>
  )
}

export interface ChatPanelProps {
  onSend: (msg: string) => void
}

export function ChatPanel({ onSend }: ChatPanelProps) {
  const generations = useBuilder((s) => s.generations)
  const generating = useBuilder((s) => s.generating)
  const generatingError = useBuilder((s) => s.generatingError)
  const providers = useBuilder((s) => s.providers)
  const converse = useBuilder((s) => s.converse)
  const chatMode = useBuilder((s) => s.chatMode)
  const setChatMode = useBuilder((s) => s.setChatMode)
  const chatStreaming = useBuilder((s) => s.chatStreaming)
  const stopChat = useBuilder((s) => s.stopChat)
  const isAdmin = useBuilder((s) => !!s.session?.user.isAdmin)

  const [input, setInput] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when generations or generating changes.
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [generations, generating])

  const send = React.useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed || generating) return
      onSend(trimmed)
      setInput('')
    },
    [generating, onSend],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const retry = () => {
    const lastUser = [...generations].reverse().find((g) => g.role === 'user')
    if (lastUser) void converse(lastUser.content)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-medium">Chat</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {generations.some((g) => g.content) ? (
            <CopyButton
              text={formatTranscript(generations)}
              label="Copy conversation"
              iconOnly={false}
              className="gap-1"
            />
          ) : null}
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="flex flex-col gap-3 p-4">
          {generations.length === 0 && !generating ? (
            <EmptyState onPick={(p) => send(p)} />
          ) : (
            <AnimatePresence initial={false}>
              {generations.map((g) => (
                <MessageBubble
                  key={g.id}
                  msg={g}
                  providers={providers}
                  isAdmin={isAdmin}
                  streaming={generating && g.content.length === 0 && g.role === 'assistant' && g.id === generations[generations.length - 1]?.id}
                  streamingActive={generating && g.role === 'assistant' && g.content.length > 0 && g.id === generations[generations.length - 1]?.id}
                />
              ))}
              {generating && generations[generations.length - 1]?.role !== 'assistant' ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Bot className="h-4 w-4 animate-pulse" />
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.2s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.1s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" />
                    <span className="ml-1">thinking…</span>
                  </span>
                </motion.div>
              ) : null}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Error */}
      {generatingError ? (
        <div className="border-t border-border px-3 pt-2">
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-xs">Something went wrong</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{generatingError}</span>
              <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={retry}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {/* Composer */}
      <div className="sticky bottom-0 border-t border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-1" role="radiogroup" aria-label="Chat mode">
          {CHAT_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={chatMode === m.value}
              title={m.hint}
              disabled={generating}
              onClick={() => setChatMode(m.value)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors disabled:opacity-50',
                chatMode === m.value
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              chatMode === 'build'
                ? 'Describe a feature or change…  (Enter to send · Shift+Enter for newline)'
                : 'Ask anything, plan, or describe what to build…  (Enter to send)'
            }
            disabled={generating}
            rows={2}
            className="min-h-[2.75rem] resize-none pr-12 text-sm leading-relaxed"
          />
          {chatStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="absolute right-1.5 bottom-1.5 h-7 w-7"
              onClick={stopChat}
              aria-label="Stop generating"
            >
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="absolute right-1.5 bottom-1.5 h-7 w-7"
              onClick={() => send(input)}
              disabled={generating || !input.trim()}
              aria-label="Send message"
            >
              {generating ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex h-full flex-col items-center justify-center gap-3 px-2 py-8 text-center"
    >
      <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
        <Sparkles className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium">Chat with Buildr AI</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Ask questions, plan your app, or describe what to build and Buildr will generate the code.
        </p>
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-1.5">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-foreground"
          >
            {p}
          </button>
        ))}
      </div>
    </motion.div>
  )
}
