// GET /api/export/[id] — downloads a project ZIP.
import { NextRequest, NextResponse } from 'next/server'
import { buildProjectZip } from '@/lib/generator/exporter'
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
    const { zip, fileName, fileCount } = await buildProjectZip(id)
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${fileName}"`,
        'x-buildr-file-count': String(fileCount),
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'export_failed'
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
