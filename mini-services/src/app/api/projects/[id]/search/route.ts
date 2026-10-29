// GET /api/projects/[id]/search?q=<query> — full-text search across all
// project files. Returns matches with file path, line number, and context.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(
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

  const url = new URL(req.url)
  const query = url.searchParams.get('q')?.trim()
  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const { data: files, error } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  if (error || !files) {
    return NextResponse.json({ results: [] })
  }

  const results: {
    path: string
    line: number
    column: number
    preview: string
    matchStart: number
    matchEnd: number
  }[] = []

  const lowerQuery = query.toLowerCase()
  const maxResults = 50

  for (const file of files as { path: string; content: string }[]) {
    if (results.length >= maxResults) break
    const lines = file.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break
      const line = lines[i]
      const lowerLine = line.toLowerCase()
      const idx = lowerLine.indexOf(lowerQuery)
      if (idx >= 0) {
        // Build a preview with context around the match.
        const start = Math.max(0, idx - 40)
        const end = Math.min(line.length, idx + query.length + 40)
        const preview = (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '')
        results.push({
          path: file.path,
          line: i + 1,
          column: idx + 1,
          preview: preview.trim(),
          matchStart: idx - start + (start > 0 ? 1 : 0),
          matchEnd: idx - start + query.length + (start > 0 ? 1 : 0),
        })
      }
    }
  }

  return NextResponse.json({ results, query, total: results.length })
}
