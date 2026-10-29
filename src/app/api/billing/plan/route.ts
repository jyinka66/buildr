// GET /api/billing/plan — list all available plans (public, no auth)
// GET /api/billing/plan?which=mine — get the current user's subscription

import { NextResponse } from 'next/server'
import { requireSessionUser } from '@/lib/session'
import { getOrCreateSubscription } from '@/lib/billing'
import { PLAN_LIST } from '@/lib/plans'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const which = url.searchParams.get('which')

  if (which === 'mine') {
    let user
    try {
      user = await requireSessionUser()
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
      throw err
    }
    const sub = await getOrCreateSubscription(user.id)
    return NextResponse.json({ subscription: { planId: sub.planId } })
  }

  return NextResponse.json({
    plans: PLAN_LIST.map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      tagline: p.tagline,
      features: p.features,
      highlighted: p.highlighted || false,
      cta: p.cta,
      limits: p.limits,
    })),
  })
}
