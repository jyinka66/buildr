// POST /api/chat/stream — general AI chat with no project open.
// ------------------------------------------------------------------
// Ask anything, brainstorm, plan an app before creating it. The conversation
// is kept by the client (sent with every request), so nothing is written to
// project data. Streams reasoning ('thinking') and answer ('token') events;
// see lib/llm/chat-sse.ts.
import { NextRequest } from 'next/server'
import { requireSessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import { checkLimit } from '@/lib/billing'
import { isUserAdmin } from '@/lib/admin'
import { buildChatSystemPrompt } from '@/lib/llm/chat-prompts'
import { createChatSseResponse, jsonError } from '@/lib/llm/chat-sse'
import type { ChatMessage } from '@/lib/llm/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_TURNS = 30
const MAX_CHARS_PER_MESSAGE = 20_000
const MAX_TOTAL_CHARS = 120_000

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return jsonError(401, { error: 'unauthorized' })
    throw err
  }

  const rl = rateLimit(`chat:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rl.ok) {
    return jsonError(429, { error: 'rate_limited', retryAfterMs: rl.resetMs }, {
      'retry-after': String(Math.ceil(rl.resetMs / 1000)),
    })
  }

  let body: { messages?: unknown; providerKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, { error: 'invalid_json' })
  }
  if (!Array.isArray(body.messages)) return jsonError(400, { error: 'messages required' })

  const turns: ChatMessage[] = []
  for (const raw of body.messages.slice(-MAX_TURNS)) {
    const m = raw as { role?: unknown; content?: unknown }
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue
    const content = m.content.trim()
    if (!content) continue
    turns.push({ role: m.role, content: content.slice(0, MAX_CHARS_PER_MESSAGE) })
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return jsonError(400, { error: 'last message must be from the user' })
  }
  // Keep the most recent turns that fit the total budget.
  let total = 0
  const kept: ChatMessage[] = []
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length
    if (total > MAX_TOTAL_CHARS && kept.length > 0) break
    kept.unshift(turns[i])
  }
  // A conversation must open with a user turn.
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift()

  const providerKey = typeof body.providerKey === 'string' && body.providerKey ? body.providerKey : null

  const limit = await checkLimit(user.id, 'llm_tokens')
  if (!limit.ok) {
    return jsonError(402, {
      error: 'plan_limit_exceeded',
      message: `LLM token limit reached (${limit.limit}). Upgrade your plan.`,
    })
  }

  return createChatSseResponse({
    req,
    userId: user.id,
    messages: [{ role: 'system', content: buildChatSystemPrompt(null) }, ...kept],
    providerKey,
    reservationId: limit.reservationId,
    allowBuildHandoff: false,
    exposeProvider: await isUserAdmin(user.id),
  })
}
