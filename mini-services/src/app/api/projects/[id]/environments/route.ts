// GET    /api/projects/[id]/environments — list environments + their env var keys (values masked)
// POST   /api/projects/[id]/environments — upsert an env var in a specific environment
// PATCH  /api/projects/[id]/environments — rename an environment or create one
// DELETE /api/projects/[id]/environments?name=<env>&key=<key> — delete an env var or environment
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { encrypt, decrypt } from '@/lib/crypto'

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

  const { data: envs, error } = await db
    .from('project_environments')
    .select('*')
    .eq('project_id', id)
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return env var keys only (values masked).
  const environments = (envs ?? []).map((e: Record<string, unknown>) => {
    const envVars = typeof e.env_vars === 'string' ? JSON.parse(e.env_vars || '{}') : (e.env_vars ?? {})
    const maskedVars: Record<string, string> = {}
    for (const [key, val] of Object.entries(envVars as Record<string, string>)) {
      maskedVars[key] = val ? '••••••••' : ''
    }
    return {
      id: e.id,
      name: e.name,
      envVars: maskedVars,
      keyCount: Object.keys(envVars).length,
      updatedAt: new Date(e.updated_at as string).toISOString(),
    }
  })

  return NextResponse.json({ environments })
}

interface UpsertBody {
  environment: string
  key: string
  value: string
}

export async function POST(
  req: NextRequest,
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

  const body = (await req.json()) as UpsertBody
  const envName = body.environment?.trim()
  const key = body.key?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const value = body.value

  if (!envName || !key || !value) {
    return NextResponse.json({ error: 'environment, key, and value are required.' }, { status: 400 })
  }

  // Fetch or create the environment row.
  const { data: env } = await db
    .from('project_environments')
    .select('id, env_vars')
    .eq('project_id', id)
    .eq('name', envName)
    .maybeSingle()

  const encryptedValue = encrypt(value)

  if (env) {
    const envVars =
      typeof env.env_vars === 'string'
        ? JSON.parse(env.env_vars || '{}')
        : (env.env_vars ?? {})
    envVars[key] = encryptedValue
    await db
      .from('project_environments')
      .update({ env_vars: JSON.stringify(envVars), updated_at: new Date().toISOString() })
      .eq('id', env.id)
  } else {
    await db.from('project_environments').insert({
      project_id: id,
      name: envName,
      env_vars: JSON.stringify({ [key]: encryptedValue }),
    })
  }

  return NextResponse.json({ ok: true, environment: envName, key, masked: '••••••••' })
}

interface PatchBody {
  action: 'create' | 'rename'
  name?: string
  newName?: string
}

export async function PATCH(
  req: NextRequest,
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

  const body = (await req.json()) as PatchBody

  if (body.action === 'create' && body.name) {
    const { data: existing } = await db
      .from('project_environments')
      .select('id')
      .eq('project_id', id)
      .eq('name', body.name)
      .maybeSingle()
    if (!existing) {
      await db.from('project_environments').insert({
        project_id: id,
        name: body.name,
        env_vars: JSON.stringify({}),
      })
    }
    return NextResponse.json({ ok: true, environment: body.name })
  }

  if (body.action === 'rename' && body.name && body.newName) {
    await db
      .from('project_environments')
      .update({ name: body.newName })
      .eq('project_id', id)
      .eq('name', body.name)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
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

  const url = new URL(req.url)
  const envName = url.searchParams.get('name')
  const key = url.searchParams.get('key')

  if (!envName) return NextResponse.json({ error: 'name required' }, { status: 400 })

  if (key) {
    // Delete a single env var from the environment.
    const { data: env } = await db
      .from('project_environments')
      .select('id, env_vars')
      .eq('project_id', id)
      .eq('name', envName)
      .maybeSingle()
    if (env) {
      const envVars =
        typeof env.env_vars === 'string'
          ? JSON.parse(env.env_vars || '{}')
          : (env.env_vars ?? {})
      delete envVars[key]
      await db
        .from('project_environments')
        .update({ env_vars: JSON.stringify(envVars) })
        .eq('id', env.id)
    }
  } else {
    // Delete the entire environment.
    await db.from('project_environments').delete().eq('project_id', id).eq('name', envName)
  }

  return NextResponse.json({ ok: true })
}
