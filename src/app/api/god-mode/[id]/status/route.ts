// GET /api/god-mode/[id]/status — same detail as GET /api/god-mode/[id]
// (kept so existing callers keep working).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/god-mode/http'
import { toGoalDetail, type GoalRow } from '@/lib/god-mode/view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await authenticate()
  if (user instanceof NextResponse) return user
  const { id } = await ctx.params
  const { data } = await db.from('god_mode_goals').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(toGoalDetail(data as GoalRow))
}
