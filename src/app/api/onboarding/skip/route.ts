// POST /api/onboarding/skip — skip onboarding
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function POST() {
  try {
    const user = await requireSessionUser()
    await db.from('users').update({ onboarding_completed: true, onboarding_step: 'done', onboarding_skipped_at: new Date() }).eq('id', user.id)
    return NextResponse.json({ ok: true, completed: true, skipped: true })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
