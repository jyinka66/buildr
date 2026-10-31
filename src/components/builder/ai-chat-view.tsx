'use client'

// AI Chat — talk to Buildr AI with no project open.
// ------------------------------------------------------------------
// Ask anything, brainstorm, or plan an app before creating it. Replies stream
// live with the model's reasoning shown in a collapsible "Thinking" block.
//
// Conversations are saved to the user's account (/api/chats) and listed in a
// history panel. If saving to the account is not available (the ai_chats
// table has not been created yet, or the request fails), the chat keeps
// working and falls back to this browser's localStorage, as before.
// Nothing here touches project data or builds code.

import * as React from 'react'
import { Markdown, CopyButton, formatTranscript } from '@/components/builder/markdown'
import {
  AlertTriangle,
  Bot,
  History,
  Download,
  FolderKanban,
  FolderPlus,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  Wand2,
} from 'lucide-react'
import { streamChat } from '@/lib/chat-client'
import {
  createChat,
  deleteChat,
  listChats,
  loadChat,
  renameChat,
  saveChat,
  type ChatSummary,
} from '@/lib/chats-client'
import { buildProjectSeed, groupByRecency, type StoredChatMessage } from '@/lib/chat-history'
import { useBuilder } from '@/lib/store'
import { NewProjectDialog } from '@/components/builder/new-project-dialog'
import { ThinkingBlock } from '@/components/builder/thinking-block'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ProjectView } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ChatMessage = StoredChatMessage

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

function isChatMessage(m: unknown): m is ChatMessage {
  const x = m as Partial<ChatMessage> | null
  return !!x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && typeof x.id === 'string'
}

function loadLocalMessages(userKey: string): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isChatMessage) : []
  } catch {
    return []
  }
}

