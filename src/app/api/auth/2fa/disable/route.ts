// POST /api/auth/2fa/disable — disable 2FA (requires code OR password)
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse } from '@/lib/rate-limit'
import { verifyCode } from '@/lib/totp'

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser()
    const rl = await distributedRateLimit(`2fa-disable:${user.id}`, { limit: 10, windowMs: 15 * 60 * 1000 })
    if (!rl.ok) return rateLimitedResponse(rl.resetMs)
    const { code, password } = await req.json()
    const { data: u } = await db.from('users').select('totp_enabled, totp_secret, password').eq('id', user.id).maybeSingle()
    if (!u?.totp_enabled) return NextResponse.json({ error: '2FA not enabled.' }, { status: 400 })

    let verified = false
    if (code && /^\d{6}$/.test(code) && u.totp_secret) verified = verifyCode(u.totp_secret, code)
    if (!verified && password) verified = await bcrypt.compare(password, u.password)
    if (!verified) return NextResponse.json({ error: 'Valid code or password required.' }, { status: 400 })

    await db.from('users').update({ totp_enabled: false, totp_secret: null, totp_backup_codes: null }).eq('id', user.id)
    return NextResponse.json({ ok: true, enabled: false })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
