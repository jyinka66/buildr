// POST /api/auth/2fa/check: pre-login check: verifies the password and reports what the
// sign-in dialog must ask for next (requires2fa) or why the account cannot sign in yet.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse, trustedClientIp } from '@/lib/rate-limit'

// Same dummy hash as src/lib/auth.ts so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = '$2b$10$9JZ.KIVnluPTqvLluZ.U7eL2rOH6aJmM5.LVCQqSMQF/5MgISC9rS'
const WINDOW = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 400 })

  // Separate bucket names from the NextAuth login limiter, so one sign-in (this check
  // plus the credentials callback) does not spend two attempts from the same budget.
  const ip = trustedClientIp(req.headers)
  const ipKnown = ip !== 'unknown' && ip !== 'development'
  if (ipKnown) {
    const ipLimit = await distributedRateLimit(`login-check-ip:${ip}`, { limit: 30, windowMs: WINDOW })
    if (!ipLimit.ok) return rateLimitedResponse(ipLimit.resetMs)
  }
  const tight = await distributedRateLimit(ipKnown ? `login-check:${email}:${ip}` : `login-check:${email}`, { limit: 10, windowMs: WINDOW })
  if (!tight.ok) return rateLimitedResponse(tight.resetMs)
  if (ipKnown) {
    const ceiling = await distributedRateLimit(`login-check:${email}`, { limit: 100, windowMs: WINDOW })
    if (!ceiling.ok) return rateLimitedResponse(ceiling.resetMs)
  }

  const { data: user, error } = await db
    .from('users')
    .select('id, password, is_disabled, email_verified, totp_enabled')
    .eq('email', email)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 503 })

  const passwordOk = await bcrypt.compare(password, user?.password || DUMMY_HASH)
  if (!user || !user.password || !passwordOk) return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })

  // Reported only after the password is proven.
  if (user.is_disabled) return NextResponse.json({ ok: false, error: 'account_disabled' }, { status: 403 })
  if (user.email_verified !== true) return NextResponse.json({ ok: false, error: 'email_not_verified' }, { status: 403 })
  return NextResponse.json({ ok: true, requires2fa: Boolean(user.totp_enabled) })
}
