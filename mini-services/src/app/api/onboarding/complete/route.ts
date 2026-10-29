// POST /api/onboarding/complete — mark onboarding as completed
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser()
    const { name, role } = await req.json().catch(() => ({}))
    await db.from('users').update({ onboarding_completed: true, onboarding_step: 'done', ...(name?.trim() ? { name: name.trim() } : {}) }).eq('id', user.id)
    await notify({ ownerId: user.id, source: 'system', severity: 'success', title: 'Welcome to Buildr! 🎉', message: 'Your account is set up. Start by creating your first project.', actionUrl: '/?view=dashboard' })
    return NextResponse.json({ ok: true, completed: true })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
