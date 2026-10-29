// POST /api/auth/register — create a new user account.
// Hashes the password with bcrypt, creates the user, and returns 201.
// The client then calls signIn('credentials') to establish a session.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

interface RegisterBody {
  email?: string
  password?: string
  name?: string
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 registrations per IP per 15 minutes.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = rateLimit(`register:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterMs: rl.resetMs },
      { status: 429, headers: { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) } },
    )
  }

  const body = (await req.json()) as RegisterBody
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  const name = body.name?.trim() || null

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters.' },
      { status: 400 },
    )
  }

  const { data: existing } = await db.from('users').select('id').eq('email', email).maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'An account with that email already exists.' },
      { status: 409 },
    )
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const { data: user } = await db
    .from('users')
    .insert({ email, name, password: passwordHash })
    .select('id, email, name')
    .single()

  return NextResponse.json({ user }, { status: 201 })
}
