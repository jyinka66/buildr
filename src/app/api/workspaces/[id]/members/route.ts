// /api/workspaces/[id]/members — workspace member management.
// ------------------------------------------------------------------
//   GET  — list members of a workspace (must be a member to read).
//   POST — invite a member by email. Looks up the user; if found,
//          creates a "pending" WorkspaceMember row. If not found,
//          the invite is stored against the email and resolved when
//          the user later registers / signs in.
//
// Session-gated via requireSessionUser(). Acting user must be a member
// of the workspace; only owner/admin can invite.

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
  is_disabled: boolean
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

// ---------------------------------------------------------------------------
// GET — list members.
// ---------------------------------------------------------------------------

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
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  // Caller must be a member (any status) of the workspace.
  const { data: membership, error: mError } = await db
    .from('workspace_members')
    .select('id, role')
    .eq('workspace_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (mError || !membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: rows, error: rowsError } = await db
    .from('workspace_members')
    .select('*')
    .eq('workspace_id', id)
    .order('joined_at', { ascending: true })

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 })
  }

  const memberRows = (rows as MemberRow[] | null) ?? []
  const userIds = Array.from(new Set(memberRows.map((m) => m.user_id)))
  const usersById = new Map<string, UserMini>()
  if (userIds.length) {
    const { data: users } = await db
      .from('users')
      .select('id, email, name, is_disabled')
      .in('id', userIds)
    for (const u of (users as UserMini[] | null) ?? []) {
      usersById.set(u.id, u)
    }
  }

  return NextResponse.json({
    members: memberRows.map((m) => serializeMember(m, usersById.get(m.user_id) ?? null)),
  })
}

// ---------------------------------------------------------------------------
// POST — invite by email.
// ---------------------------------------------------------------------------

interface InviteBody {
  email?: string
  role?: string
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
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  // Acting user must be an admin/owner of the workspace.
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

  const body = (await req.json().catch(() => ({}))) as InviteBody
  const email = body.email?.trim().toLowerCase() || ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Please provide a valid email address.' },
      { status: 400 },
    )
  }

  const role: Role = body.role && isRole(body.role) ? body.role : 'member'
  if (role === 'owner') {
    return NextResponse.json(
      { error: 'Cannot invite a new owner. Transfer ownership instead.' },
      { status: 400 },
    )
  }

  // Try to resolve the invitee to a registered user.
  const { data: invitee, error: inviteeError } = await db
    .from('users')
    .select('id, email, name, is_disabled')
    .eq('email', email)
    .maybeSingle()

  if (inviteeError) {
    return NextResponse.json({ error: inviteeError.message }, { status: 500 })
  }

  if ((invitee as UserMini | null)?.is_disabled) {
    return NextResponse.json(
      { error: 'That account is disabled.' },
      { status: 400 },
    )
  }

  // If the invitee is already a member, return the existing row.
  let existing: MemberRow | null = null
  if (invitee) {
    const { data: existingRow } = await db
      .from('workspace_members')
      .select('*')
      .eq('workspace_id', id)
      .eq('user_id', invitee.id)
      .maybeSingle()
    existing = (existingRow as MemberRow | null) ?? null
  }
  if (existing) {
    const inv = invitee as UserMini
    return NextResponse.json({
      member: serializeMember(existing, { id: inv.id, email: inv.email, name: inv.name, is_disabled: inv.is_disabled }),
      alreadyMember: true,
    })
  }

  // Create a "pending" membership. If the invitee isn't registered yet,
  // we still record the row with invitedEmail set so we can resolve it
  // when they later sign up. userId is required by the schema though, so
  // for unknown emails we surface a clear message rather than creating a
  // dangling row.
  if (!invitee) {
    return NextResponse.json(
      {
        error: 'user_not_registered',
        message: 'That user has not signed up yet. Ask them to create an account first.',
      },
      { status: 404 },
    )
  }

  const { data: member, error: memberError } = await db
    .from('workspace_members')
    .insert({
      workspace_id: id,
      user_id: invitee.id,
      role,
      invited_by: user.id,
      invited_email: email,
      status: 'pending',
    })
    .select('*')
    .single()

  if (memberError || !member) {
    return NextResponse.json({ error: memberError?.message || 'member_create_failed' }, { status: 500 })
  }

  const inv = invitee as UserMini
  return NextResponse.json(
    {
      member: serializeMember(member as MemberRow, { id: inv.id, email: inv.email, name: inv.name, is_disabled: inv.is_disabled }),
    },
    { status: 201 },
  )
}
