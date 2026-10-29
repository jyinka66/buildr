// POST /api/god-mode — create a goal + AI decomposes it into a task graph + begins execution
// GET  /api/god-mode — list the user's goals
//
// God Mode is the autonomous agent layer. The user sets a goal + timeframe,
// AI decomposes it into a task graph, then executes it by generating a
// complete codebase. The result is a Buildr project the user can open.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { slugify } from '@/lib/helpers'
import { generateInitialProject } from '@/lib/llm/code-generator'
import { checkLimit, trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

async function uniqueProjectSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data: existing } = await db.from('projects').select('id').eq('slug', candidate).maybeSingle()
    if (!existing) return candidate
    candidate = `${base}-${i++}`
  }
}

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { data: goals } = await db
    .from('god_mode_goals')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    goals: (goals ?? []).map((g) => {
      const tasks = JSON.parse(g.task_graph || '[]') as Record<string, unknown>[]
      const progress = JSON.parse(g.progress || '{}') as Record<string, unknown>
      return {
        id: g.id,
        goal: g.goal,
        timeframeHours: g.timeframe_hours,
        status: g.status,
        currentTask: g.current_task,
        resultSummary: g.result_summary,
        projectId: g.project_id,
        progress: {
          completedTasks: (progress.completedTasks as number) || 0,
          totalTasks: (progress.totalTasks as number) || tasks.length,
        },
        taskCount: tasks.length,
        createdAt: new Date(g.created_at).toISOString(),
      }
    }),
  })
}

