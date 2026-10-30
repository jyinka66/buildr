// POST /api/auth/reset-password — validates a reset token and sets a new password.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { audit } from '@/lib/snapshot'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse, trustedClientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 20 reset attempts per 10 min per IP.
  // Shared across instances, and keyed on the trusted client IP only (never a raw header).
  const ip = trustedClientIp(req.headers)
  const rl = await distributedRateLimit(`reset:${ip}`, { limit: 20, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json().catch(() => null)) as { token?: string; password?: string } | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  const { token, password } = body
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token) || typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'A valid token and password are required.' }, { status: 400 })
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return NextResponse.json({ error: 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.' }, { status: 400 })
  }

  const { data: user, error: lookupError } = await db
    .from('users')
    .select('id, email, reset_token, reset_expires')
    .eq('reset_token', token)
    .maybeSingle()

  if (lookupError) return NextResponse.json({ error: 'password_reset_lookup_failed' }, { status: 503 })
  if (!user || !user.reset_token || user.reset_token !== token) {
    return NextResponse.json({ error: 'Invalid or expired reset token.' }, { status: 400 })
  }

  const expires = user.reset_expires ? new Date(user.reset_expires) : null
  if (!expires || expires < new Date()) {
    return NextResponse.json({ error: 'Reset token has expired. Request a new one.' }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 10)
  const { data: updatedUser, error: updateError } = await db
    .from('users')
    .update({
      password: hash,
      reset_token: null,
      reset_expires: null,
      email_verified: true, // resetting password also verifies the email
    })
    .eq('id', user.id)
    .eq('reset_token', token)
    .select('id')
    .maybeSingle()

  if (updateError) return NextResponse.json({ error: 'password_reset_update_failed' }, { status: 500 })
  if (!updatedUser) return NextResponse.json({ error: 'Reset token has already been used.' }, { status: 409 })
  await audit('user.password_reset', { email: user.email }, user.id)

  return NextResponse.json({ ok: true, message: 'Password reset. You can now sign in.' })
}
