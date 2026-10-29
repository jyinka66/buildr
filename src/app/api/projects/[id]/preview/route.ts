// GET /api/projects/[id]/preview — returns an HTML bundle for the iframe.
import { NextRequest, NextResponse } from 'next/server'
import { buildPreviewBundle } from '@/lib/generator/exporter'
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
  // Verify project ownership:
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project || project.owner_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  try {
    const bundle = await buildPreviewBundle(id)
    return new NextResponse(bundle.html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch {
    return new NextResponse(
      '<!doctype html><html><body style="font-family:sans-serif;padding:2rem"><h2>Preview unavailable</h2><p>Generate the project first.</p></body></html>',
      { status: 404, headers: { 'content-type': 'text/html' } },
    )
  }
}