interface CreateBody {
  goal: string
  timeframeHours?: number
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json()) as CreateBody
  const goal = body.goal?.trim()
  const timeframeHours = Math.min(Math.max(body.timeframeHours || 24, 1), 168)

  if (!goal || goal.length < 10) {
    return NextResponse.json(
      { error: 'Please describe your goal in detail (at least 10 characters).' },
      { status: 400 },
    )
  }

  // Billing: check god-mode goal limit.
  const limit = await checkLimit(user.id, 'godmode_goals')
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: `God Mode goal limit reached (${limit.limit}). Upgrade your plan.` },
      { status: 402 },
    )
  }

  const zai = await ZAI.create()

  // ── Step 1: AI decomposes the goal into a task graph ─────────────
  const decomposeMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an autonomous AI agent planner. Decompose a goal into a task graph.',
        `Timeframe: ${timeframeHours} hours. Plan tasks that fit within this timeframe.`,
        '',
        'Return ONLY a JSON object:',
        '{',
        '  "summary": string — one-paragraph summary of what will be built',
        '  "tasks": [{',
        '    "id": number,',
        '    "name": string — short task name',
        '    "description": string — what the task does',
        '    "tool": "code-generator" | "image-generator" | "seo" | "deploy" | "code-review" | "schema-design" | "seed" | "manual",',
        '    "dependencies": [number] — task IDs that must complete first',
        '    "estimatedMinutes": number,',
        '    "status": "pending"',
        '  }],',
        '  "deliverables": [string] — what the user will receive',
        '  "successCriteria": [string] — how to know the goal is achieved',
        '}',
        '',
        'Rules:',
        '- Tasks should be ordered logically (design → scaffold → features → test → deploy)',
        '- Each task must be concrete and executable by an AI tool',
        '- 5-15 tasks is ideal',
        '- Be realistic about time estimates',
        '- Return ONLY JSON. No markdown.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Goal: ${goal}\nTimeframe: ${timeframeHours} hours\n\nDecompose this goal into a task graph as JSON.`,
    },
  ]

  const decomposeCompletion = await zai.chat.completions.create({
    messages: decomposeMessages.map((m) =>
      m.role === 'system'
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: m.content },
    ),
    thinking: { type: 'disabled' },
  })

  let taskPlan: { summary?: string; tasks?: Record<string, unknown>[]; deliverables?: string[]; successCriteria?: string[] } = {}
  let taskGraph: Record<string, unknown>[] = []
  let summary = ''
  let deliverables: string[] = []
  let successCriteria: string[] = []

  try {
    const raw = decomposeCompletion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) {
      taskPlan = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      taskGraph = (taskPlan.tasks as Record<string, unknown>[]) || []
      summary = String(taskPlan.summary || '')
      deliverables = (taskPlan.deliverables as string[]) || []
      successCriteria = (taskPlan.successCriteria as string[]) || []
    }
  } catch {
    taskGraph = []
  }

  if (taskGraph.length === 0) {
    return NextResponse.json(
      { error: 'Failed to decompose the goal. Please try again with a more specific goal.' },
      { status: 500 },
    )
  }

  // ── Step 2: Create the goal record ──────────────────────────────
  const { data: goalRecord } = await db.from('god_mode_goals').insert({
    owner_id: user.id,
    goal,
    timeframe_hours: timeframeHours,
    task_graph: JSON.stringify(taskGraph),
    progress: JSON.stringify({
      completedTasks: 0,
      totalTasks: taskGraph.length,
      currentTask: taskGraph[0]?.name || null,
    }),
    current_task: String(taskGraph[0]?.name || ''),
    status: 'running',
  }).select('*').single()

  // ── Step 3: Create a Buildr project + generate initial codebase ──
  const { data: project } = await db.from('projects').insert({
    name: goal.slice(0, 50),
    slug: await uniqueProjectSlug(slugify(goal.slice(0, 40))),
    description: summary || goal.slice(0, 280),
    prompt: goal,
    stack: 'nextjs',
    styling: 'tailwind',
    integrations: JSON.stringify(['nextauth']),
    db_config: JSON.stringify({ engine: 'sqlite', orm: 'prisma' }),
    status: 'draft',
    owner_id: user.id,
  }).select('*').single()

  // Link project to goal
  await db.from('god_mode_goals').update({ project_id: project!.id }).eq('id', goalRecord!.id)

  // Generate the initial project (scaffold + AI code)
  let filesGenerated = 0
  let generationError: string | null = null

  try {
    const result = await generateInitialProject({
      projectId: project.id,
      name: goal.slice(0, 50),
      prompt: goal,
      stack: 'nextjs',
      styling: 'tailwind',
      integrations: ['nextauth'],
      dbConfig: { engine: 'sqlite', orm: 'prisma' },
    })
    filesGenerated = result.files?.length || 0
  } catch (err) {
    generationError = err instanceof Error ? err.message : 'generation_failed'
  }

  // ── Step 4: Update goal progress ─────────────────────────────────
  // Mark the first task (scaffold) as completed + the current task.
  const updatedTasks = taskGraph.map((t, i) => {
    if (i === 0) return { ...t, status: 'completed' }
    if (i === 1) return { ...t, status: 'running' }
    return t
  })

  const completedCount = updatedTasks.filter((t) => t.status === 'completed').length
  const currentTaskName = updatedTasks.find((t) => t.status === 'running')?.name || null

  await db.from('god_mode_goals').update({
    task_graph: JSON.stringify(updatedTasks),
    progress: JSON.stringify({
      completedTasks: completedCount,
      totalTasks: updatedTasks.length,
      currentTask: currentTaskName,
    }),
    current_task: String(currentTaskName || ''),
    status: generationError ? 'failed' : 'running',
    result_summary: generationError
      ? `Initial generation failed: ${generationError}. The goal has been marked as failed.`
      : `${summary} — ${filesGenerated} files generated so far. The agent is continuing.`,
  }).eq('id', goalRecord!.id)

  // Track usage.
  await trackUsage(user.id, 'godmode_goals', 1, { goalId: goalRecord!.id, timeframeHours })
  await trackUsage(user.id, 'projects', 1, { projectId: project!.id, via: 'god-mode' })

  return NextResponse.json({
    ok: true,
    goalId: goalRecord!.id,
    projectId: project!.id,
    status: generationError ? 'failed' : 'running',
    summary,
    taskGraph: updatedTasks,
    deliverables,
    successCriteria,
    filesGenerated,
    message: `God Mode activated! ${updatedTasks.length} tasks queued. ${filesGenerated} files generated so far.`,
  }, { status: 201 })
}
