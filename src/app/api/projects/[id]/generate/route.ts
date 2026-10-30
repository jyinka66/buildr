// POST /api/projects/[id]/generate — incremental generation: user sends a
// chat message, the router picks a provider, applies file changes.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateIncremental } from '@/lib/llm/code-generator'
import {
  parseDbConfig,
  parseIntegrations,
  type ProjectDbRow,
} from '@/lib/helpers'
import { requireSessionUser } from '@/lib/session'
import { checkLimit, releaseUsageReservation, trackUsage } from '@/lib/billing'
import { distributedRateLimit } from '@/lib/rate-limit'
import type { StackKey, StylingKey } from '@/lib/types'

interface ProjectFileRow {
  id: string
  path: string
  content: string
  language: string
  generated: boolean
  created_at: string
  updated_at: string
}

interface GenerationRow {
  id: string
  role: string
  content: string
  file_ops: string | unknown[]
  provider_id: string | null
  tokens: number
  duration_ms: number
  created_at: string
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
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const { data: project, error: projectErr } = await db
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (projectErr) throw projectErr
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const p = project as ProjectDbRow
  if (p.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { message: string; providerKey?: string | null }

  const message = (body.message || '').trim()
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 })
  }

  // Record user turn.
  const { error: genErr } = await db
    .from('generations')
    .insert({ project_id: id, role: 'user', content: message })
    .select('*')
    .single()
  if (genErr) throw genErr

  const { data: generations } = await db
    .from('generations')
    .select('role,content')
    .eq('project_id', id)
    .order('created_at', { ascending: true })
  const history = (generations as Pick<GenerationRow, 'role' | 'content'>[] | null ?? []).map(
    (g) => ({
      role: g.role as 'user' | 'assistant',
      content: g.content,
    }),
  )

  const { data: existingFiles } = await db
    .from('project_files')
    .select('path,content')
    .eq('project_id', id)
  const existingFileList = (existingFiles as Pick<ProjectFileRow, 'path' | 'content'>[] | null ?? []).map(
    (f) => ({ path: f.path, content: f.content }),
  )

  // Rate limit: 10 generations per user per minute.
  const rl = await distributedRateLimit(`generate:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.resetMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
    )
  }

  // Enforce usage metering: check llm_tokens quota before generating.
  const limit = await checkLimit(user.id, 'llm_tokens')
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: `LLM token limit reached (${limit.limit}). Upgrade your plan.` },
      { status: 402 },
    )
  }
  const availableTokens = limit.limit === -1 ? 8000 : limit.limit - limit.used
  const estimatedInputTokens = Math.ceil((
    message.length +
    history.reduce((sum, item) => sum + item.content.length, 0) +
    existingFileList.reduce((sum, item) => sum + item.path.length + 20, 0)
  ) / 3) + 2000
  if (availableTokens <= estimatedInputTokens) {
    await releaseUsageReservation(user.id, limit.reservationId)
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: 'Not enough monthly AI token capacity remains for this generation.' },
      { status: 402 },
    )
  }
  const generationMaxTokens = Math.max(1, Math.min(8000, availableTokens - estimatedInputTokens))

  try {
    const result = await generateIncremental({
      projectId: id,
      message,
      stack: p.stack as StackKey,
      styling: p.styling as StylingKey,
      integrations: parseIntegrations(p.integrations),
      dbConfig: parseDbConfig(p.db_config),
      history,
      existingFiles: existingFileList,
      overrideProvider: (body.providerKey as never) ?? null,
      maxTokens: generationMaxTokens,
    })

    // Commit actual usage against the reservation; do not allow concurrent
    // generations to overrun the monthly token cap.
    if (result.tokens > 0) {
      const usageRecorded = await trackUsage(user.id, 'llm_tokens', result.tokens, {
        projectId: id, reservationId: limit.reservationId,
      })
      if (!usageRecorded) {
        return NextResponse.json({
          error: 'usage_commit_failed',
          message: 'Generation completed, but token usage could not be committed safely.',
        }, { status: 503 })
      }
    } else {
      await releaseUsageReservation(user.id, limit.reservationId)
    }

    const { data: updatedFiles } = await db
      .from('project_files')
      .select('*')
      .eq('project_id', id)
      .order('path', { ascending: true })
    return NextResponse.json({
      generation: result,
      files: (updatedFiles as ProjectFileRow[] | null ?? []).map((f) => ({
        id: f.id,
        path: f.path,
        content: f.content,
        language: f.language,
        generated: f.generated,
        updatedAt: f.updated_at,
      })),
    })
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'generation_failed'
    const { error: failGenErr } = await db
      .from('generations')
      .insert({
        project_id: id,
        role: 'assistant',
        content: `⚠️ Generation failed: ${errorMessage}. The model may be unavailable — try again or switch provider.`,
        file_ops: '[]',
      })
      .select('*')
      .single()
    if (failGenErr) throw failGenErr
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
