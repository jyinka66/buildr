// POST /api/auth/reset-password — validates a reset token and sets a new password.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 20 reset attempts per 10 min per IP.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = rateLimit(`reset:${ip}`, { limit: 20, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { token, password } = (await req.json()) as { token?: string; password?: string }
  if (!token || !password) {
    return NextResponse.json({ error: 'token and password are required.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const { data: user } = await db
    .from('users')
    .select('id, email, reset_token, reset_expires')
    .eq('reset_token', token)
    .maybeSingle()

  if (!user || !user.reset_token || user.reset_token !== token) {
    return NextResponse.json({ error: 'Invalid or expired reset token.' }, { status: 400 })
  }

  const expires = user.reset_expires ? new Date(user.reset_expires) : null
  if (!expires || expires < new Date()) {
    return NextResponse.json({ error: 'Reset token has expired. Request a new one.' }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 10)
  await db
    .from('users')
    .update({
      password: hash,
      reset_token: null,
      reset_expires: null,
      email_verified: true, // resetting password also verifies the email
    })
    .eq('id', user.id)

  await audit('user.password_reset', { email: user.email }, user.id)

  return NextResponse.json({ ok: true, message: 'Password reset. You can now sign in.' })
}
