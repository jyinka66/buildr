// GET /api/god-mode/[id]/status — detailed progress for a goal.
//
// Returns the full task graph + progress + current task.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  const { data: goal } = await db
    .from('god_mode_goals')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (!goal) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const taskGraph = JSON.parse(goal.task_graph || '[]') as Record<string, unknown>[]
  const progress = JSON.parse(goal.progress || '{}') as Record<string, unknown>

  return NextResponse.json({
    goal: {
      id: goal.id,
      goal: goal.goal,
      timeframeHours: goal.timeframe_hours,
      status: goal.status,
      currentTask: goal.current_task,
      resultSummary: goal.result_summary,
      projectId: goal.project_id,
      createdAt: new Date(goal.created_at).toISOString(),
    },
    taskGraph: taskGraph.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tool: t.tool,
      dependencies: t.dependencies,
      estimatedMinutes: t.estimatedMinutes,
      status: t.status || 'pending',
    })),
    progress: {
      completedTasks: (progress.completedTasks as number) || 0,
      totalTasks: (progress.totalTasks as number) || taskGraph.length,
      currentTask: progress.currentTask as string | null,
    },
  })
}
