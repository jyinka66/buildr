// GET    /api/projects/[id] — full project w/ files + generations (owner only)
// PATCH  /api/projects/[id] — update metadata (integrations, dbConfig, name)
// DELETE /api/projects/[id] — remove project + cascade
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  toProjectView,
  toGenerationView,
  type ProjectDbRow,
  type GenerationDbRow,
} from '@/lib/helpers'
import { requireSessionUser } from '@/lib/session'
import type { DbConfig } from '@/lib/types'

interface ProjectFileRow {
  id: string
  path: string
  content: string
  language: string
  generated: boolean
  created_at: string
  updated_at: string
}

async function assertOwnership(id: string) {
  const user = await requireSessionUser()
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return { user, project: null, status: 404 } as const
  if (project.owner_id !== user.id) {
    return { user, project: null, status: 403 } as const
  }
  return { user, project, status: 200 } as const
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let owner
  try {
    owner = await assertOwnership(id)
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }
  if (owner.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (owner.status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { data: row, error } = await db
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: files } = await db
    .from('project_files')
    .select('*')
    .eq('project_id', id)
    .order('path', { ascending: true })
  const { data: generations } = await db
    .from('generations')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: true })

  const project = await toProjectView(row as ProjectDbRow)
  return NextResponse.json({
    project,
    files: (files as ProjectFileRow[] | null ?? []).map((f) => ({
      id: f.id,
      path: f.path,
      content: f.content,
      language: f.language,
      generated: f.generated,
      updatedAt: f.updated_at,
    })),
    generations: (generations as GenerationDbRow[] | null ?? []).map(toGenerationView),
  })
}

interface PatchBody {
  name?: string
  description?: string
  integrations?: string[]
  dbConfig?: DbConfig
  providerKey?: string | null
  isPublicPreview?: boolean
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let owner
  try {
    owner = await assertOwnership(id)
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }
  if (owner.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (owner.status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json()) as PatchBody
  const data: Record<string, unknown> = {}
  if (body.name) data.name = body.name
  if (typeof body.description === 'string') data.description = body.description
  if (Array.isArray(body.integrations)) {
    data.integrations = JSON.stringify(body.integrations)
  }
  if (body.dbConfig) data.db_config = JSON.stringify(body.dbConfig)
  if (body.providerKey !== undefined) {
    if (body.providerKey === null) {
      data.provider_id = null
    } else {
      const { data: provider } = await db
        .from('llm_providers')
        .select('id')
        .eq('key', body.providerKey)
        .maybeSingle()
      if (provider) data.provider_id = provider.id
    }
  }

  await db.from('projects').update(data).eq('id', id)
  const { data: freshRow } = await db
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  const view = await toProjectView(freshRow as ProjectDbRow | null)
  return NextResponse.json({ project: view })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let owner
  try {
    owner = await assertOwnership(id)
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }
  if (owner.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (owner.status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { error } = await db.from('projects').delete().eq('id', id)
  if (error) throw error
  return NextResponse.json({ ok: true })
}
