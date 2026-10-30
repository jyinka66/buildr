// POST /api/auth/register — create a pending Buildr account and ask Supabase Auth
// to send its native email-confirmation message. No app session is created here.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
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
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase email confirmation is not configured.' }, { status: 503 })
  }

  let origin: string
  try {
    const configuredOrigin = process.env.NEXTAUTH_URL
    origin = new URL(configuredOrigin || (process.env.NODE_ENV !== 'production' ? req.nextUrl.origin : '')).origin
    if (process.env.NODE_ENV === 'production' && !configuredOrigin) throw new Error('NEXTAUTH_URL is required')
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('HTTPS is required')
  } catch {
    return NextResponse.json({ error: 'Email confirmation is not configured. Please try again later.' }, { status: 503 })
  }

  // Create the app's user row first so a fast confirmation click can never
  // arrive before the corresponding Buildr account exists.
  const passwordHash = await bcrypt.hash(password, 10)
  const { data: user, error: insertError } = await db
    .from('users')
    .insert({ email, name, password: passwordHash, email_verified: false, verify_token: null })
    .select('id, email, name')
    .single()

  if (insertError || !user) {
    return NextResponse.json({ error: 'account_creation_failed' }, { status: 500 })
  }

  // Use only the Supabase publishable/anon key for public Auth operations.
  // The service-role client remains isolated in the existing server DB helper.
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data: authData, error: authError } = await authClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: new URL('/auth/confirm-email', origin).toString(),
      data: { name: name || '' },
    },
  })

  if (authError || !authData.user) {
    await db.from('users').delete().eq('id', user.id)
    return NextResponse.json(
      { error: 'Supabase could not send a confirmation email. Check Supabase Auth email settings and try again.' },
      { status: 503 },
    )
  }

  // Supabase must require a real email confirmation. If Auth returned a session
  // immediately, confirmation is disabled; clean up rather than silently bypass it.
  if (authData.session || authData.user.email_confirmed_at) {
    await db.from('users').delete().eq('id', user.id)
    if (authData.user.id) {
      await db.auth.admin.deleteUser(authData.user.id).catch(() => ({ error: null }))
    }
    return NextResponse.json(
      { error: 'Email confirmation is disabled in Supabase Auth. Enable Confirm email and try again.' },
      { status: 503 },
    )
  }

  // Supabase can return a deliberately obfuscated user for an email that
  // already exists. Do not create a second app account in that case.
  if (Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
    await db.from('users').delete().eq('id', user.id)
    return NextResponse.json(
      { error: 'An account with that email may already exist. Try signing in or resetting your password.' },
      { status: 409 },
    )
  }

  return NextResponse.json(
    { ok: true, message: 'Check your email for a confirmation link from Supabase.' },
    { status: 201 },
  )
}
