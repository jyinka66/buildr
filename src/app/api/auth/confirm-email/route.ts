// Supabase Auth confirmation bridge for Buildr's existing credentials system.
// Supabase verifies the email; this endpoint verifies the access token with Auth
// before marking the corresponding legacy Buildr account as verified.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limit = rateLimit(`supabase-confirm:${ip}`, { limit: 20, windowMs: 10 * 60 * 1000 })
  if (!limit.ok) return rateLimitedResponse(limit.resetMs)

  const body = await req.json().catch(() => null) as { accessToken?: string } | null
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : ''
  if (!accessToken || accessToken.length > 16_384) {
    return NextResponse.json({ error: 'A valid confirmation token is required.' }, { status: 400 })
  }

  // Never trust an email or "verified" flag supplied by the browser. Ask
  // Supabase Auth to validate the bearer token and confirmation state.
  const { data, error } = await db.auth.getUser(accessToken)
  const authUser = data?.user
  if (error || !authUser?.email || !authUser.email_confirmed_at) {
    return NextResponse.json({ error: 'Supabase could not confirm this email link. It may be expired or already used.' }, { status: 400 })
  }

  const email = authUser.email.trim().toLowerCase()
  const { data: updated, error: updateError } = await db
    .from('users')
    .update({ email_verified: true, verify_token: null })
    .eq('email', email)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('Failed to sync Supabase email confirmation to Buildr account:', updateError.message)
    return NextResponse.json({ error: 'Your email was confirmed, but Buildr could not finish activating the account. Please retry or contact support.' }, { status: 503 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'No pending Buildr account matches this confirmed email address.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, message: 'Email confirmed. You can now sign in to Buildr.' }, {
    headers: { 'cache-control': 'no-store' },
  })
}
