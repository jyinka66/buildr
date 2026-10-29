// GET    /api/marketing/voice/[id] — get a specific voice profile.
// PATCH  /api/marketing/voice/[id] — update a profile (toggle active, edit fields).
// DELETE /api/marketing/voice/[id] — delete a profile.
// ------------------------------------------------------------------
// Auth: requireSessionUser() + verify ownership (owner_id === user.id).
// When PATCH toggles `isActive: true`, every other profile owned by the user
// is deactivated so only one profile is "active" at a time.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean)
    } catch {
      /* ignore */
    }
  }
  return []
}

function toView(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    tone: String(row.tone ?? ''),
    vocabulary: asStringArray(row.vocabulary),
    sentenceStyle: String(row.sentence_style ?? ''),
    emojiUsage: String(row.emoji_usage ?? 'minimal'),
    hashtags: asStringArray(row.hashtags),
    doList: asStringArray(row.do_list),
    dontList: asStringArray(row.dont_list),
    sampleText: String(row.sample_text ?? ''),
    isActive: Boolean(row.is_active ?? false),
    projectId: (row.project_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

// ---------------------------------------------------------------------------
// Load + ownership-check helper. Returns either the row or a NextResponse.
// ---------------------------------------------------------------------------

async function loadOwnedProfile(
  id: string,
  userId: string,
  columns = '*',
): Promise<{ row: Record<string, unknown> | null; response: null | NextResponse }> {
  const { data, error } = await db
    .from('brand_voice_profiles')
    .select(columns)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return {
      row: null,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }
  if (!data) {
    return {
      row: null,
      response: NextResponse.json({ error: 'not_found' }, { status: 404 }),
    }
  }
  const row = data as unknown as Record<string, unknown>
  if (row.owner_id !== userId) {
    return {
      row: null,
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }
  return { row, response: null }
}

// ---------------------------------------------------------------------------
// GET — fetch one profile.
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { id } = await params
  const { row, response } = await loadOwnedProfile(id, user.id)
  if (response) return response
  return NextResponse.json({ profile: toView(row!) })
}

// ---------------------------------------------------------------------------
// PATCH — partial update.
//   Body: { name?, tone?, vocabulary?, sentenceStyle?, emojiUsage?,
//           hashtags?, doList?, dontList?, isActive? }
// ---------------------------------------------------------------------------

interface PatchBody {
  name?: string
  tone?: string
  sentenceStyle?: string
  emojiUsage?: string
  vocabulary?: string[]
  hashtags?: string[]
  doList?: string[]
  dontList?: string[]
  isActive?: boolean
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { id } = await params
  const { row, response } = await loadOwnedProfile(id, user.id)
  if (response) return response
  // Touch the row to confirm we hold a reference; not strictly necessary but
  // keeps TypeScript happy since `row` is non-null here.
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const patch: Record<string, unknown> = {}

  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body.tone === 'string') patch.tone = body.tone.trim()
  if (typeof body.sentenceStyle === 'string') patch.sentence_style = body.sentenceStyle.trim()
  if (typeof body.emojiUsage === 'string') patch.emoji_usage = body.emojiUsage.trim()
  if (Array.isArray(body.vocabulary)) patch.vocabulary = body.vocabulary.map(String).filter(Boolean)
  if (Array.isArray(body.hashtags)) patch.hashtags = body.hashtags.map(String).filter(Boolean)
  if (Array.isArray(body.doList)) patch.do_list = body.doList.map(String).filter(Boolean)
  if (Array.isArray(body.dontList)) patch.dont_list = body.dontList.map(String).filter(Boolean)
  if (typeof body.isActive === 'boolean') patch.is_active = body.isActive

  // If activating this profile, deactivate every other profile the user owns
  // so only one is "active" at a time.
  if (body.isActive === true) {
    try {
      await db
        .from('brand_voice_profiles')
        .update({ is_active: false })
        .eq('owner_id', user.id)
        .neq('id', id)
    } catch {
      /* best-effort; non-fatal */
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_fields_to_update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('brand_voice_profiles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, profile: toView(data as Record<string, unknown>) })
}

// ---------------------------------------------------------------------------
// DELETE — remove a profile.
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { id } = await params
  const { response } = await loadOwnedProfile(id, user.id, 'id,owner_id')
  if (response) return response

  const { error } = await db.from('brand_voice_profiles').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
