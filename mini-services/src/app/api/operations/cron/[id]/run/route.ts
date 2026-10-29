// POST /api/operations/cron/[id]/run — execute a cron job.
// ------------------------------------------------------------------
// 1. Loads the cron job (owned by the session user).
// 2. Marks lastStatus='running'.
// 3. Runs the job's prompt through the ZAI SDK.
// 4. Updates lastStatus ('success' | 'failed'), lastOutput, runCount,
//    failCount, lastRunAt, nextRunAt.
// 5. Records a MonitoringEvent (kind='cron', status reflects outcome).
// 6. Emits a notification on failure so the user can react.
//
// Note: this route is invoked manually ("Run Now") or by the scheduler
// worker when nextRunAt falls due.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

interface CronJobRow {
  id: string
  name: string
  description: string
  prompt: string
  schedule: string
  schedule_cron: string | null
  enabled: boolean
  project_id: string | null
  run_count: number
  fail_count: number
}

interface ProjectRow {
  id: string
  name: string
  prompt: string
  stack: string
  status: string
  deployment_url: string | null
  preview_url: string | null
}

function computeNextRunAt(schedule: string, scheduleCron?: string | null): Date | null {
  const now = new Date()
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
      return scheduleCron ? new Date(now.getTime() + 60 * 60 * 1000) : null
    default:
      return null
  }
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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

  const { data: jobRow, error: jobError } = await db
    .from('cron_jobs')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (jobError || !jobRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const job = jobRow as CronJobRow

  // Mark running.
  await db.from('cron_jobs').update({ last_status: 'running', last_output: '' }).eq('id', job.id)

  const startedAt = Date.now()
  let status: 'success' | 'failed' = 'success'
  let output = ''
  let errorMsg: string | null = null

  try {
    const zai = await ZAI.create()

    // Build context — include the linked project's prompt + a brief file
    // manifest so the model can act meaningfully on the project.
    let projectContext = ''
    let project: ProjectRow | null = null
    if (job.project_id) {
      const { data: p } = await db
        .from('projects')
        .select('id, name, prompt, stack, status, deployment_url, preview_url')
        .eq('id', job.project_id)
        .eq('owner_id', user.id)
        .maybeSingle()
      if (p) {
        project = p as ProjectRow
        const { count: fileCount } = await db
          .from('project_files')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id)
        projectContext = [
          `Linked project: ${project.name} (stack: ${project.stack}, status: ${project.status})`,
          `Project prompt: ${project.prompt.slice(0, 280)}`,
          `Files in project: ${fileCount ?? 0}`,
          project.deployment_url ? `Deployment URL: ${project.deployment_url}` : '',
          project.preview_url ? `Preview URL: ${project.preview_url}` : '',
        ].filter(Boolean).join('\n')
      }
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are an autonomous operations agent running on a recurring schedule.',
          'Execute the user\'s prompt and return a concise plain-text report of what you did.',
          'Rules:',
          '- Be specific and factual. Reference real file paths, URLs, or values when relevant.',
          '- If you cannot complete the task, explain why in 1-2 sentences.',
          '- Do not include markdown fences. Plain text only.',
          '- Keep the report under ~600 words.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Cron job name: ${job.name}`,
          job.description ? `Description: ${job.description}` : '',
          projectContext ? `\nContext:\n${projectContext}` : '',
          '',
          'Prompt to execute:',
          job.prompt,
          '',
          'Return your plain-text report now.',
        ].filter(Boolean).join('\n'),
      },
    ]

    const completion = await zai.chat.completions.create({
      messages: messages.map((m) =>
        m.role === 'system'
          ? { role: 'assistant' as const, content: m.content }
          : { role: 'user' as const, content: m.content },
      ),
      thinking: { type: 'disabled' },
    })

    output = (completion.choices[0]?.message?.content ?? '').trim()
    if (!output) {
      output = '(empty output)'
    }
  } catch (err) {
    status = 'failed'
    errorMsg = err instanceof Error ? err.message : 'execution_failed'
    output = `Execution failed: ${errorMsg}`
  }

  const durationMs = Date.now() - startedAt

  // Persist results (compute incremented counters from the loaded job row).
  const newRunCount = (job.run_count ?? 0) + 1
  const newFailCount = (job.fail_count ?? 0) + (status === 'failed' ? 1 : 0)
  const nextRunAt = job.enabled ? computeNextRunAt(job.schedule, job.schedule_cron) : null

  const { data: updated, error: updateError } = await db
    .from('cron_jobs')
    .update({
      last_status: status,
      last_output: output.slice(0, 8000), // cap stored output
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunAt ? nextRunAt.toISOString() : null,
      run_count: newRunCount,
      fail_count: newFailCount,
    })
    .eq('id', job.id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
  }
  const updatedRow = updated as CronJobRow & {
    last_run_at: string | null
    next_run_at: string | null
    last_output: string
    last_status: string
  }

  // Record a monitoring event for this cron run.
  try {
    await db.from('monitoring_events').insert({
      owner_id: user.id,
      project_id: job.project_id,
      kind: 'cron',
      status: status === 'success' ? 'ok' : 'down',
      message: status === 'success'
        ? `Cron "${job.name}" completed in ${durationMs}ms.`
        : `Cron "${job.name}" failed: ${errorMsg || 'unknown'}`,
      url: null,
      response_ms: durationMs,
      status_code: status === 'success' ? 200 : 500,
      metadata: JSON.stringify({
        cronJobId: job.id,
        schedule: job.schedule,
        outputPreview: output.slice(0, 200),
      }),
    })
  } catch {
    /* non-fatal */
  }

  // Notification on failure.
  if (status === 'failed') {
    try {
      await db.from('notifications').insert({
        owner_id: user.id,
        source: 'cron',
        severity: 'error',
        title: `Cron job failed: ${job.name}`,
        message: errorMsg ? `Error: ${errorMsg}` : 'Execution failed.',
        link_type: 'cron',
        link_id: job.id,
        metadata: JSON.stringify({ cronJobId: job.id }),
      })
    } catch {
      /* non-fatal */
    }
  }

  await trackUsage(user.id, 'llm_tokens', 1, { via: 'cron-run', cronJobId: job.id, status })

  return NextResponse.json({
    ok: status === 'success',
    status,
    output,
    durationMs,
    job: {
      id: updatedRow.id,
      lastStatus: updatedRow.last_status,
      lastOutput: updatedRow.last_output,
      runCount: updatedRow.run_count,
      failCount: updatedRow.fail_count,
      lastRunAt: updatedRow.last_run_at,
      nextRunAt: updatedRow.next_run_at,
    },
  })
}
