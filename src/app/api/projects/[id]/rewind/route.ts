// POST /api/projects/[id]/rewind — restore the project's files to the state
// they were in just AFTER a given generation completed.
//
// Approach: we don't store full snapshots (storage-heavy). Instead we
// replay the conversation: starting from the scaffold is expensive, so
// we take a pragmatic approach — we store the file_ops per generation
// (create/update/delete). To rewind to generation G, we:
//   1. Find all generations AFTER G.
//   2. For each file touched in those later generations, we need the
//      content it had at G. Since we don't snapshot, we instead re-run
//      the generation from the project's initial scaffold up to G by
//      replaying file contents from each generation's file_ops.
//
// Simpler + honest: we store a full snapshot of touched files with each
// assistant generation (in a `snapshots` table). Rewind = restore the
// snapshot for generation G. This is the approach implemented below.
//
// To keep this lightweight we capture snapshots lazily: the streaming
// generator already emits diffs with oldContent — we persist those.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { replaceProjectFiles } from '@/lib/project-files'

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

  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { generationId: string }
  if (!body.generationId) {
    return NextResponse.json({ error: 'generationId required' }, { status: 400 })
  }

  // The snapshot for a generation stores the file tree as it was just
  // AFTER that generation applied its changes. Snapshots are written by
  // the generators (initial + incremental) — see captureSnapshot().
  const { data: snapshot, error } = await db
    .from('snapshots')
    .select('files')
    .eq('project_id', id)
    .eq('generation_id', body.generationId)
    .maybeSingle()
  if (error || !snapshot) {
    return NextResponse.json(
      { error: 'No snapshot found for that generation. Snapshots are captured on each generation.' },
      { status: 404 },
    )
  }

  const files = snapshot.files as { path: string; content: string; language: string }[]

  // Replace the project's files with the snapshot. Upserts first and only then removes
  // paths that are not in the snapshot, so a failure cannot leave the project empty.
  try {
    await replaceProjectFiles(
      db,
      id,
      files.map((f) => ({ path: f.path, content: f.content, language: f.language, generated: true })),
    )
  } catch (err) {
    console.error('[Buildr] rewind failed to restore files:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'rewind_failed' }, { status: 500 })
  }

  await db.from('generations').insert({
    project_id: id,
    role: 'assistant',
    content: `⏮ Rewound to a previous generation. ${files.length} files restored.`,
    file_ops: JSON.stringify([]),
  })

  await db.from('projects').update({ status: 'preview-ready', updated_at: new Date().toISOString() }).eq('id', id)

  const { data: updatedFiles } = await db
    .from('project_files')
    .select('*')
    .eq('project_id', id)
    .order('path', { ascending: true })

  return NextResponse.json({
    files: (updatedFiles ?? []).map((f) => ({
      id: f.id,
      path: f.path,
      content: f.content,
      language: f.language,
      generated: f.generated,
      updatedAt: new Date(f.updated_at).toISOString(),
    })),
  })
}
