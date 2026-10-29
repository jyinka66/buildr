// POST /api/leads/[id]/convert — convert a lead into a freelance job.
// ------------------------------------------------------------------
// Auth: requireSessionUser() + lead ownership.
//
// Reads the lead (name, email, requirements, budget), inserts a new job row
// using the same shape as /api/jobs POST, then marks the lead as converted:
//   status='converted', converted_job_id, converted_at=now.
//
// Returns: { ok, jobId, lead: updatedLead }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'

interface ConvertBody {
  jobType?: string
  title?: string
}

const VALID_JOB_TYPES = new Set([
  'website',
  'api',
  'mobile',
  'ecommerce',
  'dashboard',
  'blog',
  'landing',
  'portfolio',
  'saas',
])

function mapLeadRow(row: Record<string, unknown>): Record<string, unknown> {
  const notesRaw = row.notes
  const notes = Array.isArray(notesRaw) ? notesRaw : []
  const utm = row.utm_data && typeof row.utm_data === 'object' ? row.utm_data : {}
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id ?? null,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    company: row.company ?? null,
    source: row.source ?? 'organic',
    campaignId: row.campaign_id ?? null,
    trackingId: row.tracking_id ?? null,
    utmData: utm,
    requirements: row.requirements ?? null,
    budget: typeof row.budget === 'number' ? row.budget : null,
    status: row.status ?? 'new',
    convertedJobId: row.converted_job_id ?? null,
    convertedAt: row.converted_at ? new Date(row.converted_at as string).toISOString() : null,
    notes,
    createdAt: row.created_at ? new Date(row.created_at as string).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  }
}

export async function POST(
  req: NextRequest,
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

  // Verify ownership.
  const { data: leadRow, error: leadErr } = await db
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (leadErr || !leadRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const lead = leadRow as Record<string, unknown>

  // Already converted? Return the existing job id.
  const existingJobId = (lead.converted_job_id as string | null) ?? null
  if (existingJobId) {
    return NextResponse.json({
      ok: true,
      jobId: existingJobId,
      alreadyConverted: true,
      lead: mapLeadRow(lead),
    })
  }

  // Parse the optional body for title / jobType overrides (no body is fine).
  let body: ConvertBody = {}
  try {
    body = (await req.json()) as ConvertBody
  } catch {
    body = {}
  }

  const leadName = (lead.name as string) || 'Lead'
  const leadEmail = (lead.email as string) || null
  const leadCompany = (lead.company as string) || null
  const requirements = (lead.requirements as string) || null
  const budgetKobo = typeof lead.budget === 'number' ? lead.budget : null

  const jobType = VALID_JOB_TYPES.has(body.jobType || '') ? body.jobType! : 'website'

  // Title: prefer the override, else "Project for {name}" / "Lead: {name}".
  const title =
    (body.title ?? '').trim() ||
    (leadCompany
      ? `Project for ${leadName} (${leadCompany})`
      : `Project for ${leadName}`)

  // Description: combine the lead's requirements + budget context.
  const descriptionParts: string[] = []
  if (requirements) {
    descriptionParts.push(requirements)
  } else {
    descriptionParts.push(`Converted from lead: ${leadName}.`)
  }
  if (leadCompany) descriptionParts.push(`Company: ${leadCompany}.`)
  if (leadEmail) descriptionParts.push(`Client email: ${leadEmail}.`)
  if (budgetKobo && budgetKobo > 0) {
    const naira = (budgetKobo / 100).toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    })
    descriptionParts.push(`Agreed budget: ${naira}.`)
  }
  if ((lead.source as string) && (lead.source as string) !== 'organic') {
    descriptionParts.push(`Lead source: ${lead.source}.`)
  }
  const description = descriptionParts.join(' ')

  // ── Insert the job (same shape as /api/jobs POST, minus AI scope) ────
  const { data: job, error: jobErr } = await db
    .from('jobs')
    .insert({
      owner_id: user.id,
      title,
      description,
      job_type: jobType,
      client_name: leadName,
      client_email: leadEmail,
      scope: JSON.stringify({
        summary: requirements || title,
        source: 'lead',
        leadId: lead.id,
      }),
      tasks: JSON.stringify([]),
      deliverables: JSON.stringify([]),
      status: 'planning',
      budget: budgetKobo ?? null,
      deadline: null,
    })
    .select('*')
    .single()

  if (jobErr || !job) {
    return NextResponse.json(
      { error: jobErr?.message ?? 'job_insert_failed' },
      { status: 500 },
    )
  }

  const jobId = (job as { id: string }).id

  // ── Mark the lead as converted ──────────────────────────────────────
  const { data: updatedLead, error: updateErr } = await db
    .from('leads')
    .update({
      status: 'converted',
      converted_job_id: jobId,
      converted_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('*')
    .single()

  if (updateErr) {
    // The job was created but the lead wasn't marked — surface the job id so
    // the UI can recover gracefully.
    return NextResponse.json(
      {
        ok: true,
        jobId,
        leadUpdateFailed: true,
        error: updateErr.message,
      },
      { status: 200 },
    )
  }

  // ── Optional: record a conversion on the campaign tracking row ─────
  const trackingId = (lead.tracking_id as string | null) ?? null
  if (trackingId) {
    try {
      const { data: trackingRow } = await db
        .from('campaign_tracking')
        .select('id, owner_id, conversions, revenue_kobo')
        .eq('id', trackingId)
        .maybeSingle()
      if (trackingRow) {
        const t = trackingRow as {
          id: string
          owner_id?: string
          conversions?: number
          revenue_kobo?: number
        }
        if (t.owner_id === user.id) {
          await db
            .from('campaign_tracking')
            .update({
              conversions: Number(t.conversions ?? 0) + 1,
              revenue_kobo: Number(t.revenue_kobo ?? 0) + (budgetKobo ?? 0),
              updated_at: new Date().toISOString(),
            })
            .eq('id', t.id)
        }
      }
    } catch {
      // Non-fatal — attribution is best-effort.
    }
  }

  // ── Notify the user ─────────────────────────────────────────────────
  try {
    await notify({
      ownerId: user.id,
      source: 'system',
      severity: 'success',
      title: `Lead converted: ${leadName}`,
      message: `New job "${title}" created from this lead.`,
      actionUrl: `/?view=jobs`,
      metadata: { jobId, leadId: lead.id, title },
    })
  } catch {
    // Non-fatal.
  }

  return NextResponse.json({
    ok: true,
    jobId,
    lead: mapLeadRow(updatedLead as Record<string, unknown>),
  })
}
