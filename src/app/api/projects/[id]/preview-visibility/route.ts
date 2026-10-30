import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null) as { isPublicPreview?: unknown } | null
  if (!body || typeof body.isPublicPreview !== 'boolean') {
    return NextResponse.json({ error: 'isPublicPreview must be a boolean' }, { status: 400 })
  }

  const { data: project, error: lookupError } = await db
    .from('projects')
    .select('id, owner_id')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return NextResponse.json({ error: 'project_lookup_failed' }, { status: 503 })
  if (!project || project.owner_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error: updateError } = await db
    .from('projects')
    .update({ is_public_preview: body.isPublicPreview })
    .eq('id', id)
    .eq('owner_id', user.id)
  if (updateError) return NextResponse.json({ error: 'preview_visibility_update_failed' }, { status: 503 })

  return NextResponse.json({ ok: true, isPublicPreview: body.isPublicPreview })
}
