'use client'

// AI Chat — talk to Buildr AI with no project open.
// ------------------------------------------------------------------
// Ask anything, brainstorm, or plan an app before creating it. Replies stream
// live with the model's reasoning shown in a collapsible "Thinking" block.
// The conversation lives in this browser (localStorage, per user) and is sent
// with each request; nothing here touches project data or builds code.

import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import { AlertTriangle, Bot, Plus, Send, Sparkles, Square, User } from 'lucide-react'
import { streamChat } from '@/lib/chat-client'
import { useBuilder } from '@/lib/store'
import { ThinkingBlock } from '@/components/builder/thinking-block'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  thinkingMs?: number
}

const SUGGESTIONS = [
  'Help me plan a SaaS app for freelancers: features, pages and data',
  'What is the difference between server components and client components in Next.js?',
  'Review my idea: a marketplace for local tailors. What are the risks?',
  'Break down building a booking system into small steps',
]

const MAX_STORED_MESSAGES = 60

function storageKey(userKey: string): string {
  return `buildr:ai-chat:v1:${userKey}`
}

function loadMessages(userKey: string): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (m): m is ChatMessage =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && typeof m.id === 'string',
    )
  } catch {
    return []
  }
}

function saveMessages(userKey: string, messages: ChatMessage[]): void {
  try {
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    /* storage unavailable or full: the chat still works for this session */
  }
}

let idCounter = 0
const newId = () => `m-${Date.now()}-${idCounter++}`

export default function AiChatView() {
  const session = useBuilder((s) => s.session)
  const activeProviderKey = useBuilder((s) => s.activeProviderKey)
  const userKey = session?.user?.id || session?.user?.email || 'anonymous'

  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  // Which user's saved conversation is currently loaded into `messages`.
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null)
  const loaded = loadedFor === userKey
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  // Load this user's saved conversation (again if the signed-in user changes).
  if (!loaded) {
    setLoadedFor(userKey)
    setMessages(loadMessages(userKey))
  }

  // Save when a reply finishes (not on every streamed token).
  React.useEffect(() => {
    if (loaded && !streaming) saveMessages(userKey, messages)
  }, [messages, streaming, loaded, userKey])

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, streaming])

  // Stop any in-flight request when leaving the view.
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const patch = React.useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))
  }, [])

  const ask = React.useCallback(
    async (text: string, history: ChatMessage[]) => {
      const userMsg: ChatMessage = { id: newId(), role: 'user', content: text }
      const botMsg: ChatMessage = { id: newId(), role: 'assistant', content: '' }
      setMessages([...history, userMsg, botMsg])
      setError(null)
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller
      let failure: string | null = null
      try {
        await streamChat(
          '/api/chat/stream',
          {
            messages: [...history, userMsg].map((m) => ({ role: m.role, content: m.content })),
            providerKey: activeProviderKey,
          },
          {
            onThinking: (t) => patch(botMsg.id, (m) => ({ ...m, thinking: (m.thinking ?? '') + t })),
            onThinkingEnd: (ms) => patch(botMsg.id, (m) => ({ ...m, thinkingMs: ms })),
            onToken: (t) => patch(botMsg.id, (m) => ({ ...m, content: m.content + t })),
          },
          controller.signal,
        )
      } catch (err) {
        if (!controller.signal.aborted) failure = err instanceof Error ? err.message : 'chat_failed'
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }

      // Drop an empty reply bubble (error or stopped before any output).
      setMessages((prev) =>
        prev.filter((m) => !(m.id === botMsg.id && !m.content.trim() && !m.thinking)),
      )
      if (failure) setError(failure)
      setStreaming(false)
    },
    [activeProviderKey, patch],
  )

  const send = (value: string) => {
    const text = value.trim()
    if (!text || streaming) return
    setInput('')
    void ask(text, messages)
  }

  const retry = () => {
    // Re-ask the last user message (it is already in the history).
    const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf('user')
    if (lastUserIndex === -1) return
    const text = messages[lastUserIndex].content
    void ask(text, messages.slice(0, lastUserIndex))
  }

  const newChat = () => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    setStreaming(false)
    try {
      window.localStorage.removeItem(storageKey(userKey))
    } catch {
      /* ignore */
    }
  }

  const last = messages[messages.length - 1]

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col px-4">
      <div className="flex items-center gap-2 py-4">
        <Sparkles className="h-4 w-4 text-emerald-600" />
        <h1 className="text-sm font-semibold">AI Chat</h1>
        <span className="text-xs text-muted-foreground">Ask anything, plan, think it through</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-2.5 text-xs"
          onClick={newChat}
          disabled={messages.length === 0 && !streaming}
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-600/10 text-emerald-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-medium">What are you working on?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask a question, think through an idea, or plan an app before you build it.
              </p>
            </div>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user'
            const isLast = m.id === last?.id
            // Waiting: this reply is streaming and has produced no answer text yet.
            const thinkingNow = streaming && isLast && !isUser && !m.content
            return (
              <div key={m.id} className={cn('flex w-full gap-2', isUser ? 'justify-end' : 'justify-start')}>
                {!isUser ? (
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Bot className={cn('h-4 w-4', thinkingNow && 'animate-pulse')} />
                  </div>
                ) : null}
                <div className={cn('flex max-w-[88%] flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
                  {!isUser && m.thinking ? (
                    <div className="w-full rounded-lg bg-muted/60 px-3 py-2">
                      <ThinkingBlock text={m.thinking} active={thinkingNow} ms={m.thinkingMs} />
                    </div>
                  ) : null}
                  {thinkingNow && !m.thinking ? (
                    <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.2s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.1s]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" />
                        <span className="ml-1.5">thinking…</span>
                      </span>
                    </div>
                  ) : m.content ? (
                    <div
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm leading-relaxed',
                        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                      )}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none break-words [&>pre]:rounded-md [&>pre]:bg-zinc-950 [&>pre]:p-3 [&_code]:text-xs">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                          {streaming && isLast ? (
                            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-emerald-500 align-middle" />
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                {isUser ? (
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                ) : null}
              </div>
            )
          })
        )}

        {error ? (
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-xs">Something went wrong</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{error}</span>
              <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={retry}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background px-4 py-3">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder="Ask anything…  (Enter to send · Shift+Enter for newline)"
            disabled={streaming}
            rows={2}
            className="min-h-[2.75rem] resize-none pr-12 text-sm leading-relaxed"
          />
          {streaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="absolute right-1.5 bottom-1.5 h-7 w-7"
              onClick={() => abortRef.current?.abort()}
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
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          This chat is saved in this browser. To build an app, open or create a project.
        </p>
      </div>
    </div>
  )
}
