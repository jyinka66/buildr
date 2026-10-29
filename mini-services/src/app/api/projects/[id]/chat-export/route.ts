// GET /api/projects/[id]/chat-export — exports the project's chat/generation
// history as a Markdown file. Returns text/markdown content-type so the
// browser downloads it.
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
    .select('owner_id, name, prompt, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: generations, error } = await db
    .from('generations')
    .select('role, content, file_ops, tokens, duration_ms, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const lines: string[] = []
  lines.push(`# ${project.name} — Buildr Chat Export`)
  lines.push('')
  lines.push(`- **Stack:** ${project.stack}`)
  lines.push(`- **Prompt:** ${project.prompt}`)
  lines.push(`- **Messages:** ${(generations ?? []).length}`)
  lines.push(`- **Exported:** ${new Date().toISOString()}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const gen of generations ?? []) {
    const role = gen.role as string
    const time = new Date(gen.created_at as string).toISOString()
    const tokens = Number(gen.tokens) || 0
    const durationMs = Number(gen.duration_ms) || 0

    if (role === 'user') {
      lines.push(`## 👤 User`)
      lines.push(`*${time}*`)
      lines.push('')
      lines.push(gen.content as string)
      lines.push('')
    } else if (role === 'assistant') {
      lines.push(`## 🤖 Assistant`)
      lines.push(`*${time} · ${tokens} tokens · ${(durationMs / 1000).toFixed(1)}s*`)
      lines.push('')
      lines.push(gen.content as string)
      // File operations.
      let fileOps: unknown[] = []
      try {
        const raw = gen.file_ops
        fileOps = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw ?? [])
      } catch { /* ignore */ }
      if (Array.isArray(fileOps) && fileOps.length > 0) {
        lines.push('')
        lines.push('**Files changed:**')
        for (const op of fileOps) {
          const o = op as { path?: string; action?: string }
          if (o.path) {
            const icon = o.action === 'create' ? '✅' : o.action === 'update' ? '✏️' : '🗑️'
            lines.push(`- ${icon} \`${o.path}\` (${o.action || 'unknown'})`)
          }
        }
      }
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }

  const markdown = lines.join('\n')
  const filename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-chat.md`

  return new NextResponse(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
