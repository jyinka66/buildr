// POST /api/account/delete — permanently delete account (GDPR Article 17)
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { verifyCode } from '@/lib/totp'

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser()
    const { password, totpCode, confirm } = await req.json()
    if (confirm !== 'DELETE') return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 })

    const { data: u } = await db.from('users').select('password, totp_enabled, totp_secret, email').eq('id', user.id).maybeSingle()
    if (!u || !(await bcrypt.compare(password, u.password))) return NextResponse.json({ error: 'Incorrect password.' }, { status: 400 })
    if (u.totp_enabled && (!totpCode || !u.totp_secret || !verifyCode(u.totp_secret, totpCode))) return NextResponse.json({ error: 'Invalid 2FA code.' }, { status: 400 })

    // Keep only a timestamp in the surviving audit record; identifiers and
    // email addresses would make this record pseudonymous, not anonymous.
    const deletedAt = new Date().toISOString()
    const { error: auditError } = await db.from('audit_log').insert({
      user_id: null,
      action: 'account.delete',
      details: JSON.stringify({ deletedAt }),
    })
    if (auditError) {
      return NextResponse.json({ error: 'account_deletion_audit_failed' }, { status: 500 })
    }

    // Delete the user (cascade deletes everything) and report failure honestly.
    const { error: deleteError } = await db.from('users').delete().eq('id', user.id)
    if (deleteError) {
      return NextResponse.json({ error: 'account_deletion_failed' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, message: 'Account permanently deleted.', deletedAt })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
