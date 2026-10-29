// Single-file operations by path.
// GET    /api/projects/[id]/files/[...path] — read file content
// PUT    /api/projects/[id]/files/[...path] — upsert content
// DELETE /api/projects/[id]/files/[...path] — remove file
//
// SECURITY: All methods require an authenticated session and verify the
// caller owns the project before reading/modifying files. Paths are
// sanitized to prevent directory traversal (e.g. ../../etc/passwd).
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

// Resolve the file path from the URL, sanitizing against traversal.
// Returns null if the path is invalid or contains traversal sequences.
async function resolvePath(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url)
  const raw = url.pathname
    .replace(/^\/api\/projects\/[^/]+\/files\//, '')
  // Decode each segment, then validate the joined path.
  const segments = raw
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return ''
      }
    })
    .filter((s) => s.length > 0)

  if (segments.length === 0) return null

  // SECURITY: reject any segment that traverses up a directory.
  // This prevents /api/projects/x/files/../../app/server.js from
  // escaping the project file namespace.
  for (const seg of segments) {
    if (seg === '..') return null
    if (seg.includes('\0')) return null // null-byte injection
  }

  const path = segments.join('/')
  // Reject absolute paths (leading /) and Windows drive prefixes.
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return null
  // Cap path length to prevent abuse.
  if (path.length > 512) return null
  return path
}

// Assert the caller owns the project. Returns { user, status } or throws.
async function assertOwnership(projectId: string): Promise<{ user: { id: string }; status: 200 | 403 | 404 }> {
  const user = await requireSessionUser()
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { user, status: 404 }
  if (project.owner_id !== user.id) return { user, status: 403 }
  return { user, status: 200 }
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function GET(
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

  const path = await resolvePath(req)
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
  const { data: file, error } = await db
    .from('project_files')
    .select('*')
    .eq('project_id', id)
    .eq('path', path)
    .maybeSingle()
  if (error) throw error
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const f = file as ProjectFileRow
  return NextResponse.json({
    file: { ...f, updatedAt: f.updated_at },
  })
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

export async function PUT(
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

  const path = await resolvePath(req)
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
  const body = (await req.json()) as { content: string; language?: string }
  const language = body.language || guessLanguage(path)
  const file = await upsertFile(id, path, body.content, language)
  return NextResponse.json({
    file: { ...file, updatedAt: file.updated_at },
  })
}

export async function DELETE(
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

  const path = await resolvePath(req)
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
  try {
    await db
      .from('project_files')
      .delete()
      .eq('project_id', id)
      .eq('path', path)
  } catch {
    // Ignore — the file may already be gone.
  }
  return NextResponse.json({ ok: true })
}
