// POST /api/projects/[id]/mock-server — generates a mock server file that
// returns realistic mock responses for API routes. Useful when developing
// the frontend before the backend is fully implemented.
//
// Creates: src/lib/mock-server.ts — intercepts fetch calls in development
// and returns mock data instead of hitting the real API.
// Also creates: src/lib/mock-data.ts — the mock data definitions.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

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
  const rl = rateLimit(`mock:${user.id}`, { limit: 5, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, name, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const providerKey = (body.providerKey as string | null) ?? null

  // Fetch the project's route files to understand the API surface.
  const { data: files } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  const routeFiles = (files ?? [])
    .filter((f: { path: string }) => f.path.includes('/api/') && /\/route\.tsx?$/.test(f.path))
    .slice(0, 15)

  if (routeFiles.length === 0) {
    return NextResponse.json(
      { error: 'No API route files found. Generate some routes first.' },
      { status: 400 },
    )
  }

  // Build a summary of routes + their methods.
  const routeSummary = routeFiles
    .map((f: { path: string; content: string }) => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
        .filter((m) => new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+)?${m}\\b`).test(f.content))
      const apiPath = f.path
        .replace(/^src\/app\//, '/')
        .replace(/\/route\.tsx?$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1')
      return `${methods.join(', ')} ${apiPath}`
    })
    .join('\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a mock data generator. You receive a list of API routes and generate',
        'realistic mock data + a fetch interceptor that returns mock responses in development.',
        '',
        'Generate TWO files:',
        '1. src/lib/mock-data.ts — exports mock data objects for each route',
        '2. src/lib/mock-server.ts — a fetch interceptor that catches /api/* requests',
        '   and returns the mock data. Only active when process.env.NODE_ENV !== "production".',
        '',
        'Return ONLY a JSON array of files:',
        '[{"path":"src/lib/mock-data.ts","language":"ts","content":"..."}]',
        '',
        'Rules:',
        '- Mock data must be realistic (real names, emails, dates, numbers — not "test1")',
        '- Support route parameters (e.g. /api/users/:id should return a specific user)',
        '- Support query params (e.g. /api/users?search= should filter)',
        '- Return appropriate HTTP status codes (200, 201, 404, etc.)',
        '- Add artificial delay (100-500ms) to simulate real network',
        '- No placeholders. All data must be real and varied.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Stack: ${project.stack}`,
        '',
        'API ROUTES:',
        routeSummary,
        '',
        'Generate the mock server + mock data files.',
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.3,
      maxTokens: 6000,
    }, (providerKey as never) ?? null)

    // Parse the file array.
    let mockFiles: { path: string; content: string; language: string }[] = []
    try {
      const text = result.content
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
      const candidate = fence ? fence[1] : text
      const start = candidate.indexOf('[')
      const end = candidate.lastIndexOf(']')
      if (start !== -1 && end !== -1) {
        const arr = JSON.parse(candidate.slice(start, end + 1))
        if (Array.isArray(arr)) {
          mockFiles = arr
            .filter((f: Record<string, unknown>) => typeof f === 'object' && f !== null)
            .map((f: Record<string, unknown>) => ({
              path: String(f.path ?? ''),
              content: String(f.content ?? ''),
              language: String(f.language ?? 'ts'),
            }))
            .filter((f: { path: string; content: string }) => f.path && f.content)
        }
      }
    } catch {
      mockFiles = []
    }

    if (mockFiles.length === 0) {
      return NextResponse.json(
        { error: 'Could not parse mock files from the LLM response. Try again.' },
        { status: 422 },
      )
    }

    // Save files (upsert).
    const savedFiles: { path: string }[] = []
    for (const file of mockFiles) {
      const { data: existing } = await db
        .from('project_files')
        .select('id')
        .eq('project_id', id)
        .eq('path', file.path)
        .maybeSingle()

      if (existing) {
        await db
          .from('project_files')
          .update({ content: file.content, language: file.language, updated_at: new Date().toISOString() })
          .eq('project_id', id)
          .eq('path', file.path)
      } else {
        await db.from('project_files').insert({
          project_id: id,
          path: file.path,
          content: file.content,
          language: file.language,
          generated: true,
        })
      }
      savedFiles.push({ path: file.path })
    }

    await audit('mock_server.generate', { filesGenerated: savedFiles.length, routes: routeFiles.length }, user.id, id)

    return NextResponse.json({
      ok: true,
      filesSaved: savedFiles,
      routeCount: routeFiles.length,
      message: 'Mock server generated. Import src/lib/mock-server.ts in your layout to activate it in development.',
      provider: { name: result.provider.name, model: result.provider.model },
      tokens: result.tokens,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'mock_generation_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
