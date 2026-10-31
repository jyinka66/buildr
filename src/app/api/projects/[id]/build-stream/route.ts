// POST /api/projects/[id]/build-stream — first build of a new project, with live progress.
// ------------------------------------------------------------------
// The create-project call now returns right away with an empty draft, so the
// person lands in the builder at once. This route then runs the full build
// (plan, batches, check, auto-fix) and streams progress as SSE:
//   { type: 'status', message }   what the builder is doing now
//   { type: 'complete', message } finished; the client reloads the project
//   { type: 'error', message }
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { generateInitialProject } from '@/lib/llm/code-generator'
import { parseDbConfig, parseIntegrations } from '@/lib/helpers'
import { requireSessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import { checkLimit, releaseUsageReservation, trackUsage } from '@/lib/billing'
import type { StackKey, StylingKey } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return json({ error: 'unauthorized' }, 401)
    throw err
  }

  const rl = rateLimit(`build:${user.id}`, { limit: 6, windowMs: 60_000 })
  if (!rl.ok) return json({ error: 'rate_limited', retryAfterMs: rl.resetMs }, 429)

  const { data: project } = await db.from('projects').select('*').eq('id', id).maybeSingle()
  if (!project) return json({ error: 'not_found' }, 404)
  if (project.owner_id !== user.id) return json({ error: 'forbidden' }, 403)

  // Only a project that has not been built yet can use this route.
  const { count: fileCount } = await db
    .from('project_files')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)
  if ((fileCount ?? 0) > 0 || project.status === 'deployed') {
    return json({ error: 'already_built', message: 'This project already has files. Describe changes in the chat instead.' }, 409)
  }

  let body: { providerKey?: string | null } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    /* no body is fine */
  }

  const limit = await checkLimit(user.id, 'llm_tokens')
  if (!limit.ok) {
    return json({ error: 'plan_limit_exceeded', message: `LLM token limit reached (${limit.limit}). Upgrade your plan.` }, 402)
  }
  const available = limit.limit === -1 ? 8000 : limit.limit - limit.used
  const estimatedInput = Math.ceil(String(project.prompt ?? '').length / 3) + 2500
  if (available <= estimatedInput) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return json({ error: 'plan_limit_exceeded', message: 'Not enough monthly AI token capacity remains for a new generation.' }, 402)
  }
  const maxTokens = Math.max(1, Math.min(8000, available - estimatedInput))

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          closed = true
        }
      }
      // Keeps proxies from closing the connection during a long model call.
      const beat = setInterval(() => send({ type: 'ping' }), 15_000)

      try {
        send({ type: 'status', message: 'Starting…' })
        const result = await generateInitialProject({
          projectId: id,
          name: project.name,
          prompt: project.prompt,
          stack: project.stack as StackKey,
          styling: project.styling as StylingKey,
          integrations: parseIntegrations(
            typeof project.integrations === 'string' ? project.integrations : JSON.stringify(project.integrations ?? '[]'),
          ),
          dbConfig: parseDbConfig(
            typeof project.db_config === 'string' ? project.db_config : JSON.stringify(project.db_config ?? '{}'),
          ),
          overrideProvider: (body.providerKey as never) ?? null,
          maxTokens,
          onStatus: (message) => send({ type: 'status', message }),
        })
        const recorded = await trackUsage(user.id, 'llm_tokens', Math.max(1, result.tokens), {
          projectId: id,
          reservationId: limit.reservationId,
        })
        if (!recorded) {
          await releaseUsageReservation(user.id, limit.reservationId)
          console.error('[Buildr] build usage could not be recorded for user', user.id)
        }
        send({ type: 'complete', message: result.message })
      } catch (err) {
        await releaseUsageReservation(user.id, limit.reservationId).catch(() => undefined)
        const message = err instanceof Error ? err.message : 'generation_failed'
        await db.from('projects').update({ status: 'error' }).eq('id', id)
        await db.from('generations').insert({
          project_id: id,
          role: 'assistant',
          content: `The first build failed: ${message}. Send your request again in the chat to retry.`,
          file_ops: '[]',
        })
        send({ type: 'error', message })
      } finally {
        clearInterval(beat)
        if (!closed) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {
            /* client already disconnected */
          }
        }
      }
    },
  })

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  })
}
