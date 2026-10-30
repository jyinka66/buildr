// POST /api/auth/register — create a new user account.
// Hashes the password with bcrypt, creates the user, and returns 201.
// The client then calls signIn('credentials') to establish a session.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { trustedClientIp } from '@/lib/rate-limit'

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

  const passwordHash = await bcrypt.hash(password, 10)
  const { data: user, error: insertError } = await db
    .from('users')
    .insert({ email, name, password: passwordHash })
    .select('id, email, name')
    .single()

  if (insertError || !user) {
    return NextResponse.json({ error: 'account_creation_failed' }, { status: 500 })
  }
  return NextResponse.json({ user }, { status: 201 })
}
