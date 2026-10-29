// POST /api/auth/verify-email — validates a verification token.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // Rate limit: 20 verification attempts per 10 min per IP.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = rateLimit(`verify:${ip}`, { limit: 20, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { token } = (await req.json()) as { token?: string }
  if (!token) {
    return NextResponse.json({ error: 'token is required.' }, { status: 400 })
  }

  const { data: user } = await db
    .from('users')
    .select('id, verify_token')
    .eq('verify_token', token)
    .maybeSingle()

  if (!user || !user.verify_token || user.verify_token !== token) {
    return NextResponse.json({ error: 'Invalid verification token.' }, { status: 400 })
  }

  await db
    .from('users')
    .update({ email_verified: true, verify_token: null })
    .eq('id', user.id)

  return NextResponse.json({ ok: true, message: 'Email verified. You can now sign in.' })
}
