// /api/workspaces/[id]/members/[memberId] — per-member management.
// ------------------------------------------------------------------
//   PATCH  — accept / decline an invite, or change role.
//            ?action=accept  | decline | change_role (with role= in body)
//   DELETE — remove a member (or revoke a pending invite).
//
// Session-gated via requireSessionUser(). Authorization:
//   - accept/decline: only the invited user (the member row's userId).
//   - change_role/remove: only workspace owner or admin.
//   - owner role cannot be removed via this endpoint (transfer flow
//     would go elsewhere).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const VALID_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
type Role = (typeof VALID_ROLES)[number]

function isRole(s: string): s is Role {
  return (VALID_ROLES as readonly string[]).includes(s)
}

function canManage(role: string): boolean {
  return role === 'owner' || role === 'admin'
}

interface MemberRow {
  id: string
  workspace_id: string
  user_id: string
  role: string
  invited_by: string | null
  invited_email: string | null
  status: string
  joined_at: string
}

interface UserMini {
  id: string
  email: string
  name: string | null
}

function serializeMember(row: MemberRow, user: UserMini | null) {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    invitedBy: row.invited_by,
    invitedEmail: row.invited_email,
    status: row.status,
    joinedAt: row.joined_at,
    email: user?.email ?? row.invited_email ?? '',
    name: user?.name ?? null,
  }
}

async function fetchMemberWithUser(memberId: string): Promise<{ member: MemberRow; user: UserMini | null } | null> {
  const { data: member, error } = await db
    .from('workspace_members')
    .select('*')
    .eq('id', memberId)
    .maybeSingle()

  if (error || !member) return null
  const memberRow = member as MemberRow

  const { data: user } = await db
    .from('users')
    .select('id, email, name')
    .eq('id', memberRow.user_id)
    .maybeSingle()

  return { member: memberRow, user: (user as UserMini | null) ?? null }
}

// ---------------------------------------------------------------------------
// PATCH — accept / decline / change_role.
// ---------------------------------------------------------------------------

interface PatchBody {
  action?: 'accept' | 'decline' | 'change_role'
  role?: string
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; memberId: string }> },
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

  const { id, memberId } = await ctx.params
  if (!id || !memberId) {
    return NextResponse.json({ error: 'id and memberId are required.' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const action = body.action || 'accept'

  const existing = await fetchMemberWithUser(memberId)
  if (!existing || existing.member.workspace_id !== id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const target = existing.member

  // accept / decline — only the invited user can do this.
  if (action === 'accept' || action === 'decline') {
    if (target.user_id !== user.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const newStatus = action === 'accept' ? 'active' : 'removed'
    const { data: updated, error: updateError } = await db
      .from('workspace_members')
      .update({ status: newStatus })
      .eq('id', memberId)
      .select('*')
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
    }

    return NextResponse.json({
      member: serializeMember(updated as MemberRow, existing.user),
    })
  }

  // change_role — owner/admin only.
  if (action === 'change_role') {
    const { data: actor, error: actorError } = await db
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (actorError || !actor || !canManage(actor.role)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const role = body.role && isRole(body.role) ? body.role : null
    if (!role) {
      return NextResponse.json(
        { error: 'Please provide a valid role.' },
        { status: 400 },
      )
    }
    // Don't allow demoting the last owner.
    if (target.role === 'owner' && role !== 'owner') {
      const { count: ownerCount } = await db
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', id)
        .eq('role', 'owner')
        .eq('status', 'active')
      if ((ownerCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last owner. Transfer ownership first.' },
          { status: 400 },
        )
      }
    }
    // Don't allow promoting to owner via this endpoint.
    if (role === 'owner') {
      return NextResponse.json(
        { error: 'Use the ownership transfer flow to assign a new owner.' },
        { status: 400 },
      )
    }
    const { data: updated, error: updateError } = await db
      .from('workspace_members')
      .update({ role })
      .eq('id', memberId)
      .select('*')
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
    }

    return NextResponse.json({
      member: serializeMember(updated as MemberRow, existing.user),
    })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

// ---------------------------------------------------------------------------
// DELETE — remove a member (or revoke a pending invite).
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; memberId: string }> },
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

  const { id, memberId } = await ctx.params
  if (!id || !memberId) {
    return NextResponse.json({ error: 'id and memberId are required.' }, { status: 400 })
  }

  const { data: target, error: targetError } = await db
    .from('workspace_members')
    .select('id, user_id, role, workspace_id, status')
    .eq('id', memberId)
    .maybeSingle()

  if (targetError || !target || target.workspace_id !== id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Self-removal is allowed (except for owners — they must transfer first).
  if (target.user_id === user.id) {
    if (target.role === 'owner') {
      return NextResponse.json(
        { error: 'Owners cannot leave without transferring ownership.' },
        { status: 400 },
      )
    }
    const { error: updateError } = await db
      .from('workspace_members')
      .update({ status: 'removed' })
      .eq('id', memberId)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // Otherwise, must be an admin/owner.
  const { data: actor, error: actorError } = await db
    .from('workspace_members')
    .select('id, role')
    .eq('workspace_id', id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (actorError || !actor || !canManage(actor.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Owners can only be removed by other owners, and the last owner
  // cannot be removed at all (must transfer first).
  if (target.role === 'owner') {
    if (actor.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only an owner can remove another owner.' },
        { status: 403 },
      )
    }
    const { count: ownerCount } = await db
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', id)
      .eq('role', 'owner')
      .eq('status', 'active')
    if ((ownerCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last owner. Transfer ownership first.' },
        { status: 400 },
      )
    }
  }

  const { error: updateError } = await db
    .from('workspace_members')
    .update({ status: 'removed' })
    .eq('id', memberId)
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
