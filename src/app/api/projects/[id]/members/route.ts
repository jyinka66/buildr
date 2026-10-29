// GET    /api/projects/[id]/members — list project members
// POST   /api/projects/[id]/members — invite a member by email (sets role)
// PATCH  /api/projects/[id]/members — change a member's role
// DELETE /api/projects/[id]/members?userId=<id> — remove a member
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

async function assertOwnership(id: string) {
  const user = await requireSessionUser()
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return { user, status: 404 } as const
  if (project.owner_id !== user.id) return { user, status: 403 } as const
  return { user, status: 200 } as const
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let owner
  try {
    owner = await assertOwnership(id)
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  if (owner.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (owner.status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // The owner is always a member (role: owner).
  const { data: project } = await db
    .from('projects')
    .select('owner_id, users!projects_owner_id_fkey(id, email, name)')
    .eq('id', id)
    .single()

  const { data: members, error } = await db
    .from('project_members')
    .select('id, user_id, role, created_at, users!project_members_user_id_fkey(email, name)')
    .eq('project_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ownerUser = project?.users as { id?: string; email?: string; name?: string } | null
  const allMembers = [
    {
      id: 'owner',
      user_id: project?.owner_id,
      role: 'owner',
      email: ownerUser?.email || '',
      name: ownerUser?.name || null,
      created_at: null,
    },
    ...(members ?? []).map((m: Record<string, unknown>) => {
      const u = m.users as { email?: string; name?: string } | null
      return {
        id: m.id as string,
        user_id: m.user_id as string,
        role: m.role as string,
        email: u?.email || '',
        name: u?.name || null,
        created_at: m.created_at as string,
      }
    }),
  ]

  return NextResponse.json({ members: allMembers })
}

interface InviteBody {
  email: string
  role: 'editor' | 'viewer'
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    const o = await assertOwnership(id)
    user = o.user
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json()) as InviteBody
  const email = body.email?.trim().toLowerCase()
  const role = body.role === 'editor' ? 'editor' : 'viewer'

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }

  // Find the user by email.
  const { data: invitee } = await db
    .from('users')
    .select('id, email, name')
    .eq('email', email)
    .maybeSingle()

  if (!invitee) {
    return NextResponse.json(
      { error: `No Buildr account found with email ${email}. They need to register first.` },
      { status: 404 },
    )
  }

  // Check if already a member.
  const { data: existing } = await db
    .from('project_members')
    .select('id')
    .eq('project_id', id)
    .eq('user_id', invitee.id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'User is already a member.' }, { status: 409 })
  }

  const { error } = await db.from('project_members').insert({
    project_id: id,
    user_id: invitee.id,
    role,
    invited_by: user.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await audit('project.member_invite', { email, role }, user.id, id)

  return NextResponse.json({
    ok: true,
    member: { email: invitee.email, name: invitee.name, role },
  }, { status: 201 })
}

interface PatchBody {
  userId: string
  role: 'editor' | 'viewer'
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const o = await assertOwnership(id)
    if (o.status !== 200) return NextResponse.json({ error: 'forbidden' }, { status: o.status })
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json()) as PatchBody
  const role = body.role === 'editor' ? 'editor' : 'viewer'

  await db
    .from('project_members')
    .update({ role })
    .eq('project_id', id)
    .eq('user_id', body.userId)

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const o = await assertOwnership(id)
    if (o.status !== 200) return NextResponse.json({ error: 'forbidden' }, { status: o.status })
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const url = new URL(req.url)
  const userId = url.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  await db.from('project_members').delete().eq('project_id', id).eq('user_id', userId)
  return NextResponse.json({ ok: true })
}
