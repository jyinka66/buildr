// /api/api-keys — Manage personal API keys.
// ------------------------------------------------------------------
//   GET  — list the user's keys. NEVER returns the token (only prefix).
//   POST — create a new key. Returns the token ONCE in the response.
//          Subsequent GETs will only show the prefix.
//
// Session-gated via requireSessionUser().

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { generateApiKey, type ApiScope } from '@/lib/api-key'

const ALL_SCOPES: ApiScope[] = [
  'projects:read',
  'projects:write',
  'deploy',
  'tickets:write',
  'usage:read',
  'notifications:read',
  '*',
]

interface ApiKeyRow {
  id: string
  name: string
  token_prefix: string
  scopes: string
  last_used_at: string | null
  last_used_ip: string | null
  request_count: number
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

function serialize(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes || '[]') as string[],
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    requestCount: row.request_count,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list keys (never returns the token).
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

  const { data: rows, error } = await db
    .from('api_keys')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ keys: ((rows as ApiKeyRow[] | null) ?? []).map(serialize) })
}

// ---------------------------------------------------------------------------
// POST — create a key (returns token once).
// ---------------------------------------------------------------------------

interface CreateBody {
  name?: string
  scopes?: string[]
  expiresAt?: string | null
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

  // Validate scopes — drop anything that isn't on the allowlist.
  const requestedScopes = Array.isArray(body.scopes) ? body.scopes : []
  const scopes = requestedScopes
    .map((s) => String(s))
    .filter((s) => (ALL_SCOPES as string[]).includes(s)) as ApiScope[]

  if (scopes.length === 0) {
    return NextResponse.json(
      { error: 'Please select at least one scope.' },
      { status: 400 },
    )
  }

  // Parse optional expiry (ISO 8601 string). Reject past dates.
  let expiresAt: Date | null = null
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt)
    if (!Number.isNaN(parsed.getTime())) {
      if (parsed.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: 'Expiration must be in the future.' },
          { status: 400 },
        )
      }
      expiresAt = parsed
    }
  }

  const { token, tokenHash, tokenPrefix } = generateApiKey()

  const { data: keyRow, error } = await db
    .from('api_keys')
    .insert({
      owner_id: user.id,
      name,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes: JSON.stringify(scopes),
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    })
    .select('*')
    .single()

  if (error || !keyRow) {
    return NextResponse.json({ error: error?.message || 'create_failed' }, { status: 500 })
  }

  return NextResponse.json(
    {
      key: serialize(keyRow as ApiKeyRow),
      // Returned ONCE. The client must persist this — GET will never show it.
      token,
      message: 'Copy this token now. It will not be shown again.',
    },
    { status: 201 },
  )
}
