// Signed, short-lived OAuth state for the "connect a social account" flow.
//
// The start route stores { platform, nonce, PKCE verifier, user id, expiry } in an httpOnly
// cookie signed with HMAC-SHA256, and sends only the nonce to the platform as `state`. The
// callback accepts the code only when the cookie signature is valid, it has not expired,
// the nonce matches the returned `state`, and the signed-in user is the one who started it.
// That blocks forged callbacks (CSRF) and linking an account to someone else's session.
//
// No alias imports: runs under plain `node --test`.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const OAUTH_COOKIE = 'buildr_social_oauth'
export const OAUTH_TTL_SECONDS = 10 * 60

export interface OAuthState {
  platform: string
  nonce: string
  verifier: string
  userId: string
  /** Unix seconds. */
  exp: number
}

const b64 = (buf: Buffer) => buf.toString('base64url')

function sign(payload: string, secret: string): string {
  return b64(createHmac('sha256', secret).update(payload).digest())
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64(randomBytes(48))
  return { verifier, challenge: b64(createHash('sha256').update(verifier).digest()) }
}

export function createState(input: { platform: string; userId: string; verifier?: string }, now = Date.now()): OAuthState {
  return {
    platform: input.platform,
    nonce: b64(randomBytes(24)),
    verifier: input.verifier ?? '',
    userId: input.userId,
    exp: Math.floor(now / 1000) + OAUTH_TTL_SECONDS,
  }
}

export function encodeState(state: OAuthState, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify(state)))
  return `${payload}.${sign(payload, secret)}`
}

export type StateCheck = { ok: true; state: OAuthState } | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'mismatch' }

export function verifyState(
  cookie: string | undefined,
  secret: string,
  expected: { platform: string; stateParam: string | null; userId: string },
  now = Date.now(),
): StateCheck {
  if (!cookie) return { ok: false, reason: 'missing' }
  const [payload, signature] = cookie.split('.')
  if (!payload || !signature) return { ok: false, reason: 'invalid' }
  const good = Buffer.from(sign(payload, secret))
  const given = Buffer.from(signature)
  if (good.length !== given.length || !timingSafeEqual(good, given)) return { ok: false, reason: 'invalid' }
  let state: OAuthState
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof state.exp !== 'number' || state.exp * 1000 < now) return { ok: false, reason: 'expired' }
  const nonce = Buffer.from(state.nonce ?? '')
  const param = Buffer.from(expected.stateParam ?? '')
  const nonceOk = nonce.length > 0 && nonce.length === param.length && timingSafeEqual(nonce, param)
  if (!nonceOk || state.platform !== expected.platform || state.userId !== expected.userId) return { ok: false, reason: 'mismatch' }
  return { ok: true, state }
}
