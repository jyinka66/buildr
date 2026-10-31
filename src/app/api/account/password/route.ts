// POST /api/account/password — change the password of the signed-in user.
// Needs the current password (and a 2FA code when 2FA is on), so a stolen session alone
// cannot take over the account. Accounts created through Google/GitHub have no usable
// password; they set one through "Forgot password" on the sign-in page.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { verifyCode } from '@/lib/totp'
import { audit } from '@/lib/snapshot'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  // Guessing the current password through this endpoint must stay expensive.
  const rl = await distributedRateLimit(`pwchange:${user.id}`, { limit: 8, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json().catch(() => null)) as
    | { currentPassword?: unknown; newPassword?: unknown; totpCode?: unknown }
    | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  const { currentPassword, newPassword, totpCode } = body
  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || !newPassword) {
    return NextResponse.json({ error: 'Enter your current password and a new one.' }, { status: 400 })
  }
  if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.' },
      { status: 400 },
    )
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: 'Choose a password different from the current one.' }, { status: 400 })
  }

  const { data: row, error: lookupError } = await db
    .from('users')
    .select('password, totp_enabled, totp_secret, email')
    .eq('id', user.id)
    .maybeSingle()
  if (lookupError) return NextResponse.json({ error: 'password_change_lookup_failed' }, { status: 503 })
  if (!row || !(await bcrypt.compare(currentPassword, row.password))) {
    return NextResponse.json({ error: 'Your current password is incorrect.' }, { status: 400 })
  }
  if (row.totp_enabled) {
    if (typeof totpCode !== 'string' || !totpCode.trim() || !row.totp_secret || !verifyCode(row.totp_secret, totpCode.trim())) {
      return NextResponse.json({ error: 'Enter a valid 6-digit code from your authenticator app.' }, { status: 400 })
    }
  }

  const hash = await bcrypt.hash(newPassword, 10)
  const { error: updateError } = await db
    .from('users')
    // A pending reset link must not outlive a password change.
    .update({ password: hash, reset_token: null, reset_expires: null })
    .eq('id', user.id)
  if (updateError) return NextResponse.json({ error: 'password_change_failed' }, { status: 500 })

  await audit('user.password_change', { email: row.email }, user.id)
  return NextResponse.json({ ok: true, message: 'Password updated.' })
}
