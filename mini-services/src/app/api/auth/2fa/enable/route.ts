// POST /api/auth/2fa/enable — Step 1: generate secret + QR URL (does NOT enable yet)
// GET  /api/auth/2fa/enable — returns 2FA status
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { generateSecret, buildOtpAuthUrl } from '@/lib/totp'

export async function GET() {
  try {
    const user = await requireSessionUser()
    const { data: u } = await db.from('users').select('totp_enabled').eq('id', user.id).maybeSingle()
    return NextResponse.json({ enabled: Boolean(u?.totp_enabled) })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}

export async function POST() {
  try {
    const user = await requireSessionUser()
    const secret = generateSecret()
    await db.from('users').update({ totp_secret: secret }).eq('id', user.id)
    return NextResponse.json({ secret, otpauthUrl: buildOtpAuthUrl(secret, user.email), manualKey: secret.replace(/(.{4})/g, '$1 ').trim() })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
