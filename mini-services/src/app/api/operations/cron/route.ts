// /api/operations/cron — 24/7 Operations: cron job management.
// ------------------------------------------------------------------
//   GET    — list the signed-in user's cron jobs
//   POST   — create a new cron job
//   PATCH  — update an existing cron job (name, prompt, schedule, enabled, …)
//   DELETE — delete a cron job by ?id=
//
// All handlers are session-gated via requireSessionUser().

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const VALID_SCHEDULES = ['hourly', 'daily', 'weekly', 'monthly', 'custom']

interface CreateBody {
  name?: string
  description?: string
  prompt?: string
  schedule?: string
  scheduleCron?: string
  projectId?: string
  enabled?: boolean
}

interface PatchBody {
  id?: string
  name?: string
  description?: string
  prompt?: string
  schedule?: string
  scheduleCron?: string
  projectId?: string | null
  enabled?: boolean
}

interface CronJobRow {
  id: string
  name: string
  description: string
  prompt: string
  schedule: string
  schedule_cron: string | null
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  last_status: string
  last_output: string
  run_count: number
  fail_count: number
  project_id: string | null
  created_at: string
  updated_at: string
}

function computeNextRunAt(schedule: string, scheduleCron?: string | null): Date | null {
  const now = new Date()
  // Best-effort scheduling hint. Real cron execution is performed by the
  // scheduler worker that calls /api/operations/cron/[id]/run on tick.
  switch (schedule) {
    case 'hourly':
      return new Date(now.getTime() + 60 * 60 * 1000)
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000)
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    case 'monthly':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    case 'custom':
      // We don't parse arbitrary cron expressions here — leave null and let
      // the scheduler figure out the next tick.
      return scheduleCron ? new Date(now.getTime() + 60 * 60 * 1000) : null
    default:
      return null
  }
}

function serialize(row: CronJobRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    schedule: row.schedule,
    scheduleCron: row.schedule_cron,
    enabled: row.enabled,
    projectId: row.project_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastOutput: row.last_output,
    runCount: row.run_count,
    failCount: row.fail_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list cron jobs.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') || undefined
  const enabledOnly = searchParams.get('enabled') === 'true'

  let query: any = db.from('cron_jobs').select('*').eq('owner_id', user.id)
  if (projectId) query = query.eq('project_id', projectId)
  if (enabledOnly) query = query.eq('enabled', true)

  const { data: rows, error } = await query.order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ jobs: ((rows as CronJobRow[] | null) ?? []).map(serialize) })
}

// ---------------------------------------------------------------------------
// POST — create a cron job.
// ---------------------------------------------------------------------------

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

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const name = body.name?.trim() || ''
  const prompt = body.prompt?.trim() || ''
  const description = body.description?.trim() || ''
  const schedule = VALID_SCHEDULES.includes(body.schedule || '') ? body.schedule! : 'daily'
  const scheduleCron = body.scheduleCron?.trim() || null
  const enabled = body.enabled !== false

  if (name.length < 3) {
    return NextResponse.json(
      { error: 'Please provide a name (at least 3 characters).' },
      { status: 400 },
    )
  }
  if (prompt.length < 10) {
    return NextResponse.json(
      { error: 'Please provide a prompt (at least 10 characters).' },
      { status: 400 },
    )
  }

  // Optional project ownership check.
  let projectId: string | null = null
  if (body.projectId) {
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', body.projectId)
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    }
    projectId = project.id
  }

  const nextRunAt = computeNextRunAt(schedule, scheduleCron)

  const { data: job, error } = await db
    .from('cron_jobs')
    .insert({
      owner_id: user.id,
      project_id: projectId,
      name,
      description,
      prompt,
      schedule,
      schedule_cron: scheduleCron,
      enabled,
      next_run_at: nextRunAt ? nextRunAt.toISOString() : null,
      last_status: 'idle',
    })
    .select('*')
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message || 'create_failed' }, { status: 500 })
  }

  return NextResponse.json({ job: serialize(job as CronJobRow) }, { status: 201 })
}

// ---------------------------------------------------------------------------
// PATCH — update a cron job.
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody
  if (!body.id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  const { data: existing, error: findError } = await db
    .from('cron_jobs')
    .select('*')
    .eq('id', body.id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (findError || !existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const existingRow = existing as CronJobRow

  const data: {
    name?: string
    description?: string
    prompt?: string
    schedule?: string
    schedule_cron?: string | null
    project_id?: string | null
    enabled?: boolean
    next_run_at?: string | null
  } = {}

  if (typeof body.name === 'string' && body.name.trim().length >= 3) {
    data.name = body.name.trim()
  }
  if (typeof body.description === 'string') data.description = body.description.trim()
  if (typeof body.prompt === 'string' && body.prompt.trim().length >= 10) {
    data.prompt = body.prompt.trim()
  }
  if (typeof body.schedule === 'string' && VALID_SCHEDULES.includes(body.schedule)) {
    data.schedule = body.schedule
  }
  if (typeof body.scheduleCron === 'string') {
    data.schedule_cron = body.scheduleCron.trim() || null
  }
  if (body.projectId !== undefined) {
    if (body.projectId === null) {
      data.project_id = null
    } else {
      const { data: project } = await db
        .from('projects')
        .select('id')
        .eq('id', body.projectId)
        .eq('owner_id', user.id)
        .maybeSingle()
      if (!project) {
        return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
      }
      data.project_id = project.id
    }
  }
  if (typeof body.enabled === 'boolean') {
    data.enabled = body.enabled
  }

  // Recompute next run if schedule changed or job was re-enabled.
  const effectiveSchedule = data.schedule ?? existingRow.schedule
  const effectiveCron = data.schedule_cron !== undefined ? data.schedule_cron : existingRow.schedule_cron
  if (data.schedule || data.schedule_cron !== undefined || data.enabled === true) {
    if (data.enabled === false) {
      data.next_run_at = null
    } else {
      const next = computeNextRunAt(effectiveSchedule, effectiveCron)
      data.next_run_at = next ? next.toISOString() : null
    }
  }

  const { data: updated, error: updateError } = await db
    .from('cron_jobs')
    .update(data)
    .eq('id', existingRow.id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({ job: serialize(updated as CronJobRow) })
}

// ---------------------------------------------------------------------------
// DELETE — delete a cron job (?id=).
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  const { data: existing, error: findError } = await db
    .from('cron_jobs')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (findError || !existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { error: deleteError } = await db.from('cron_jobs').delete().eq('id', existing.id)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
