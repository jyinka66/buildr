// POST /api/api-keys/[id]/revoke — revoke an API key.
// ------------------------------------------------------------------
// Marks revokedAt = now(). The token becomes immediately invalid for all
// future authenticateApiKey() calls. The row is retained for audit history.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

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

  const { data: existing, error } = await db
    .from('api_keys')
    .select('id, revoked_at')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (error || !existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (existing.revoked_at) {
    return NextResponse.json({ ok: true, alreadyRevoked: true })
  }

  const { error: updateError } = await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', existing.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
