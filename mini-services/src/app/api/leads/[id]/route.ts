// /api/leads/[id]
// ------------------------------------------------------------------
// GET    — get lead details (auth + ownership).
// PATCH  — update a lead's status / notes / budget / requirements
//          (auth + ownership).
// DELETE — delete a lead (auth + ownership).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const VALID_STATUSES = new Set(['new', 'contacted', 'qualified', 'converted', 'lost'])

interface PatchBody {
  status?: string
  notes?: string
  budget?: number
  requirements?: string
}

async function requireOwnedLead(id: string, ownerId: string) {
  const { data: lead, error } = await db
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (error || !lead) return null
  return lead as Record<string, unknown>
}

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

export async function GET(
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
  const lead = await requireOwnedLead(id, user.id)
  if (!lead) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ lead: mapLeadRow(lead) })
}

export async function PATCH(
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
  const lead = await requireOwnedLead(id, user.id)
  if (!lead) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Don't allow editing an already-converted lead's status.
  const currentStatus = (lead.status as string) || 'new'

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}

  if (typeof body.status === 'string') {
    const next = body.status.trim().toLowerCase()
    if (!VALID_STATUSES.has(next)) {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    }
    // Can't move a converted lead away from "converted" via this endpoint —
    // conversions are managed by the convert endpoint.
    if (currentStatus === 'converted' && next !== 'converted') {
      return NextResponse.json(
        { error: 'cannot_revert_converted_lead' },
        { status: 409 },
      )
    }
    patch.status = next
  }

  // `notes` (string) — append a single owner note to the notes timeline.
  // Use the dedicated /api/leads/[id]/notes endpoint for richer note-taking.
  if (typeof body.notes === 'string' && body.notes.trim()) {
    const existingNotesRaw = lead.notes
    const existingNotes = Array.isArray(existingNotesRaw) ? existingNotesRaw : []
    const newNote = {
      at: new Date().toISOString(),
      text: body.notes.trim(),
      author: user.email,
    }
    patch.notes = [...existingNotes, newNote]
  }

  if (typeof body.requirements === 'string') {
    patch.requirements = body.requirements.trim() || null
  }

  if (typeof body.budget === 'number' && Number.isFinite(body.budget) && body.budget >= 0) {
    patch.budget = Math.floor(body.budget)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ lead: mapLeadRow(lead) })
  }

  const { data: updated, error } = await db
    .from('leads')
    .update(patch)
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('*')
    .single()

  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? 'update_failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, lead: mapLeadRow(updated as Record<string, unknown>) })
}

export async function DELETE(
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
  const lead = await requireOwnedLead(id, user.id)
  if (!lead) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { error } = await db
    .from('leads')
    .delete()
    .eq('id', id)
    .eq('owner_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