function saveLocalMessages(userKey: string, messages: ChatMessage[]): void {
  try {
    window.localStorage.setItem(storageKey(userKey), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    /* storage unavailable or full: the chat still works for this session */
  }
}

function clearLocalMessages(userKey: string): void {
  try {
    window.localStorage.removeItem(storageKey(userKey))
  } catch {
    /* ignore */
  }
}

let idCounter = 0
const newId = () => `m-${Date.now()}-${idCounter++}`

// 'checking' = asking the server; 'on' = saving to the account;
// 'off' = browser-only fallback.
type HistoryMode = 'checking' | 'on' | 'off'

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

  const [mode, setMode] = React.useState<HistoryMode>('checking')
  const [chats, setChats] = React.useState<ChatSummary[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [listOpen, setListOpen] = React.useState(false)
  const [opening, setOpening] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const [buildOpen, setBuildOpen] = React.useState(false)
  const [newProjectOpen, setNewProjectOpen] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  // True once this view changed the conversation, so loading a saved chat is
  // not written straight back.
  const dirtyRef = React.useRef(false)
  const activeIdRef = React.useRef<string | null>(null)
  const modeRef = React.useRef<HistoryMode>('checking')
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve())
  const pendingSavesRef = React.useRef(0)

  const busy = streaming || saving || opening

  const setActive = React.useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveId(id)
  }, [])

  const setHistoryMode = React.useCallback((m: HistoryMode) => {
    modeRef.current = m
    setMode(m)
  }, [])

  // Load this user's saved conversation (again if the signed-in user changes).
  if (!loaded) {
    setLoadedFor(userKey)
    setMessages(loadLocalMessages(userKey))
  }

  // Find out whether account history is available and load the list. A chat
  // left in this browser by an older version is moved into the account once.
  React.useEffect(() => {
    let cancelled = false
    setHistoryMode('checking')
    setChats([])
    setActive(null)

    void (async () => {
      let list: ChatSummary[]
      try {
        list = await listChats()
      } catch {
        if (!cancelled) setHistoryMode('off')
        return
      }
      if (cancelled) return
      setChats(list)
      setHistoryMode('on')

      const local = loadLocalMessages(userKey)
      if (local.length === 0) return
      try {
        const created = await createChat(local)
        clearLocalMessages(userKey)
        if (cancelled) return
        setChats((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
        // Show it as the open chat unless the user already started something.
        if (!dirtyRef.current && activeIdRef.current === null) setActive(created.id)
      } catch {
        /* keep the local copy; it is retried on the next visit */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [userKey, setActive, setHistoryMode])

  const persist = React.useCallback(
    (msgs: ChatMessage[]) => {
      if (msgs.length === 0) return
      if (modeRef.current !== 'on') {
        saveLocalMessages(userKey, msgs)
        return
      }
      pendingSavesRef.current += 1
      setSaving(true)
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const id = activeIdRef.current
          if (!id) {
            const created = await createChat(msgs)
            setActive(created.id)
            setChats((prev) => [created, ...prev.filter((c) => c.id !== created.id)])
          } else {
            const saved = await saveChat(id, msgs)
            setChats((prev) =>
              prev
                .map((c) => (c.id === id ? { ...c, title: saved.title, updatedAt: saved.updatedAt } : c))
                .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
            )
          }
          setSaveFailed(false)
        } catch {
          // Keep the conversation recoverable and tell the user.
          saveLocalMessages(userKey, msgs)
          setSaveFailed(true)
        } finally {
          pendingSavesRef.current -= 1
          if (pendingSavesRef.current === 0) setSaving(false)
        }
      })
    },
    [userKey, setActive],
  )

  // Save when a reply finishes (not on every streamed token).
  React.useEffect(() => {
    if (!loaded || streaming || !dirtyRef.current) return
    dirtyRef.current = false
    persist(messages)
  }, [messages, streaming, loaded, persist])

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
      dirtyRef.current = true
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
    if (!text || streaming || opening) return
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
    if (saving || opening) return
    abortRef.current?.abort()
    dirtyRef.current = false
    setMessages([])
    setError(null)
    setStreaming(false)
    setActive(null)
    setListOpen(false)
    if (modeRef.current !== 'on') clearLocalMessages(userKey)
  }

  const openChat = async (id: string) => {
    if (busy || id === activeIdRef.current) {
      setListOpen(false)
      return
    }
    setOpening(true)
    setError(null)
    try {
      const chat = await loadChat(id)
      dirtyRef.current = false
      setMessages(chat.messages.filter(isChatMessage))
      setActive(chat.id)
      setListOpen(false)
    } catch (err) {
      setError(err instanceof Error && err.message ? `Could not open that chat (${err.message})` : 'Could not open that chat')
    } finally {
      setOpening(false)
    }
  }

  const removeChat = async (chat: ChatSummary) => {
    if (busy) return
    if (!window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return
    try {
      await deleteChat(chat.id)
      setChats((prev) => prev.filter((c) => c.id !== chat.id))
      if (activeIdRef.current === chat.id) {
        dirtyRef.current = false
        setMessages([])
        setActive(null)
      }
    } catch {
      setError('Could not delete that chat. Please try again.')
    }
  }

  const rename = async (chat: ChatSummary) => {
    if (busy) return
    const next = window.prompt('Rename chat', chat.title)?.trim()
    if (!next || next === chat.title) return
    try {
      const saved = await renameChat(chat.id, next)
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, title: saved.title } : c)))
    } catch {
      setError('Could not rename that chat. Please try again.')
    }
  }

  const last = messages[messages.length - 1]
  const showHistory = mode === 'on'
  // The sidebar (new chat, projects, recents) is always there for a signed-in user.
  const showSidebar = !!session
  // Offer to turn the plan into a project once there is an answer to build from.
  const canBuild = !!session && !streaming && messages.some((m) => m.role === 'assistant' && m.content.trim())
  const buildSeed = React.useMemo(() => (buildOpen ? buildProjectSeed(messages) : { name: '', prompt: '' }), [buildOpen, messages])

  const projects = useBuilder((s) => s.projects)
  const openBuilder = useBuilder((s) => s.openBuilder)
  const deleteProject = useBuilder((s) => s.deleteProject)
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectView | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProject(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setError('Could not delete that project. Please try again.')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }
  // Other parts of the app (command palette) can ask for the New project dialog.
  React.useEffect(() => {
    const open = () => setNewProjectOpen(true)
    window.addEventListener('buildr:new-project', open)
    return () => window.removeEventListener('buildr:new-project', open)
  }, [])
  const chatGroups = React.useMemo(() => groupByRecency(chats), [chats])

  const historyList = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-1.5 p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-full justify-start gap-2 text-sm"
          onClick={newChat}
          disabled={(messages.length === 0 && !streaming) || saving || opening}
        >
          <Plus className="h-4 w-4" /> New chat
        </Button>
        {session ? (
          <Button
            type="button"
            size="sm"
            className="h-9 w-full justify-start gap-2 text-sm"
            onClick={() => {
              setListOpen(false)
              setNewProjectOpen(true)
            }}
          >
            <FolderPlus className="h-4 w-4" /> New project
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {projects.length > 0 ? (
          <section className="mb-4">
            <h2 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Projects <span className="font-normal normal-case">({projects.length})</span>
            </h2>
            <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              {projects.map((p) => (
                <li key={p.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => void openBuilder(p.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 pr-14 text-left text-xs transition-colors hover:bg-muted"
                    title={p.name}
                  >
                    <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{p.name}</span>
                    {p.status === 'deployed' ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Deployed" />
                    ) : null}
                  </button>
                  <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => window.open(`/api/export/${p.id}`, '_blank', 'noopener,noreferrer')}
                      aria-label={`Export ${p.name}`}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(p)}
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <h2 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recents</h2>
        {chats.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {mode === 'on' ? 'Your saved conversations will show up here.' : 'This chat is saved in this browser.'}
          </p>
        ) : (
          chatGroups.map((group) => (
            <section key={group.label} className="mb-3">
              <h3 className="px-2 pb-0.5 pt-1 text-[11px] text-muted-foreground">{group.label}</h3>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => void openChat(c.id)}
                      disabled={busy}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 pr-16 text-left text-xs transition-colors hover:bg-muted disabled:opacity-60',
                        c.id === activeId && 'bg-muted font-medium',
                      )}
                      title={c.title}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{c.title}</span>
                    </button>
                    <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => void rename(c)} disabled={busy} aria-label={`Rename ${c.title}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => void removeChat(c)} disabled={busy} aria-label={`Delete ${c.title}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] w-full">
      {showSidebar ? (
        <aside className="hidden w-64 shrink-0 border-r border-border md:block">
          <div className="sticky top-0 h-[calc(100dvh-3.5rem)]">{historyList}</div>
        </aside>
      ) : null}

      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col px-4">
        <div className="flex items-center gap-2 py-4">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <h1 className="text-sm font-semibold">AI Chat</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">Ask anything, plan, think it through</span>
          <div className="ml-auto flex items-center gap-1">
            {messages.some((m) => m.content) ? (
              <CopyButton text={formatTranscript(messages)} label="Copy conversation" iconOnly={false} className="h-8 px-2.5 text-xs" />
            ) : null}
            {showSidebar ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs md:hidden"
                onClick={() => setListOpen((v) => !v)}
                aria-expanded={listOpen}
              >
                <History className="h-3.5 w-3.5" /> Menu
              </Button>
            ) : null}
            {canBuild ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setBuildOpen(true)}
                disabled={busy}
              >
                <Wand2 className="h-3.5 w-3.5" /> Build this app
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs"
              onClick={newChat}
              disabled={(messages.length === 0 && !streaming) || saving || opening}
            >
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
          </div>
        </div>

        {showSidebar && listOpen ? (
          <div className="mb-3 h-64 overflow-hidden rounded-lg border border-border md:hidden">{historyList}</div>
        ) : null}

        <div className="flex flex-1 flex-col gap-4 pb-4">
          {opening ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Opening chat…</p>
          ) : messages.length === 0 ? (
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
                          <div>
                            <Markdown>{m.content}</Markdown>
                            {streaming && isLast ? (
                              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-emerald-500 align-middle" />
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {m.content && !(streaming && isLast) ? (
                      <CopyButton text={m.content} label="Copy message" iconOnly={false} className="-ml-1.5 self-start" />
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
                {messages.some((m) => m.role === 'user') ? (
                  <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={retry}>
                    Retry
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {saveFailed ? (
            <Alert className="py-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                This chat could not be saved to your account just now. It is kept in this browser and will save again after
                your next message.
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
              disabled={streaming || opening}
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
                disabled={!input.trim() || streaming || opening}
                aria-label="Send message"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            {mode === 'on'
              ? 'Chats are saved to your account. To build an app, open or create a project.'
              : 'This chat is saved in this browser. To build an app, open or create a project.'}
          </p>
        </div>
      </div>
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `“${deleteTarget.name}” and all its files will be permanently deleted. This cannot be undone.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void confirmDelete() }} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NewProjectDialog
        open={buildOpen}
        onOpenChange={setBuildOpen}
        initialName={buildSeed.name}
        initialPrompt={buildSeed.prompt}
      />
    </div>
  )
}
