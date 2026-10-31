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
