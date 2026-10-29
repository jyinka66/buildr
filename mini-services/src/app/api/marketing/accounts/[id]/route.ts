// DELETE /api/marketing/accounts/[id] — disconnect a social account.
// ------------------------------------------------------------------
// Auth: requireSessionUser() + verify ownership (owner_id === user.id).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

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

  const { data: existing } = await db
    .from('social_accounts')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { error } = await db.from('social_accounts').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
