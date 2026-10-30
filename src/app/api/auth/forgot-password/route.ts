// POST /api/auth/forgot-password — generates a reset token and emails it.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { sendEmail, passwordResetHtml } from '@/lib/email'
import { distributedRateLimit, rateLimitedResponse, trustedClientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const ip = trustedClientIp(req.headers)
  const rl = await distributedRateLimit(`forgot:${ip}`, { limit: 3, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { email } = (await req.json()) as { email?: string }
  const normalized = email?.trim().toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }

  // Always return success to prevent email enumeration.
  const { data: user } = await db
    .from('users')
    .select('id, name, email')
    .eq('email', normalized)
    .maybeSingle()

  if (user) {
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    await db
      .from('users')
      .update({ reset_token: token, reset_expires: expires.toISOString() })
      .eq('id', user.id)

    const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const resetUrl = `${appUrl}/?reset=${token}`
    await sendEmail({
      to: user.email,
      subject: 'Reset your Buildr password',
      html: passwordResetHtml(user.name || '', resetUrl),
    })
  }

  return NextResponse.json({
    ok: true,
    message: 'If an account exists with that email, a reset link has been sent.',
  })
}
