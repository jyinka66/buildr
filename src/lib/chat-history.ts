// Validation helpers for saved AI Chat conversations (/api/chats).
// Pure functions with no imports so they can be unit-tested directly.

export interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  thinkingMs?: number
}

export const DEFAULT_CHAT_TITLE = 'New chat'
export const MAX_CHATS_PER_USER = 200
export const MAX_MESSAGES = 200
export const MAX_CONTENT_CHARS = 20_000
export const MAX_THINKING_CHARS = 30_000
export const MAX_TITLE_CHARS = 80

// Returns null when `input` is not an array. Invalid entries are dropped, text
// is length-capped, and only the most recent MAX_MESSAGES are kept.
export function sanitizeMessages(input: unknown): StoredChatMessage[] | null {
  if (!Array.isArray(input)) return null
  const out: StoredChatMessage[] = []
  for (let i = 0; i < input.length; i++) {
    const m = input[i] as Record<string, unknown> | null
    if (!m || typeof m !== 'object') continue
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (typeof m.content !== 'string') continue
    const content = m.content.slice(0, MAX_CONTENT_CHARS)
    const thinking =
      typeof m.thinking === 'string' && m.thinking.trim() ? m.thinking.slice(0, MAX_THINKING_CHARS) : undefined
    // An assistant bubble with neither answer nor reasoning carries nothing.
    if (!content.trim() && !(m.role === 'assistant' && thinking)) continue
    const id = typeof m.id === 'string' && m.id && m.id.length <= 64 ? m.id : `m-${i}`
    const msg: StoredChatMessage = { id, role: m.role, content }
    if (thinking) msg.thinking = thinking
    if (typeof m.thinkingMs === 'number' && Number.isFinite(m.thinkingMs) && m.thinkingMs >= 0) {
      msg.thinkingMs = Math.round(m.thinkingMs)
    }
    out.push(msg)
  }
  return out.slice(-MAX_MESSAGES)
}

// A user-supplied title: whitespace collapsed, length-capped, null if empty.
export function sanitizeTitle(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const t = input.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS)
  return t || null
}

// Auto title: the first thing the user asked.
export function deriveTitle(messages: StoredChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return DEFAULT_CHAT_TITLE
  const flat = first.content.replace(/\s+/g, ' ').trim()
  if (!flat) return DEFAULT_CHAT_TITLE
  return flat.length > 60 ? `${flat.slice(0, 57).trimEnd()}...` : flat
}

// True when a Supabase/PostgREST error means the ai_chats table has not been
// created yet (the migration has not been applied).
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('does not exist') || msg.includes('could not find the table')
}

// Seed for the New project dialog from a conversation planned in AI Chat: a
// short name and a prompt that carries the agreed plan. The most recent
// messages are kept when the conversation is long; reasoning text is left out.
export const PROJECT_PROMPT_MAX_CHARS = 6_000
const PROJECT_MESSAGE_MAX_CHARS = 2_500
const PROJECT_NAME_MAX_CHARS = 40
const PROJECT_PROMPT_HEADER =
  'Build the app we planned in this conversation. Follow the requirements and decisions agreed below.\n\nConversation:\n'

export function buildProjectSeed(messages: StoredChatMessage[]): { name: string; prompt: string } {
  const usable = messages.filter((m) => m.content.trim())
  const firstUser = usable.find((m) => m.role === 'user')
  const flat = firstUser ? firstUser.content.replace(/\s+/g, ' ').trim() : ''
  const name = flat
    ? flat.length > PROJECT_NAME_MAX_CHARS
      ? `${flat.slice(0, PROJECT_NAME_MAX_CHARS - 3).trimEnd()}...`
      : flat
    : 'My app'

  const budget = PROJECT_PROMPT_MAX_CHARS - PROJECT_PROMPT_HEADER.length
  const parts: string[] = []
  let used = 0
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i]
    const text = m.content.trim().slice(0, PROJECT_MESSAGE_MAX_CHARS)
    const part = `${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`
    if (used + part.length + 2 > budget) break
    parts.unshift(part)
    used += part.length + 2
  }
  return { name, prompt: parts.length ? PROJECT_PROMPT_HEADER + parts.join('\n\n') : '' }
}

// Group chats like a chat app sidebar: Today, Yesterday, Previous 7 days, Older.
// Input order is kept inside each group (the API already sorts newest first).
export function groupByRecency<T extends { updatedAt: string }>(
  items: T[],
  now: number = Date.now(),
): { label: string; items: T[] }[] {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const day = 24 * 60 * 60 * 1000
  const today = startOfToday.getTime()
  const buckets: { label: string; items: T[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const item of items) {
    const t = new Date(item.updatedAt).getTime()
    const i = !Number.isFinite(t) || t < today - 6 * day ? 3 : t >= today ? 0 : t >= today - day ? 1 : 2
    buckets[i].items.push(item)
  }
  return buckets.filter((b) => b.items.length > 0)
}
