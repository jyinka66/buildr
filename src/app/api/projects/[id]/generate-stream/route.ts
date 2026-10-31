// POST /api/projects/[id]/generate-stream — REAL streaming generation via SSE.
// ------------------------------------------------------------------
// Emits token chunks as the LLM writes them, so the chat panel renders
// the AI's response live (token-by-token). After streaming completes,
// the full response is parsed for files, file changes are applied to
// the DB, and a final "complete" event is sent with fileOps + files.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { completeStream, type ChatMessage } from '@/lib/llm/router'
import { buildSystemPrompt } from '@/lib/llm/code-generator'
import { buildEditPrompt } from '@/lib/llm/project-context'
import { extractFilesFromText, guessLanguage } from '@/lib/llm/code-generator'
import { parseDbConfig, parseIntegrations } from '@/lib/helpers'
import { requireSessionUser } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'
import { checkLimit, releaseUsageReservation, trackUsage } from '@/lib/billing'
import { isUserAdmin } from '@/lib/admin'
import { publicErrorMessage } from '@/lib/llm/public-error'
import type { StackKey, StylingKey, FileOp } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProjectFileRow {
  id: string
  path: string
  content: string
  language: string
  generated: boolean
  updated_at: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw err
  }

  // Rate limit: 10 generations per minute per user.
  const rl = rateLimit(`gen:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', retryAfterMs: rl.resetMs }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
    )
  }

  // Enforce usage metering.
  const limit = await checkLimit(user.id, 'llm_tokens')
  if (!limit.ok) {
    return new Response(
      JSON.stringify({ error: 'plan_limit_exceeded', message: `LLM token limit reached (${limit.limit}). Upgrade your plan.` }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    )
  }

  const { data: project, error: pErr } = await db
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (pErr || !project) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (project.owner_id !== user.id) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  const body = (await req.json()) as { message: string; providerKey?: string | null }
  const message = (body.message || '').trim()
  if (!message) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Record user turn.
  await db.from('generations').insert({
    project_id: id,
    role: 'user',
    content: message,
    file_ops: JSON.stringify([]),
  })

  const { data: generations } = await db
    .from('generations')
    .select('role, content')
    .eq('project_id', id)
    .order('created_at', { ascending: true })
  const history = (generations ?? []).map((g) => ({
    role: g.role as 'user' | 'assistant',
    content: g.content,
  }))

  const { data: existingRows } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)
  const existingFiles = (existingRows ?? []).map((f) => ({
    path: f.path,
    content: f.content,
  }))

  // Build the prompt (same logic as generateIncremental).
  const stack = project.stack as StackKey
  const styling = project.styling as StylingKey
  const integrations = parseIntegrations(
    typeof project.integrations === 'string'
      ? project.integrations
      : JSON.stringify(project.integrations ?? '[]'),
  )
  const dbConfig = parseDbConfig(
    typeof project.db_config === 'string'
      ? project.db_config
      : JSON.stringify(project.db_config ?? '{}'),
  )

  const systemPrompt = buildSystemPrompt({
    stack,
    styling,
    integrations,
    dbConfig,
    existingFiles: existingFiles.map((f) => ({ path: f.path })),
  })

  // The model sees the current code of the relevant files, not just their names.
  const userPrompt = buildEditPrompt(existingFiles, message)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userPrompt },
  ]

  // Provider and model names are shown to admins only.
  const exposeProvider = await isUserAdmin(user.id)

  // ---- SSE stream ----
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      try {
        send({ type: 'status', message: 'Analyzing your request…' })

        let fullContent = ''
        let providerInfo: { id: string; name: string; model: string } | null = null
        let totalTokens = 0
        let durationMs = 0
        let streamFailure: string | null = null

        // Stream tokens from the LLM.
        for await (const event of completeStream(
          messages,
          'code',
          { temperature: 0.4, maxTokens: 8000 },
          (body.providerKey as never) ?? null,
        )) {
          if (event.type === 'token') {
            fullContent += event.content
            send({ type: 'token', content: event.content })
          } else if (event.type === 'done') {
            providerInfo = { id: event.provider.id, name: event.provider.name, model: event.provider.model }
            totalTokens = event.tokens
            durationMs = event.durationMs
          } else if (event.type === 'error') {
            streamFailure = event.message
          }
        }

        // Never parse or persist partial JSON after an upstream stream failure.
        if (streamFailure) throw new Error(streamFailure)

        send({ type: 'status', message: 'Applying file changes…' })

        // Parse files from the LLM response.
        const llmFiles = extractFilesFromText(fullContent)

        // Apply file changes (upsert by path).
        const fileOps: FileOp[] = []
        for (const f of llmFiles) {
          const { data: existing } = await db
            .from('project_files')
            .select('id')
            .eq('project_id', id)
            .eq('path', f.path)
            .maybeSingle()
          const exists = !!existing

          await db
            .from('project_files')
            .upsert({
              project_id: id,
              path: f.path,
              content: f.content,
              language: f.language,
              generated: true,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'project_id,path' })

          fileOps.push({ path: f.path, action: exists ? 'update' : 'create', language: f.language })
        }

        // Track token usage.
        if (totalTokens > 0) {
          const usageRecorded = await trackUsage(user.id, 'llm_tokens', totalTokens, {
            projectId: id,
            reservationId: limit.reservationId,
          })
          if (!usageRecorded) {
            await releaseUsageReservation(user.id, limit.reservationId)
            throw new Error('usage_commit_failed')
          }
        }

        const assistantMessage =
          llmFiles.length > 0
            ? `Applied ${llmFiles.length} file change${llmFiles.length === 1 ? '' : 's'}: ${fileOps.map((o) => o.path).join(', ')}.`
            : `I couldn't parse structured file changes from the model response. Try rephrasing, e.g. "Add a login page" or "Create an API route at /api/users".`

        // Record the assistant generation.
        await db.from('generations').insert({
          project_id: id,
          role: 'assistant',
          content: assistantMessage,
          file_ops: JSON.stringify(fileOps),
          provider_id: providerInfo?.id ?? null,
          tokens: totalTokens,
          duration_ms: durationMs,
        })

        // Mark project as preview-ready.
        await db
          .from('projects')
          .update({ status: 'preview-ready', updated_at: new Date().toISOString() })
          .eq('id', id)

        // Fetch updated files.
        const { data: updatedFiles } = await db
          .from('project_files')
          .select('*')
          .eq('project_id', id)
          .order('path', { ascending: true })

        send({
          type: 'complete',
          message: assistantMessage,
          fileOps,
          provider: exposeProvider ? providerInfo : null,
          tokens: totalTokens,
          durationMs,
          files: (updatedFiles ?? []).map((f: ProjectFileRow) => ({
            id: f.id,
            path: f.path,
            content: f.content,
            language: f.language,
            generated: f.generated,
            updatedAt: new Date(f.updated_at).toISOString(),
          })),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stream_failed'
        send({ type: 'error', message: publicErrorMessage(msg, exposeProvider) })
      } finally {
        // Always clear a reservation left behind by a failed/aborted stream.
        await releaseUsageReservation(user.id, limit.reservationId)
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}
