// PATCH /api/admin/users/[id] — update a user (admin only)
// Body: { isDisabled?: boolean, isAdmin?: boolean }
//
// Admin can:
//   - Disable a user (blocks login).
//   - Promote/demote another user to admin.
//   - Cannot disable/demote themselves (safety).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'
import { audit } from '@/lib/snapshot'

interface PatchBody {
  isDisabled?: boolean
  isAdmin?: boolean
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let admin
  try {
    admin = await requireAdmin()
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    throw err
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  // Safety: an admin cannot disable or demote themselves.
  if (id === admin.id) {
    return NextResponse.json(
      { error: 'You cannot modify your own admin status or disabled flag.' },
      { status: 400 },
    )
  }

  const body = (await req.json()) as PatchBody
  const patch: Record<string, unknown> = {}
  if (typeof body.isDisabled === 'boolean') patch.is_disabled = body.isDisabled
  if (typeof body.isAdmin === 'boolean') patch.is_admin = body.isAdmin

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data: user, error } = await db
    .from('users')
    .update(patch)
    .eq('id', id)
    .select('id, email, name, is_admin, is_disabled')
    .single()

  if (error || !user) {
    return NextResponse.json({ error: error?.message || 'not_found' }, { status: 404 })
  }

  await audit('admin.update_user', {
    targetUserId: id,
    targetEmail: user.email,
    changes: patch,
  }, admin.id)

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.is_admin,
      isDisabled: user.is_disabled,
    },
  })
}
