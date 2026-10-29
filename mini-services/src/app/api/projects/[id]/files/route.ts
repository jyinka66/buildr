// GET  /api/projects/[id]/files — list files (without content) for the explorer
// POST /api/projects/[id]/files — upsert a single file (manual edit)
// PATCH /api/projects/[id]/files — bulk upsert files
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guessLanguage } from '@/lib/llm/code-generator'
import { requireSessionUser } from '@/lib/session'

interface ProjectFileRow {
  id: string
  path: string
  content: string
  language: string
  generated: boolean
  created_at: string
  updated_at: string
}

export async function GET(
  _req: NextRequest,
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
  // Verify project ownership:
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project || project.owner_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const { data: files, error } = await db
    .from('project_files')
    .select('id,path,language,generated,updated_at')
    .eq('project_id', id)
    .order('path', { ascending: true })
  if (error) throw error
  return NextResponse.json({
    files: (files as ProjectFileRow[] | null ?? []).map((f) => ({
      id: f.id,
      path: f.path,
      language: f.language,
      generated: f.generated,
      updatedAt: f.updated_at,
    })),
  })
}

interface UpsertBody {
  path: string
  content: string
  language?: string
}

async function upsertFile(
  projectId: string,
  path: string,
  content: string,
  language: string,
): Promise<ProjectFileRow> {
  const { data: existing } = await db
    .from('project_files')
    .select('id')
    .eq('project_id', projectId)
    .eq('path', path)
    .maybeSingle()
  if (existing) {
    const { data, error } = await db
      .from('project_files')
      .update({
        content,
        language,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', projectId)
      .eq('path', path)
      .select('*')
      .single()
    if (error) throw error
    return data as ProjectFileRow
  }
  const { data, error } = await db
    .from('project_files')
    .insert({
      project_id: projectId,
      path,
      content,
      language,
      generated: true,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ProjectFileRow
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
  // Verify project ownership:
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project || project.owner_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const body = (await req.json()) as UpsertBody
  if (!body.path) {
    return NextResponse.json({ error: 'path required' }, { status: 400 })
  }
  const language = body.language || guessLanguage(body.path)
  const file = await upsertFile(id, body.path, body.content, language)
  return NextResponse.json({
    file: { ...file, updatedAt: file.updated_at },
  })
}

interface BulkBody {
  files: UpsertBody[]
}

export async function PATCH(
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
  // Verify project ownership:
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project || project.owner_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const body = (await req.json()) as BulkBody
  if (!Array.isArray(body.files)) {
    return NextResponse.json({ error: 'files array required' }, { status: 400 })
  }
  // Prisma's $transaction([...]) collapses to sequential awaits against Supabase.
  for (const f of body.files) {
    const language = f.language || guessLanguage(f.path)
    await upsertFile(id, f.path, f.content, language)
  }
  return NextResponse.json({ ok: true, count: body.files.length })
}
