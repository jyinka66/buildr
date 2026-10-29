// POST /api/leads/[id]/notes — add a note to a lead.
// ------------------------------------------------------------------
// Auth: requireSessionUser() + lead ownership.
// Body: { text: string }
// Appends { at: now, text, author: userEmail } to the lead's notes JSONB
// array. Returns: { ok, note }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface NoteBody {
  text?: string
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

  const rl = rateLimit(`lead-note:${user.id}`, { limit: 60, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { id } = await ctx.params

  // Verify ownership.
  const { data: lead, error } = await db
    .from('leads')
    .select('id, owner_id, notes')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (error || !lead) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: NoteBody
  try {
    body = (await req.json()) as NoteBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: 'text_too_long' }, { status: 400 })
  }

  const existingNotesRaw = (lead as { notes?: unknown }).notes
  const existingNotes = Array.isArray(existingNotesRaw) ? existingNotesRaw : []

  const note = {
    at: new Date().toISOString(),
    text,
    author: user.email,
  }

  const { error: updateErr } = await db
    .from('leads')
    .update({ notes: [...existingNotes, note] })
    .eq('id', id)
    .eq('owner_id', user.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, note }, { status: 201 })
}
