// /api/v1/usage — Public API for usage metering.
// ------------------------------------------------------------------
//   GET — return the API key owner's monthly usage + plan info.
//         scope: usage:read
//
// Authenticated via Bearer token using authenticateApiKey(req, 'usage:read').
// Uses getMonthlyUsage() from @/lib/billing so the response shape matches
// the session-based /api/billing/usage endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api-key'
import { getMonthlyUsage } from '@/lib/billing'
import { getPlan } from '@/lib/plans'

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req, 'usage:read')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  const usage = await getMonthlyUsage(auth.userId!)
  const plan = getPlan(usage.plan)

  return NextResponse.json({
    ok: true,
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
