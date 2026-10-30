// POST /api/auth/register — create a new user account.
// Hashes the password with bcrypt, creates the user, and returns 201.
// The client then calls signIn('credentials') to establish a session.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit, trustedClientIp } from '@/lib/rate-limit'

interface RegisterBody {
  email?: string
  password?: string
  name?: string
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 registrations per IP per 15 minutes.
  const ip = trustedClientIp(req.headers)
  const rl = rateLimit(`register:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.resetMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
    )
  }

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
