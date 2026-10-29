// API key helper — generate, hash, verify personal access tokens.
import { createHash, randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getOrCreateSubscription } from '@/lib/billing'
import { getPlan } from '@/lib/plans'

export type ApiScope = 'projects:read' | 'projects:write' | 'deploy' | 'tickets:write' | 'usage:read' | 'notifications:read' | '*'

const TOKEN_PREFIX = 'bldr_'

export function generateApiKey(): { token: string; tokenHash: string; tokenPrefix: string } {
  const random = randomBytes(24).toString('hex')
  const token = `${TOKEN_PREFIX}${random}`
  return { token, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface ApiKeyAuth { ok: boolean; userId?: string; keyId?: string; error?: string; status?: number }

export async function authenticateApiKey(req: NextRequest, requiredScope: ApiScope): Promise<ApiKeyAuth> {
  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) return { ok: false, error: 'missing_bearer_token', status: 401 }
  const token = authHeader.slice(7).trim()
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, error: 'invalid_token_format', status: 401 }

  const tokenHash = hashToken(token)
  const { data: key, error } = await db.from('api_keys').select('id, owner_id, scopes, revoked_at, expires_at, request_count').eq('token_hash', tokenHash).maybeSingle()

  if (error || !key) return { ok: false, error: 'invalid_token', status: 401 }
  if (key.revoked_at) return { ok: false, error: 'token_revoked', status: 401 }
  if (key.expires_at && new Date(key.expires_at as string) < new Date()) return { ok: false, error: 'token_expired', status: 401 }

  const scopes = (key.scopes as string[]) || []
  if (!scopes.includes('*') && !scopes.includes(requiredScope)) return { ok: false, error: 'insufficient_scope', status: 403 }

  const sub = await getOrCreateSubscription(key.owner_id as string)
  if (getPlan(sub.planId).id === 'free') return { ok: false, error: 'api_access_requires_paid_plan', status: 403 }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  Promise.resolve(db.from('api_keys').update({ last_used_at: new Date().toISOString(), last_used_ip: ip, request_count: ((key.request_count as number) || 0) + 1 }).eq('id', key.id)).catch(() => {})

  return { ok: true, userId: key.owner_id as string, keyId: key.id as string }
}
