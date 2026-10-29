// /api/v1/projects — Public API for project management.
// ------------------------------------------------------------------
//   GET  — list the API key owner's projects.       scope: projects:read
//   POST — create a new project (record-only).       scope: projects:write
//
// Authenticated via Bearer token using authenticateApiKey(req, scope) from
// @/lib/api-key. The ownerId is taken from the API key — there is no
// session dependency.
//
// NOTE: This endpoint creates the project record only — it does NOT trigger
// AI generation. Use the session-based /api/projects endpoint or chat API
// to generate code. Public API consumers typically want to create a shell
// project, then drive generation via the v1 endpoints later.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey } from '@/lib/api-key'
import {
  slugify,
  isStackKey,
  isStylingKey,
  parseDbConfig,
} from '@/lib/helpers'
import { checkLimit, trackUsage } from '@/lib/billing'
import type { DbConfig } from '@/lib/types'

interface ProjectRow {
  id: string
  name: string
  slug: string
  description: string
  stack: string
  styling: string
  prompt: string
  provider_id: string | null
  integrations: string
  db_config: string
  status: string
  preview_url: string | null
  deployment_url: string | null
  created_at: string
  updated_at: string
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

interface CreateBody {
  name?: string
  prompt?: string
  description?: string
  stack?: string
  styling?: string
  integrations?: string[]
  dbConfig?: DbConfig
}

// ---------------------------------------------------------------------------
// GET — list projects (project list shape mirrors the session API).
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req, 'projects:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  const { data: rows, error } = await db
    .from('projects')
    .select('*')
    .eq('owner_id', auth.userId!)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const projectRows = (rows as ProjectRow[] | null) ?? []

  // Fetch file counts per project.
  const projectIds = projectRows.map((r) => r.id)
  const fileCounts = new Map<string, number>()
  if (projectIds.length) {
    for (const pid of projectIds) {
      const { count } = await db
        .from('project_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
      fileCounts.set(pid, count ?? 0)
    }
  }

  const projects = projectRows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    stack: r.stack,
    styling: r.styling,
    prompt: r.prompt,
    integrations: JSON.parse(r.integrations || '[]'),
    dbConfig: parseDbConfig(r.db_config),
    status: r.status,
    previewUrl: r.preview_url,
    deploymentUrl: r.deployment_url,
    fileCount: fileCounts.get(r.id) ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))

  return NextResponse.json({
    ok: true,
    count: projects.length,
    projects,
  })
}

// ---------------------------------------------------------------------------
// POST — create a project (record only — no AI generation via public API).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req, 'projects:write')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  const body = (await req.json().catch(() => ({}))) as CreateBody

  const name = (body.name || '').trim()
  const prompt = (body.prompt || '').trim()
  if (!name || !prompt) {
    return NextResponse.json(
      { ok: false, error: 'name and prompt are required.' },
      { status: 400 },
    )
  }

  const stack = isStackKey(body.stack || '') ? body.stack! : 'nextjs'
  const styling = isStylingKey(body.styling || '') ? body.styling! : 'tailwind'
  const integrations = Array.isArray(body.integrations) ? body.integrations : []
  const dbConfig: DbConfig = body.dbConfig ?? { engine: 'sqlite', orm: 'prisma' }

  // Billing: enforce plan limit before creating.
  const limit = await checkLimit(auth.userId!, 'projects')
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'plan_limit_exceeded',
        message: `Project limit reached (${limit.limit}). Upgrade your plan.`,
      },
      { status: 402 },
    )
  }

  const slug = await uniqueSlug(slugify(name))

  const { data: project, error } = await db
    .from('projects')
    .insert({
      name,
      slug,
      description: (body.description?.trim() || prompt.slice(0, 280)),
      prompt,
      stack,
      styling,
      integrations: JSON.stringify(integrations),
      db_config: JSON.stringify(dbConfig),
      status: 'draft',
      owner_id: auth.userId!,
    })
    .select('*')
    .single()

  if (error || !project) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'create_failed' },
      { status: 500 },
    )
  }

  const p = project as ProjectRow

  await trackUsage(auth.userId!, 'projects', 1, {
    projectId: p.id,
    name,
    via: 'api-v1',
  })

  return NextResponse.json(
    {
      ok: true,
      project: {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        stack: p.stack,
        styling: p.styling,
        prompt: p.prompt,
        integrations,
        dbConfig,
        status: p.status,
        previewUrl: p.preview_url,
        deploymentUrl: p.deployment_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      },
    },
    { status: 201 },
  )
}
