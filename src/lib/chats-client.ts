// Browser-side helpers for saved AI Chat conversations (/api/chats).
import type { StoredChatMessage } from '@/lib/chat-history'

export interface ChatSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export class ChatsApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message?: string) {
    super(message || code)
    this.status = status
    this.code = code
  }
}

// The server answers 503 history_unavailable until the ai_chats table exists.
export const isHistoryUnavailable = (err: unknown): boolean =>
  err instanceof ChatsApiError && err.code === 'history_unavailable'

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : `request_failed_${res.status}`
    throw new ChatsApiError(res.status, code, typeof data.message === 'string' ? data.message : undefined)
  }
  return data as T
}

export const listChats = () => call<{ chats: ChatSummary[] }>('/api/chats').then((r) => r.chats)

export const loadChat = (id: string) =>
  call<{ chat: ChatSummary & { messages: StoredChatMessage[] } }>(`/api/chats/${encodeURIComponent(id)}`).then(
    (r) => r.chat,
  )

export const createChat = (messages: StoredChatMessage[]) =>
  call<{ chat: ChatSummary }>('/api/chats', { method: 'POST', body: JSON.stringify({ messages }) }).then(
    (r) => r.chat,
  )

export const saveChat = (id: string, messages: StoredChatMessage[]) =>
  call<{ chat: { id: string; title: string; updatedAt: string } }>(`/api/chats/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ messages }),
  }).then((r) => r.chat)

export const renameChat = (id: string, title: string) =>
  call<{ chat: { id: string; title: string; updatedAt: string } }>(`/api/chats/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  }).then((r) => r.chat)

export const deleteChat = (id: string) =>
  call<{ ok: true }>(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })
