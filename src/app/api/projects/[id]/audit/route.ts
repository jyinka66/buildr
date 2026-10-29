// GET /api/projects/[id]/audit — audit log for a project (enterprise compliance).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

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
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: logs } = await db
    .from('audit_log')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(100)

  return NextResponse.json({
    audit: (logs ?? []).map((l) => ({
      id: l.id,
      action: l.action,
      details: typeof l.details === 'string' ? JSON.parse(l.details || '{}') : l.details ?? {},
      createdAt: new Date(l.created_at).toISOString(),
    })),
  })
}
