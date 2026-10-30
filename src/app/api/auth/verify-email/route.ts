// Email verification endpoint: GET handles emailed links; POST remains for API clients.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function tokenIsFresh(token: string): boolean {
  const timestamp = Number(token.split('.', 1)[0])
  return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp >= 0 && Date.now() - timestamp <= TOKEN_TTL_MS
}

async function verifyToken(token: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!token || !tokenIsFresh(token)) return { ok: false, reason: 'This verification link is invalid or has expired. Please register again or request a new link.' }
  const { data: user, error } = await db
    .from('users')
    .select('id, verify_token, email_verified')
    .eq('verify_token', token)
    .maybeSingle()
  if (error) return { ok: false, reason: 'We could not verify this link right now. Please try again later.' }
  if (!user || user.verify_token !== token) return { ok: false, reason: 'This verification link is invalid or has already been used.' }
  const { data: updated, error: updateError } = await db
    .from('users')
    .update({ email_verified: true, verify_token: null })
    .eq('id', user.id)
    .eq('verify_token', token)
    .select('id')
    .maybeSingle()
  if (updateError) return { ok: false, reason: 'We could not complete verification. Please try again later.' }
  if (!updated) return { ok: false, reason: 'This verification link has already been used.' }
  return { ok: true }
}

function page(message: string, success: boolean): NextResponse {
  const safeMessage = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const color = success ? '#059669' : '#b91c1c'
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buildr email verification</title><body style="font-family:system-ui,sans-serif;background:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px"><main style="max-width:480px;background:white;padding:32px;border-radius:16px;box-shadow:0 8px 30px #0001"><h1 style="color:${color}">${success ? 'Email verified' : 'Verification failed'}</h1><p>${safeMessage}</p><a href="/" style="display:inline-block;margin-top:12px;background:#059669;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Return to Buildr</a></main></body></html>`
  return new NextResponse(html, { status: success ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

function rateLimitRequest(req: NextRequest): NextResponse | null {
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = rateLimit(`verify:${ip}`, { limit: 20, windowMs: 600_000 })
  return rl.ok ? null : rateLimitedResponse(rl.resetMs)
}

export async function GET(req: NextRequest) {
  const limited = rateLimitRequest(req)
  if (limited) return limited
  const token = req.nextUrl.searchParams.get('token') || ''
  const result = await verifyToken(token)
  return page(result.ok ? 'Your email address is confirmed. You can now sign in to Buildr.' : result.reason, result.ok)
}

export async function POST(req: NextRequest) {
  const limited = rateLimitRequest(req)
  if (limited) return limited
  const body = await req.json().catch(() => null) as { token?: string } | null
  const token = body?.token || ''
  if (!token) return NextResponse.json({ error: 'token is required.' }, { status: 400 })
  const result = await verifyToken(token)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })
  return NextResponse.json({ ok: true, message: 'Email verified. You can now sign in.' })
}
