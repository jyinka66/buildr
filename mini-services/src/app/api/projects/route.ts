// GET /api/projects  — list the signed-in user's projects
// POST /api/projects — create a new project for the signed-in user
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  slugify,
  toProjectView,
  isStackKey,
  isStylingKey,
  parseDbConfig,
  parseIntegrations,
  type ProjectDbRow,
} from '@/lib/helpers'
import { generateInitialProject } from '@/lib/llm/code-generator'
import { seedIntegrations } from '@/lib/generator/integrations'
import { seedProviders } from '@/lib/llm/router'
import { requireSessionUser } from '@/lib/session'
import { checkLimit, trackUsage } from '@/lib/billing'
import type { DbConfig } from '@/lib/types'

export async function GET() {
  try {
    const user = await requireSessionUser()
    await seedProviders()
    await seedIntegrations()
    const { data: rows, error } = await db
      .from('projects')
      .select('*')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false })
    if (error) throw error

    const projects = await Promise.all(
      (rows as ProjectDbRow[] | null ?? []).map(async (r) => {
        const { count } = await db
          .from('project_files')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', r.id)
        return {
          id: r.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          stack: r.stack,
          styling: r.styling,
          prompt: r.prompt,
          providerId: r.provider_id,
          integrations: parseIntegrations(r.integrations),
          dbConfig: parseDbConfig(r.db_config),
          status: r.status,
          previewUrl: r.preview_url,
          deploymentUrl: r.deployment_url,
          fileCount: count ?? 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      }),
    )
    return NextResponse.json({ projects })
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
}

interface CreateBody {
  name: string
  prompt: string
  stack: string
  styling: string
  integrations: string[]
  dbConfig: DbConfig
  providerKey?: string | null
  generate?: boolean
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  await seedProviders()
  await seedIntegrations()
  const body = (await req.json()) as CreateBody

  const name = (body.name || '').trim()
  const prompt = (body.prompt || '').trim()
  if (!name || !prompt) {
    return NextResponse.json(
      { error: 'name and prompt are required.' },
      { status: 400 },
    )
  }

  const stack = isStackKey(body.stack) ? body.stack : 'nextjs'
  const styling = isStylingKey(body.styling) ? body.styling : 'tailwind'
  const integrations = Array.isArray(body.integrations) ? body.integrations : []
  const dbConfig: DbConfig = body.dbConfig ?? { engine: 'sqlite', orm: 'prisma' }

  // Billing: check plan limit before creating.
  const limit = await checkLimit(user.id, 'projects')
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: `Project limit reached (${limit.limit}). Upgrade your plan.` },
      { status: 402 },
    )
  }

  const slug = await uniqueSlug(slugify(name))

  const { data: project, error: createError } = await db
    .from('projects')
    .insert({
      name,
      slug,
      description: prompt.slice(0, 280),
      prompt,
      stack,
      styling,
      integrations: JSON.stringify(integrations),
      db_config: JSON.stringify(dbConfig),
      status: 'draft',
      owner_id: user.id,
    })
    .select('*')
    .single()
  if (createError || !project) {
    throw createError ?? new Error('project_create_failed')
  }
  const projectId = (project as ProjectDbRow).id

  // Track usage.
  await trackUsage(user.id, 'projects', 1, { projectId, name })

  if (body.generate !== false) {
    try {
      const result = await generateInitialProject({
        projectId,
        name,
        prompt,
        stack,
        styling,
        integrations,
        dbConfig,
        overrideProvider: (body.providerKey as never) ?? null,
      })
      const { data: freshRow } = await db
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle()
      const view = await toProjectView(freshRow as ProjectDbRow | null)
      return NextResponse.json({ project: view, generation: result }, { status: 201 })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'generation_failed'
      const { data: freshRow } = await db
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle()
      const view = await toProjectView(freshRow as ProjectDbRow | null)
      await db
        .from('projects')
        .update({ status: 'error' })
        .eq('id', projectId)
      const { error: genErr } = await db.from('generations').insert({
        project_id: projectId,
        role: 'assistant',
        content: `Generation failed: ${message}. The scaffold is in place — you can retry from chat.`,
        file_ops: '[]',
      }).select('*').single()
      if (genErr) throw genErr
      return NextResponse.json(
        { project: view, error: message },
        { status: 201 },
      )
    }
  }

  const { data: freshRow } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle()
  const view = await toProjectView(freshRow as ProjectDbRow | null)
  return NextResponse.json({ project: view }, { status: 201 })
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data: existing } = await db
      .from('projects')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!existing) return candidate
    candidate = `${base}-${i++}`
  }
}
