// POST /api/projects/[id]/fork — duplicates a project (with all its files)
// into a new project owned by the current user. The fork gets a new slug
// and a "(fork)" suffix on the name unless a custom name is provided.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { slugify } from '@/lib/helpers'
import { audit } from '@/lib/snapshot'

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

  const { data: source, error } = await db
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !source) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  // Anyone can fork any project they can see — but we only show public
  // projects or owned ones. For now, require ownership.
  if (source.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const newName = (body.name as string)?.trim() || `${source.name} (fork)`
  const newSlug = await uniqueSlug(slugify(newName))

  const { data: fork, error: insErr } = await db
    .from('projects')
    .insert({
      name: newName,
      slug: newSlug,
      description: source.description,
      stack: source.stack,
      styling: source.styling,
      prompt: source.prompt,
      integrations: source.integrations,
      db_config: source.db_config,
      status: 'preview-ready',
      owner_id: user.id,
    })
    .select('*')
    .single()
  if (insErr || !fork) {
    return NextResponse.json({ error: insErr?.message || 'fork_failed' }, { status: 500 })
  }

  // Copy all files.
  const { data: files } = await db
    .from('project_files')
    .select('path, content, language, generated')
    .eq('project_id', id)
  if (files && files.length) {
    await db.from('project_files').insert(
      files.map((f: { path: string; content: string; language: string; generated: boolean }) => ({
        project_id: fork.id,
        path: f.path,
        content: f.content,
        language: f.language,
        generated: f.generated,
      })),
    )
  }

  await audit('project.fork', { from: id, to: fork.id }, user.id, fork.id)

  return NextResponse.json({ projectId: fork.id, slug: fork.slug }, { status: 201 })
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data } = await db.from('projects').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
    candidate = `${base}-${i++}`
  }
}
