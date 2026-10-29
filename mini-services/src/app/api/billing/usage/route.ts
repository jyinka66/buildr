// GET /api/billing/usage — get the current user's monthly usage + plan

import { NextResponse } from 'next/server'
import { requireSessionUser } from '@/lib/session'
import { getMonthlyUsage } from '@/lib/billing'
import { getPlan } from '@/lib/plans'

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const usage = await getMonthlyUsage(user.id)
  const plan = getPlan(usage.plan)

  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      tagline: plan.tagline,
      features: plan.features,
      highlighted: plan.highlighted,
      cta: plan.cta,
    },
    usage: usage.usage,
  })
}
