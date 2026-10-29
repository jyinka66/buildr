// POST /api/billing/upgrade — change the user's plan
// Body: { planId: 'free' | 'pro' | 'business' | 'enterprise' }
//
// SECURITY: Until payment integration is wired, plan upgrades are
// ADMIN-ONLY to prevent any logged-in user from granting themselves
// enterprise tier (unlimited everything) for free. When Stripe/etc
// is integrated, this will verify a checkout session instead.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { isUserAdmin } from '@/lib/admin'
import { getOrCreateSubscription } from '@/lib/billing'
import { PLANS, type PlanId } from '@/lib/plans'

interface UpgradeBody {
  planId: string
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  // SECURITY: admin-only until payment integration exists.
  // TODO: replace this check with Stripe checkout session verification
  // when payment integration is implemented.
  const admin = await isUserAdmin(user.id)
  if (!admin) {
    return NextResponse.json(
      {
        error: 'payment_required',
        message: 'Plan upgrades require payment. Contact your admin or wait for payment integration.',
      },
      { status: 402 },
    )
  }

  const body = (await req.json()) as UpgradeBody
  const planId = body.planId as PlanId

  if (!PLANS[planId]) {
    return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
  }

  const current = await getOrCreateSubscription(user.id)

  // Upsert the subscription.
  const { data: existing } = await db.from('subscriptions').select('id').eq('owner_id', user.id).maybeSingle()
  const periodStart = new Date()
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (existing) {
    await db.from('subscriptions').update({
      plan_id: planId,
      status: 'active',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    }).eq('owner_id', user.id)
  } else {
    await db.from('subscriptions').insert({
      owner_id: user.id,
      plan_id: planId,
      status: 'active',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
  }

  return NextResponse.json({
    ok: true,
    subscription: { planId, status: 'active' },
    plan: {
      id: PLANS[planId].id,
      name: PLANS[planId].name,
      priceMonthly: PLANS[planId].priceMonthly,
      features: PLANS[planId].features,
      limits: PLANS[planId].limits,
    },
  })
}
