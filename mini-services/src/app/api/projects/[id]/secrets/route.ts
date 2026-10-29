// GET    /api/projects/[id]/secrets — list secret keys (values masked)
// POST   /api/projects/[id]/secrets — upsert a secret (encrypt value)
// DELETE /api/projects/[id]/secrets  — delete a secret by key (query ?key=...)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { encrypt, isEncryptionActive } from '@/lib/crypto'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

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

  const { data: secrets, error } = await db
    .from('project_secrets')
    .select('id, key, updated_at')
    .eq('project_id', id)
    .order('key', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    secrets: (secrets ?? []).map((s: { id: string; key: string; updated_at: string }) => ({
      id: s.id,
      key: s.key,
      updatedAt: new Date(s.updated_at).toISOString(),
    })),
    encryptionActive: isEncryptionActive(),
  })
}

interface UpsertBody {
  key: string
  value: string
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
  const rl = rateLimit(`secrets:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as UpsertBody
  const key = body.key?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const value = body.value
  if (!key || !value) {
    return NextResponse.json({ error: 'key and value are required.' }, { status: 400 })
  }

  const encrypted = encrypt(value)

  const { data: existing } = await db
    .from('project_secrets')
    .select('id')
    .eq('project_id', id)
    .eq('key', key)
    .maybeSingle()

  if (existing) {
    await db
      .from('project_secrets')
      .update({ value: encrypted, updated_at: new Date().toISOString() })
      .eq('project_id', id)
      .eq('key', key)
  } else {
    await db.from('project_secrets').insert({
      project_id: id,
      key,
      value: encrypted,
    })
  }

  await audit('secret.upsert', { key }, user.id, id)

  return NextResponse.json({ ok: true, key, masked: '••••••••' })
}

export async function DELETE(
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
  const url = new URL(req.url)
  const key = url.searchParams.get('key')?.trim().toUpperCase()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  await db.from('project_secrets').delete().eq('project_id', id).eq('key', key)
  await audit('secret.delete', { key }, user.id, id)
  return NextResponse.json({ ok: true })
}
