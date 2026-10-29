// GET  /api/marketing/accounts — list connected social accounts.
// POST /api/marketing/accounts — "connect" a social account (mock OAuth — stores
//   platform + account name only since we don't have real OAuth credentials).
// ------------------------------------------------------------------
// POST body: { platform, accountName }
//   platform ∈ {meta, x, linkedin, instagram, tiktok}
// Inserts into `social_accounts` table.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const VALID_PLATFORMS = new Set(['meta', 'x', 'linkedin', 'instagram', 'tiktok'])

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

function toAccountView(row: Record<string, unknown>) {
  // `metadata` is a JSONB column that may be a string or already-parsed object.
  let metadata: Record<string, unknown> = {}
  const rawMeta = row.metadata
  if (typeof rawMeta === 'string' && rawMeta.trim().startsWith('{')) {
    try {
      metadata = JSON.parse(rawMeta) as Record<string, unknown>
    } catch {
      metadata = {}
    }
  } else if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    metadata = rawMeta as Record<string, unknown>
  }
  return {
    id: row.id,
    platform: row.platform,
    accountName: row.account_name,
    handle: (metadata.handle as string | undefined) ?? null,
    avatarUrl: (metadata.avatarUrl as string | undefined) ?? null,
    connected: row.is_connected ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// GET — list connected social accounts for the authenticated user.
export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { data, error } = await db
    .from('social_accounts')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const accounts = (data || []).map((row: Record<string, unknown>) => toAccountView(row))
  return NextResponse.json({ accounts })
}

interface ConnectBody {
  platform?: string
  accountName?: string
  handle?: string
}

// POST — connect a social account (mock OAuth).
export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as ConnectBody

  const platform = (body.platform || '').toLowerCase().trim()
  const accountName = (body.accountName || '').trim()
  const handle = typeof body.handle === 'string' ? body.handle.trim() : ''

  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json(
      { error: `platform must be one of: ${[...VALID_PLATFORMS].join(', ')}` },
      { status: 400 },
    )
  }
  if (!accountName) {
    return NextResponse.json({ error: 'accountName is required' }, { status: 400 })
  }

  const { data, error } = await db
    .from('social_accounts')
    .insert({
      owner_id: user.id,
      platform,
      account_name: accountName,
      is_connected: true,
      metadata: JSON.stringify({
        ...(handle ? { handle } : {}),
        connectedVia: 'mock-oauth',
      }),
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json(
    { ok: true, account: toAccountView(data as Record<string, unknown>) },
    { status: 201 },
  )
}
