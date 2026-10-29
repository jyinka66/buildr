// POST /api/auth/2fa/check — pre-login check: verifies password + returns requires2fa
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 10 login attempts per IP per 15 minutes.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = rateLimit(`login:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 })
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', retryAfterMs: rl.resetMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
    )
  }

  const body = await req.json()
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  if (!email || !password) return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 400 })

  const { data: user } = await db
    .from('users')
    .select('id, password, is_disabled, totp_enabled')
    .eq('email', email)
    .maybeSingle()
  if (!user || !(await bcrypt.compare(password, user.password))) return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })
  if (user.is_disabled) return NextResponse.json({ ok: false, error: 'account_disabled' }, { status: 403 })
  return NextResponse.json({ ok: true, requires2fa: user.totp_enabled })
}
