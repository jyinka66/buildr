// POST /api/jobs/[id]/milestones — creates milestone-based delivery plan.
// GET /api/jobs/[id]/milestones — lists milestones.
// PATCH body: { milestoneId, action: 'approve'|'reject', feedback? } — client approves/rejects a milestone.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const { id } = await ctx.params
  const { data: job, error } = await db.from('jobs').select('tasks, scope, owner_id').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let tasks: Record<string, unknown>[] = []
  try { tasks = JSON.parse(job.tasks || '[]') } catch { tasks = [] }

  // Group tasks into milestones (every 3-4 tasks = 1 milestone)
  const milestones: { number: number; name: string; tasks: Record<string, unknown>[]; status: string; paymentPercentage: number }[] = []
  const milestoneNames = ['Discovery & Design', 'Core Development', 'Integrations & Polish', 'Testing & Delivery']
  const paymentSplit = [25, 35, 25, 15]

  for (let i = 0; i < tasks.length; i += 3) {
    const chunk = tasks.slice(i, i + 3)
    const idx = Math.floor(i / 3)
    const allCompleted = chunk.every((t) => t.status === 'completed')
    const anyRunning = chunk.some((t) => t.status === 'running')
    milestones.push({
      number: idx + 1,
      name: milestoneNames[idx] || `Phase ${idx + 1}`,
      tasks: chunk,
      status: allCompleted ? 'completed' : anyRunning ? 'in_progress' : 'pending',
      paymentPercentage: paymentSplit[idx] || 10,
    })
  }

  return NextResponse.json({ milestones })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const { id } = await ctx.params
  const body = await req.json()
  const { milestoneIndex, action, feedback } = body

  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }

  const { data: job, error } = await db.from('jobs').select('tasks, owner_id').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  let tasks: Record<string, unknown>[] = []
  try { tasks = JSON.parse(job.tasks || '[]') } catch { tasks = [] }

  // Update the milestone's tasks (3 tasks per milestone)
  const startIdx = (milestoneIndex as number) * 3
  const endIdx = startIdx + 3
  for (let i = startIdx; i < Math.min(endIdx, tasks.length); i++) {
    if (action === 'approve') {
      tasks[i].status = 'completed'
    } else {
      tasks[i].status = 'pending'
    }
  }

  await db.from('jobs').update({ tasks: JSON.stringify(tasks) }).eq('id', id)

  await notify({
    ownerId: user.id, source: 'system', severity: action === 'approve' ? 'success' : 'warning',
    title: `Milestone ${milestoneIndex + 1} ${action === 'approve' ? 'approved' : 'rejected'}`,
    message: feedback || `Milestone ${milestoneIndex + 1} has been ${action === 'approve' ? 'approved' : 'rejected'}.`,
    actionUrl: '/?view=jobs', metadata: { jobId: id, milestoneIndex, action },
  })

  return NextResponse.json({ ok: true, action, milestoneIndex })
}
