// GET /api/onboarding — returns the user's onboarding status
// POST /api/onboarding — advance to a step
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

const STEPS = ['welcome', 'profile', 'connect', 'tour']

export async function GET() {
  try {
    const user = await requireSessionUser()
    const { data: u } = await db.from('users').select('onboarding_completed, onboarding_step, onboarding_skipped_at').eq('id', user.id).maybeSingle()
    return NextResponse.json({ completed: u?.onboarding_completed || false, step: u?.onboarding_step || 'welcome', skipped: Boolean(u?.onboarding_skipped_at), steps: STEPS })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser()
    const { step } = await req.json()
    if (!STEPS.includes(step)) return NextResponse.json({ error: 'invalid_step' }, { status: 400 })
    await db.from('users').update({ onboarding_step: step }).eq('id', user.id)
    return NextResponse.json({ ok: true, step })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
