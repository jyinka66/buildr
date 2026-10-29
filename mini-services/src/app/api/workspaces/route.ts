// /api/workspaces — Team workspace management.
// ------------------------------------------------------------------
//   GET  — list the user's workspaces (created + joined).
//   POST — create a workspace. Adds the creator as an "owner" member.
//
// Session-gated via requireSessionUser().

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface WorkspaceRow {
  id: string
  slug: string
  name: string
  description: string
  owner_id: string
  plan_id: string
  status: string
  created_at: string
  updated_at: string
}

interface WorkspaceMemberRow {
  id: string
  workspace_id: string
  user_id: string
  role: string
  status: string
  joined_at: string
  workspace: WorkspaceRow
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace'
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data: existing } = await db
      .from('workspaces')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!existing) return candidate
    candidate = `${base}-${i++}`.slice(0, 48)
  }
}

function serializeWorkspace(
  row: WorkspaceRow,
  role: string,
  memberStatus: string,
  memberCount: number,
) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    planId: row.plan_id,
    status: row.status,
    role,
    memberStatus,
    memberCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list the user's workspaces (owned + joined).
// ---------------------------------------------------------------------------

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  // Memberships (joined) — fetch the member rows + their workspaces.
  const { data: memberships, error: mError } = await db
    .from('workspace_members')
    .select('id, workspace_id, user_id, role, status, joined_at')
    .eq('user_id', user.id)
    .in('status', ['active', 'pending'])
    .order('joined_at', { ascending: false })

  if (mError) {
    return NextResponse.json({ error: mError.message }, { status: 500 })
  }

  const memberRows = (memberships as Omit<WorkspaceMemberRow, 'workspace'>[] | null) ?? []
  const workspaceIds = Array.from(new Set(memberRows.map((m) => m.workspace_id)))
  const workspacesById = new Map<string, WorkspaceRow>()
  if (workspaceIds.length) {
    const { data: wsRows } = await db
      .from('workspaces')
      .select('*')
      .in('id', workspaceIds)
    for (const w of (wsRows as WorkspaceRow[] | null) ?? []) {
      workspacesById.set(w.id, w)
    }
  }

  // Member counts per workspace.
  const memberCounts = new Map<string, number>()
  if (workspaceIds.length) {
    for (const wid of workspaceIds) {
      const { count } = await db
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', wid)
      memberCounts.set(wid, count ?? 0)
    }
  }

  const workspaces = memberRows
    .filter((m) => workspacesById.has(m.workspace_id))
    .map((m) => {
      const ws = workspacesById.get(m.workspace_id)!
      return serializeWorkspace(
        ws,
        m.role,
        m.status,
        memberCounts.get(m.workspace_id) ?? 0,
      )
    })

  return NextResponse.json({ workspaces })
}

// ---------------------------------------------------------------------------
// POST — create a workspace + add creator as owner.
// ---------------------------------------------------------------------------

interface CreateBody {
  name?: string
  description?: string
  planId?: string
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const name = body.name?.trim() || ''
  if (name.length < 3) {
    return NextResponse.json(
      { error: 'Please provide a name (at least 3 characters).' },
      { status: 400 },
    )
  }
  const description = body.description?.trim() || ''
  const planId = body.planId || 'free'
  const slug = await uniqueSlug(slugify(name))

  // Create the workspace and the owner membership as sequential inserts
  // (replaces Prisma $transaction; non-atomic but preserves behavior on
  // the happy path).
  const { data: workspace, error: wsError } = await db
    .from('workspaces')
    .insert({
      slug,
      name,
      description,
      owner_id: user.id,
      plan_id: planId,
      status: 'active',
    })
    .select('*')
    .single()

  if (wsError || !workspace) {
    return NextResponse.json({ error: wsError?.message || 'workspace_create_failed' }, { status: 500 })
  }

  const { error: memberError } = await db.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'owner',
    invited_by: user.id,
    status: 'active',
  })

  if (memberError) {
    // Best-effort cleanup: delete the orphan workspace so we don't leave
    // a workspace without an owner membership.
    await db.from('workspaces').delete().eq('id', workspace.id)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  const fresh = workspace as WorkspaceRow
  const { count: memberCount } = await db
    .from('workspace_members')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', fresh.id)

  return NextResponse.json(
    {
      workspace: serializeWorkspace(fresh, 'owner', 'active', memberCount ?? 0),
    },
    { status: 201 },
  )
}
