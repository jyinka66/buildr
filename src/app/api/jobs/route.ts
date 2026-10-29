// POST /api/jobs — creates a freelance job, AI analyzes scope, generates task plan
// GET  /api/jobs — lists the user's jobs
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'
import { trackUsage } from '@/lib/billing'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import type { ChatMessage } from '@/lib/llm/router'

const JOB_TYPES = ['website', 'api', 'mobile', 'ecommerce', 'dashboard', 'blog', 'landing', 'portfolio', 'saas']

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status')

  let query = db.from('jobs').select('*').eq('owner_id', user.id)
  if (status) query = query.eq('status', status)
  const { data: jobs } = await query.order('updated_at', { ascending: false }).limit(50)

  return NextResponse.json({
    jobs: (jobs ?? []).map((j) => ({
      id: j.id,
      title: j.title,
      description: j.description,
      jobType: j.job_type,
      clientName: j.client_name,
      status: j.status,
      budget: j.budget,
      createdAt: new Date(j.created_at).toISOString(),
      updatedAt: new Date(j.updated_at).toISOString(),
    })),
  })
}

interface CreateBody {
  title: string
  description: string
  jobType?: string
  clientName?: string
  clientEmail?: string
  budget?: number
  deadline?: string
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const rl = rateLimit(`job-create:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as CreateBody
  const title = body.title?.trim()
  const description = body.description?.trim()

  if (!title || !description) return NextResponse.json({ error: 'title and description are required.' }, { status: 400 })

  const jobType = JOB_TYPES.includes(body.jobType || '') ? body.jobType! : 'website'

  // ── AI Scope Analysis ────────────────────────────────────────────
  const scopeMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a senior project manager and technical architect.',
        'Analyze a freelance job description and generate a detailed scope + task breakdown.',
        '',
        'Return ONLY a JSON object:',
        '{',
        '  "summary": string — one-paragraph summary of what needs to be built',
        '  "stack": string — recommended tech stack',
        '  "estimatedHours": number — realistic time estimate',
        '  "complexity": "simple" | "moderate" | "complex" | "enterprise"',
        '  "deliverables": [string]',
        '  "tasks": [{ "id": number, "name": string, "description": string, "tool": string, "dependencies": [number], "estimatedMinutes": number, "status": "pending" }],',
        '  "features": [string],',
        '  "pages": [string],',
        '  "integrations": [string]',
        '}',
        'Rules: 5-15 tasks, ordered logically, be realistic.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Job title: ${title}\nJob type: ${jobType}\nClient: ${body.clientName || 'Not specified'}\nBudget: ${body.budget ? '$' + body.budget : 'Not specified'}\n\nJob description:\n${description}\n\nAnalyze this job and generate the scope + task breakdown as JSON.`,
    },
  ]

  const zai = await ZAI.create()
  const scopeCompletion = await zai.chat.completions.create({
    messages: scopeMessages.map((m) => (m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content })),
    thinking: { type: 'disabled' },
  })

  let scope: Record<string, unknown> = {}
  try {
    const raw = scopeCompletion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) scope = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    scope = { summary: description, stack: 'nextjs', tasks: [], deliverables: [title] }
  }

  // ── Create the job record (Supabase) ────────────────────────
  const { data: job } = await db.from('jobs').insert({
    owner_id: user.id,
    title,
    description,
    job_type: jobType,
    client_name: body.clientName || null,
    client_email: body.clientEmail || null,
    scope: JSON.stringify(scope),
    tasks: JSON.stringify(scope.tasks || []),
    status: 'planning',
    budget: body.budget || null,
    deadline: body.deadline ? new Date(body.deadline) : null,
  }).select('*').single()

  await trackUsage(user.id, 'projects', 0, { jobId: job!.id, title })

  await notify({
    ownerId: user.id,
    source: 'system',
    severity: 'info',
    title: `New job: ${title}`,
    message: `${jobType} · ${body.clientName || 'No client'} · ${(scope.tasks as unknown[])?.length || 0} tasks planned`,
    actionUrl: '/?view=jobs',
    metadata: { jobId: job!.id, title, jobType, clientName: body.clientName },
  })

  return NextResponse.json({
    ok: true,
    job: {
      id: job!.id,
      title,
      jobType,
      status: 'planning',
      scope: {
        summary: scope.summary,
        stack: scope.stack,
        estimatedHours: scope.estimatedHours,
        complexity: scope.complexity,
        deliverables: scope.deliverables,
        features: scope.features,
        pages: scope.pages,
        integrations: scope.integrations,
      },
      tasks: scope.tasks,
      deliverables: [],
    },
  }, { status: 201 })
}
