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
    // Replacing the secret while 2FA is on would invalidate the user's authenticator
    // and let a stolen session swap the second factor. Require disabling first.
    const { data: current } = await db.from('users').select('totp_enabled').eq('id', user.id).maybeSingle()
    if (current?.totp_enabled) return NextResponse.json({ error: '2FA is already enabled. Disable it first to set up a new authenticator.' }, { status: 409 })
    const secret = generateSecret()
    const { error } = await db.from('users').update({ totp_secret: secret }).eq('id', user.id)
    if (error) return NextResponse.json({ error: 'Could not start 2FA setup.' }, { status: 500 })
    return NextResponse.json({ secret, otpauthUrl: buildOtpAuthUrl(secret, user.email), manualKey: secret.replace(/(.{4})/g, '$1 ').trim() })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
