// POST /api/auth/2fa/verify — Step 2: verify code + enable 2FA + return backup codes ONCE
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse } from '@/lib/rate-limit'
import { verifyCode, generateBackupCodes, hashBackupCode } from '@/lib/totp'

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser()
    const rl = await distributedRateLimit(`2fa-verify:${user.id}`, { limit: 10, windowMs: 15 * 60 * 1000 })
    if (!rl.ok) return rateLimitedResponse(rl.resetMs)
    const { code } = await req.json()
    if (!code || !/^\d{6}$/.test(code)) return NextResponse.json({ error: '6-digit code required.' }, { status: 400 })

    const { data: u } = await db.from('users').select('totp_secret, totp_enabled').eq('id', user.id).maybeSingle()
    if (u?.totp_enabled) return NextResponse.json({ error: '2FA already enabled.' }, { status: 400 })
    if (!u?.totp_secret) return NextResponse.json({ error: 'No pending 2FA setup. Call /enable first.' }, { status: 400 })
    if (!verifyCode(u.totp_secret, code)) return NextResponse.json({ error: 'Invalid code.' }, { status: 400 })

    const backupCodes = generateBackupCodes()
    await db.from('users').update({ totp_enabled: true, totp_backup_codes: JSON.stringify(backupCodes.map(hashBackupCode)) }).eq('id', user.id)
    return NextResponse.json({ ok: true, enabled: true, backupCodes, warning: 'Save these backup codes. They will not be shown again.' })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
