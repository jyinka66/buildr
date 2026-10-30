// POST /api/auth/register — create a new user account.
// Creates a pending account and sends a time-limited email verification link.
// No session is created until the address has been verified.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { trustedClientIp } from '@/lib/rate-limit'
import { emailVerificationHtml, sendEmail } from '@/lib/email'

interface RegisterBody {
  email?: string
  password?: string
  name?: string
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as RegisterBody | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  const name = body.name?.trim() || null

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.' },
      { status: 400 },
    )
  }

  // Only use an IP bucket when the reverse proxy is explicitly trusted.
  // Otherwise rate-limit per normalized email rather than locking out every
  // visitor behind the shared "unknown" address.
  const ip = trustedClientIp(req.headers)
  if (ip !== 'unknown' && ip !== 'development') {
    const ipLimit = await distributedRateLimit(`register-ip:${ip}`, { limit: 20, windowMs: 15 * 60 * 1000 })
    if (!ipLimit.ok) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfterMs: ipLimit.resetMs },
        { status: 429, headers: { 'retry-after': String(Math.ceil(ipLimit.resetMs / 1000)) } },
      )
    }
  }
  const emailLimit = await distributedRateLimit(`register-email:${email}`, { limit: 5, windowMs: 15 * 60 * 1000 })
  if (!emailLimit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: emailLimit.resetMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(emailLimit.resetMs / 1000)) } },
    )
  }

  const { data: existing, error: lookupError } = await db.from('users').select('id').eq('email', email).maybeSingle()
  if (lookupError) {
    return NextResponse.json({ error: 'account_lookup_failed' }, { status: 503 })
  }
  if (existing) {
    return NextResponse.json(
      { error: 'An account with that email already exists.' },
      { status: 409 },
    )
  }

  // In production, generate links only from the configured canonical origin.
  // Do not trust Host/X-Forwarded-Host headers to build security-sensitive links.
  const configuredOrigin = process.env.NEXTAUTH_URL
  let origin: string
  try {
    origin = new URL(configuredOrigin || (process.env.NODE_ENV !== 'production' ? req.nextUrl.origin : '')).origin
    if (process.env.NODE_ENV === 'production' && !configuredOrigin) throw new Error('NEXTAUTH_URL is required')
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('HTTPS is required')
  } catch {
    return NextResponse.json({ error: 'Email verification is not configured. Please try again later.' }, { status: 503 })
  }

  // Timestamped random token: expires after 24 hours and is single-use.
  const verifyToken = `${Date.now()}.${randomBytes(32).toString('hex')}`
  const passwordHash = await bcrypt.hash(password, 10)
  const { data: user, error: insertError } = await db
    .from('users')
    .insert({ email, name, password: passwordHash, email_verified: false, verify_token: verifyToken })
    .select('id, email, name')
    .single()

  if (insertError || !user) {
    return NextResponse.json({ error: 'account_creation_failed' }, { status: 500 })
  }

  const verifyUrl = new URL('/api/auth/verify-email', origin)
  verifyUrl.searchParams.set('token', verifyToken)
  const sent = await sendEmail({
    to: email,
    subject: 'Verify your Buildr email address',
    html: emailVerificationHtml(name || 'there', verifyUrl.toString()),
  })
  if (!sent.ok) {
    console.error('Registration verification email failed:', sent.error)
    // Fail closed: do not leave an account that cannot complete verification.
    await db.from('users').delete().eq('id', user.id)
    return NextResponse.json({ error: 'We could not send your verification email. Please try again later.' }, { status: 503 })
  }

  return NextResponse.json({ ok: true, message: 'Check your email for a verification link.' }, { status: 201 })
}
