// POST /api/auth/resend-verification: re-send the Supabase confirmation email for an
// account that has not verified yet. Always answers the same way, so it cannot be used
// to discover which emails are registered.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse, trustedClientIp } from '@/lib/rate-limit'

const GENERIC = { ok: true, message: 'If that account is waiting for verification, a new confirmation email has been sent.' }

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }

  const ip = trustedClientIp(req.headers)
  if (ip !== 'unknown' && ip !== 'development') {
    const ipLimit = await distributedRateLimit(`resend-ip:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 })
    if (!ipLimit.ok) return rateLimitedResponse(ipLimit.resetMs)
  }
  // Tight per-address limit so the endpoint cannot be used to spam a mailbox.
  const emailLimit = await distributedRateLimit(`resend-email:${email}`, { limit: 3, windowMs: 15 * 60 * 1000 })
  if (!emailLimit.ok) return NextResponse.json(GENERIC)

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Email confirmation is not configured. Please try again later.' }, { status: 503 })
  }

  let origin: string
  try {
    const configured = process.env.NEXTAUTH_URL
    if (process.env.NODE_ENV === 'production' && !configured) throw new Error('NEXTAUTH_URL is required')
    origin = new URL(configured || req.nextUrl.origin).origin
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('HTTPS is required')
  } catch {
    return NextResponse.json({ error: 'Email confirmation is not configured. Please try again later.' }, { status: 503 })
  }

  const { data: user, error } = await db.from('users').select('id, email_verified, is_disabled').eq('email', email).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not look up the account. Please try again.' }, { status: 503 })

  if (user && user.email_verified !== true && !user.is_disabled) {
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const { error: resendError } = await authClient.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: new URL('/auth/confirm-email', origin).toString() },
    })
    if (resendError) console.error('[Buildr] resend verification failed:', resendError.message)
  }
  return NextResponse.json(GENERIC)
}
