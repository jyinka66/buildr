// POST /api/projects/[id]/chat-stream — conversational chat inside a project.
// ------------------------------------------------------------------
// Answers questions, explains and plans in the context of the project, with
// live reasoning + token streaming (see lib/llm/chat-sse.ts for the events).
//
// This route NEVER writes project files. When the user clearly asks for a
// change to the app, the model replies with the build marker and this route
// emits `{ type: 'build' }`; the client then calls the existing
// /api/projects/[id]/generate-stream route, which is unchanged.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import { checkLimit, releaseUsageReservation } from '@/lib/billing'
import { buildChatSystemPrompt } from '@/lib/llm/chat-prompts'
import { createChatSseResponse, jsonError } from '@/lib/llm/chat-sse'
import { CHAT_CONTEXT_LIMITS, formatProjectContext, selectProjectContext } from '@/lib/llm/project-context'
import type { ChatMessage } from '@/lib/llm/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MESSAGE_CHARS = 20_000
const HISTORY_TURNS = 20
const HISTORY_CHARS_PER_TURN = 6_000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
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

  let body: { message?: unknown; providerKey?: unknown; mode?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, { error: 'invalid_json' })
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return jsonError(400, { error: 'message required' })
  if (message.length > MAX_MESSAGE_CHARS) return jsonError(413, { error: 'message_too_long' })
  const providerKey = typeof body.providerKey === 'string' && body.providerKey ? body.providerKey : null
  // 'chat' = answer only. Anything else = auto (may hand off to the builder).
  const allowBuildHandoff = body.mode !== 'chat'

  const limit = await checkLimit(user.id, 'llm_tokens')
  if (!limit.ok) {
    return jsonError(402, {
      error: 'plan_limit_exceeded',
      message: `LLM token limit reached (${limit.limit}). Upgrade your plan.`,
    })
  }

  const { data: project, error: pErr } = await db.from('projects').select('*').eq('id', id).maybeSingle()
  if (pErr || !project) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return jsonError(404, { error: 'not_found' })
  }
  if (project.owner_id !== user.id) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return jsonError(403, { error: 'forbidden' })
  }

  const [{ data: fileRows }, { data: historyRows }] = await Promise.all([
    db.from('project_files').select('path, content').eq('project_id', id).order('path', { ascending: true }),
    db
      .from('generations')
      .select('role, content')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS),
  ])

  const history: ChatMessage[] = (historyRows ?? [])
    .reverse()
    .filter((g: { role: string; content: string }) => (g.role === 'user' || g.role === 'assistant') && g.content)
    .map((g: { role: string; content: string }) => ({
      role: g.role as 'user' | 'assistant',
      content: g.content.slice(0, HISTORY_CHARS_PER_TURN),
    }))

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildChatSystemPrompt(
        {
          name: String(project.name ?? 'Untitled'),
          stack: String(project.stack ?? ''),
          styling: String(project.styling ?? ''),
          files: (fileRows ?? []).map((f: { path: string }) => f.path),
          code: formatProjectContext(
            selectProjectContext(
              (fileRows ?? []).map((f: { path: string; content: string | null }) => ({ path: f.path, content: f.content ?? '' })),
              message,
              CHAT_CONTEXT_LIMITS,
            ),
          ),
        },
        allowBuildHandoff,
      ),
    },
    ...history,
    { role: 'user', content: message },
  ]

  return createChatSseResponse({
    req,
    userId: user.id,
    messages,
    providerKey,
    reservationId: limit.reservationId,
    projectId: id,
    allowBuildHandoff,
    // Record the user's turn only once we know this is a chat reply. On a
    // build handoff the builder records it itself, so it is never duplicated.
    onChatStarted: async () => {
      await db.from('generations').insert({
        project_id: id,
        role: 'user',
        content: message,
        file_ops: JSON.stringify([]),
      })
    },
    onChatFinished: async ({ content, providerId, tokens, durationMs }) => {
      await db.from('generations').insert({
        project_id: id,
        role: 'assistant',
        content,
        file_ops: JSON.stringify([]),
        provider_id: providerId,
        tokens,
        duration_ms: durationMs,
      })
    },
  })
}
