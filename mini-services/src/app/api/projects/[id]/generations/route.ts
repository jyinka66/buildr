// GET /api/projects/[id]/generations — chat history
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toGenerationView, type GenerationDbRow } from '@/lib/helpers'
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
  // Verify project ownership:
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project || project.owner_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const { data: rows, error } = await db
    .from('generations')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: true })
  if (error) throw error
  return NextResponse.json({
    generations: (rows as GenerationDbRow[] | null ?? []).map(toGenerationView),
  })
}
