// POST /api/projects/[id]/cron — generates scheduled task (cron job) handlers
// for the project. Creates:
//   1. src/app/api/cron/<name>/route.ts — a GET endpoint that executes the job
//   2. A CRON_SECRET env var for authentication (prevents unauthorized triggers)
//   3. vercel.json — the Vercel cron config (or a cron.yml for other hosts)
//
// The user describes what the cron job should do (e.g. "send a weekly digest
// email", "clean up expired sessions daily"). The LLM generates the handler.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface CronBody {
  name: string // job name (e.g. "weekly-digest")
  schedule: string // cron expression (e.g. "0 9 * * 1" = every Monday 9am)
  description: string // what the job does
  providerKey?: string | null
}

const CRON_PRESETS: Record<string, string> = {
  'every-minute': '* * * * *',
  'every-hour': '0 * * * *',
  'every-day': '0 0 * * *',
  'every-week': '0 0 * * 0',
  'every-month': '0 0 1 * *',
}

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
  const rl = rateLimit(`cron:${user.id}`, { limit: 10, windowMs: 60_000 })
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

  const body = (await req.json()) as CronBody
  const jobName = body.name?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'cron-job'
  const schedule = CRON_PRESETS[body.schedule] || body.schedule || '0 * * * *'
  const description = body.description?.trim()

  if (!description) {
    return NextResponse.json({ error: 'description is required.' }, { status: 400 })
  }

  // Generate the cron handler via LLM.
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a backend engineer generating a cron job handler for a ' + project.stack + ' app.',
        'The handler is a GET endpoint at /api/cron/' + jobName + ' that:',
        '  - Verifies the CRON_SECRET header (authorization: Bearer <secret>)',
        '  - Executes the scheduled task',
        '  - Returns a JSON response with the result',
        '',
        'Return ONLY the file content (TypeScript for Next.js App Router route handler).',
        'No markdown fences. No explanation.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Job name: ${jobName}`,
        `Schedule: ${schedule}`,
        `Description: ${description}`,
        '',
        'Generate the cron job handler (src/app/api/cron/' + jobName + '/route.ts).',
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.2,
      maxTokens: 4000,
    }, (body.providerKey as never) ?? null)

    let handlerCode = result.content
    // Strip markdown fences if present.
    const fence = handlerCode.match(/```(?:typescript|ts)?\s*([\s\S]*?)```/i)
    if (fence) handlerCode = fence[1].trim()

    // Ensure it's a proper Next.js route handler.
    if (!handlerCode.includes('import')) {
      handlerCode = `import { NextRequest, NextResponse } from "next/server";\n\n` + handlerCode
    }

    const filesToSave: { path: string; content: string; language: string }[] = [
      {
        path: `src/app/api/cron/${jobName}/route.ts`,
        language: 'ts',
        content: handlerCode,
      },
      {
        path: 'vercel.json',
        language: 'json',
        content: JSON.stringify({
          crons: [
            {
              path: `/api/cron/${jobName}`,
              schedule,
            },
          ],
        }, null, 2) + '\n',
      },
    ]

    // Save files (upsert).
    const savedFiles: { path: string }[] = []
    for (const file of filesToSave) {
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

    await audit('cron.generate', { jobName, schedule }, user.id, id)

    return NextResponse.json({
      ok: true,
      jobName,
      schedule,
      filesSaved: savedFiles,
      envVars: ['CRON_SECRET'],
      testCommand: `curl -H "Authorization: Bearer \${CRON_SECRET}" http://localhost:3000/api/cron/${jobName}`,
      message: `Cron job "${jobName}" generated. Set CRON_SECRET in .env and deploy to Vercel for automatic scheduling.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'cron_generation_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
