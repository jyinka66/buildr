// GET  /api/chats — list the signed-in user's saved AI Chat conversations
// POST /api/chats — save a new conversation
//
// Conversations for the no-project AI Chat page. Every query is scoped to the
// session user. If the ai_chats table has not been created yet (migration
// pending) these routes answer 503 { error: 'history_unavailable' } and the
// client falls back to browser-only storage.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser, type SessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import {
  DEFAULT_CHAT_TITLE,
  MAX_CHATS_PER_USER,
  deriveTitle,
  isMissingTableError,
  sanitizeMessages,
  sanitizeTitle,
} from '@/lib/chat-history'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_LIMIT = 100

async function authenticate(): Promise<SessionUser | NextResponse> {
  try {
    return await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
}

function unavailable() {
  return NextResponse.json({ error: 'history_unavailable' }, { status: 503 })
}

export async function GET() {
  const user = await authenticate()
  if (user instanceof NextResponse) return user

  const { data, error } = await db
    .from('ai_chats')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    if (isMissingTableError(error)) return unavailable()
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }

  return NextResponse.json({
    chats: (data ?? []).map((c: { id: string; title: string; created_at: string; updated_at: string }) => ({
      id: c.id,
      title: c.title,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user

  const rl = rateLimit(`chats-write:${user.id}`, { limit: 60, windowMs: 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.resetMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
    )
  }

  let body: { title?: unknown; messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const messages = sanitizeMessages(body.messages ?? [])
  if (!messages) return NextResponse.json({ error: 'messages must be an array' }, { status: 400 })
  const customTitle = sanitizeTitle(body.title)

  const { count, error: countError } = await db
    .from('ai_chats')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (countError) {
    if (isMissingTableError(countError)) return unavailable()
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  if ((count ?? 0) >= MAX_CHATS_PER_USER) {
    return NextResponse.json(
      { error: 'chat_limit', message: `You can keep up to ${MAX_CHATS_PER_USER} saved chats. Delete some to save new ones.` },
      { status: 409 },
    )
  }

  const title = customTitle ?? (messages.length ? deriveTitle(messages) : DEFAULT_CHAT_TITLE)
  const { data, error } = await db
    .from('ai_chats')
    .insert({ user_id: user.id, title, title_auto: !customTitle, messages })
    .select('id, title, created_at, updated_at')
    .single()

  if (error || !data) {
    if (isMissingTableError(error)) return unavailable()
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  return NextResponse.json(
    {
      chat: { id: data.id, title: data.title, createdAt: data.created_at, updatedAt: data.updated_at },
    },
    { status: 201 },
  )
}
