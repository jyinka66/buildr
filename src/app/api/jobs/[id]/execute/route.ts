// POST /api/jobs/[id]/execute — executes the job's task plan.
// Creates a Buildr project, generates code, marks deliverables.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { generateInitialProject } from '@/lib/llm/code-generator'
import { slugify } from '@/lib/helpers'
import { notify } from '@/lib/notify'
import { emitWebhook } from '@/lib/webhook'
import { trackUsage } from '@/lib/billing'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import type { DbConfig, StackKey, StylingKey } from '@/lib/types'

export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const rl = rateLimit(`job-execute:${user.id}`, { limit: 5, windowMs: 300_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  // Fetch the job (Supabase)
  const { data: job } = await db.from('jobs').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (job.status === 'executing') return NextResponse.json({ error: 'Job is already being executed.' }, { status: 409 })

  // Parse scope
  let scope: Record<string, unknown> = {}
  try { scope = JSON.parse(job.scope || '{}') } catch { scope = {} }

  const stack = (scope.stack as StackKey) || 'nextjs'
  const features = (scope.features as string[]) || []
  const pages = (scope.pages as string[]) || []
  const integrations = (scope.integrations as string[]) || []
  const deliverables = (scope.deliverables as string[]) || []

  const generationPrompt = [
    `Job: ${job.title}`,
    `Type: ${job.job_type}`,
    `Description: ${job.description}`,
    '',
    `Features: ${features.join(', ') || 'as described'}`,
    `Pages: ${pages.join(', ') || 'home, about, contact'}`,
    `Integrations: ${integrations.join(', ') || 'none'}`,
    '',
    `Deliverables: ${deliverables.join(', ') || 'complete working app'}`,
    '',
    'Generate a complete, production-ready application.',
  ].join('\n')

  // Update job status
  await db.from('jobs').update({ status: 'executing' }).eq('id', id)

  // Create a Buildr project
  const slug = `${slugify(job.title).slice(0, 30)}-${Date.now().toString(36)}`
  const { data: project } = await db.from('projects').insert({
    name: job.title,
    slug,
    description: job.description.slice(0, 280),
    prompt: generationPrompt,
    stack,
    styling: 'tailwind',
    integrations: JSON.stringify(integrations),
    db_config: JSON.stringify({ engine: 'sqlite', orm: 'prisma' } as DbConfig),
    status: 'draft',
    owner_id: user.id,
  }).select('*').single()

  // Link project to job
  await db.from('jobs').update({ project_id: project!.id }).eq('id', id)

  // Execute the code generation
  try {
    const result = await generateInitialProject({
      projectId: project.id,
      name: job.title,
      prompt: generationPrompt,
      stack,
      styling: 'tailwind' as StylingKey,
      integrations,
      dbConfig: { engine: 'sqlite', orm: 'prisma' } as DbConfig,
    })

    const deliverableList = [
      { type: 'project', projectId: project!.id, name: job.title },
      { type: 'preview', url: `/api/projects/${project!.id}/preview` },
      { type: 'zip', url: `/api/export/${project!.id}` },
      ...(result.files || []).map((f: { path: string }) => ({ type: 'file', path: f.path })),
    ]

    // Update job (Supabase)
    await db.from('jobs').update({
      status: 'reviewing',
      deliverables: JSON.stringify(deliverableList),
      tasks: JSON.stringify(
        ((scope.tasks as Record<string, unknown>[]) || []).map((t) => ({ ...t, status: 'completed' })),
      ),
    }).eq('id', id)

    await trackUsage(user.id, 'projects', 1, { projectId: project!.id, via: 'job-execute' })

    await notify({
      ownerId: user.id,
      source: 'system',
      severity: 'success',
      title: `Job delivered: ${job.title}`,
      message: `${result.files?.length || 0} files generated · ready for client review`,
      actionUrl: '/?view=jobs',
      metadata: { jobId: id, projectId: project!.id, fileCount: result.files?.length || 0 },
    })

    await emitWebhook(user.id, 'job.delivered', {
      jobId: id,
      jobTitle: job.title,
      projectId: project!.id,
      fileCount: result.files?.length || 0,
      deliveredAt: new Date().toISOString(),
    })

    return NextResponse.json({
      ok: true,
      jobId: id,
      projectId: project!.id,
      status: 'reviewing',
      deliverables: deliverableList,
      fileCount: result.files?.length || 0,
      message: `Job "${job.title}" executed successfully. ${result.files?.length || 0} files generated.`,
    })
  } catch (err) {
    await db.from('jobs').update({ status: 'failed' }).eq('id', id)
    const message = err instanceof Error ? err.message : 'execution_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
