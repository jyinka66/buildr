// GET    /api/chats/[id] — one saved conversation with its messages
// PUT    /api/chats/[id] — save new messages and/or rename it
// DELETE /api/chats/[id] — delete it
//
// Every query matches on both the id and the session user, so another user's
// conversation is indistinguishable from one that does not exist (404).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser, type SessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import { deriveTitle, isMissingTableError, sanitizeMessages, sanitizeTitle } from '@/lib/chat-history'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

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

function failure(error: { code?: string; message?: string } | null, fallback: string) {
  if (isMissingTableError(error)) return NextResponse.json({ error: 'history_unavailable' }, { status: 503 })
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params

  const { data, error } = await db
    .from('ai_chats')
    .select('id, title, messages, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return failure(error, 'load_failed')
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    chat: {
      id: data.id,
      title: data.title,
      messages: Array.isArray(data.messages) ? data.messages : [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params

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

  const hasMessages = body.messages !== undefined
  const hasTitle = body.title !== undefined
  if (!hasMessages && !hasTitle) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const messages = hasMessages ? sanitizeMessages(body.messages) : null
  if (hasMessages) {
    if (!messages) return NextResponse.json({ error: 'messages must be an array' }, { status: 400 })
    update.messages = messages
  }

  let renamed = false
  if (hasTitle) {
    const title = sanitizeTitle(body.title)
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    update.title = title
    update.title_auto = false
    renamed = true
  }

  // New messages keep an automatic title in step with the conversation; a
  // title the user chose is left alone.
  if (messages && !renamed) {
    const { data: current, error: readError } = await db
      .from('ai_chats')
      .select('title_auto')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (readError) return failure(readError, 'save_failed')
    if (!current) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (current.title_auto && messages.length) update.title = deriveTitle(messages)
  }

  const { data, error } = await db
    .from('ai_chats')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, title, updated_at')
    .maybeSingle()

  if (error) return failure(error, 'save_failed')
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ chat: { id: data.id, title: data.title, updatedAt: data.updated_at } })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await params

  const { data, error } = await db
    .from('ai_chats')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')

  if (error) return failure(error, 'delete_failed')
  if (!data || data.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
