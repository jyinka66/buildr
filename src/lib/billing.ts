// Billing helper — subscription management + usage tracking + limit enforcement.
import { db } from '@/lib/db'
import { getPlan, type PlanId, type UsageMetric } from '@/lib/plans'

export async function getOrCreateSubscription(userId: string): Promise<{ planId: PlanId }> {
  try {
    const { data: existing, error: lookupError } = await db.from('subscriptions').select('plan_id').eq('owner_id', userId).maybeSingle()
    if (lookupError) throw new Error('SUBSCRIPTION_LOOKUP_FAILED')
    if (existing) return { planId: existing.plan_id as PlanId }

    const { data: created, error: insertError } = await db
      .from('subscriptions')
      .insert({ owner_id: userId, plan_id: 'free', status: 'active' })
      .select('plan_id')
      .single()
    if (insertError || !created) throw new Error('SUBSCRIPTION_CREATE_FAILED')
    return { planId: created.plan_id as PlanId }
  } catch (error) {
    console.error('[Buildr] subscription lookup failed; denying quota-gated operation:', error instanceof Error ? error.message : 'unknown')
    throw new Error('SUBSCRIPTION_UNAVAILABLE')
  }
}

export async function checkLimit(userId: string, metric: UsageMetric): Promise<{ ok: boolean; used: number; limit: number }> {
  let limit = getPlan('free').limits[metric]
  let planId: PlanId
  try {
    const subscription = await getOrCreateSubscription(userId)
    planId = subscription.planId
    limit = getPlan(planId).limits[metric]
  } catch {
    // Never treat an unavailable subscription database as permission to spend.
    return { ok: false, used: limit, limit }
  }
  if (limit === -1) return { ok: true, used: 0, limit: -1 }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  try {
    const { data: rows, error } = await db.from('usage_events').select('quantity').eq('owner_id', userId).eq('metric', metric).gte('created_at', monthStart.toISOString())
    if (error || !rows) {
      console.error('[Buildr] usage lookup failed; denying quota-gated operation:', error?.message || 'missing usage rows')
      return { ok: false, used: limit, limit }
    }
    const used = rows.reduce((sum: number, r: { quantity: number }) => sum + r.quantity, 0)
    return { ok: used < limit, used, limit }
  } catch (error) {
    console.error('[Buildr] usage lookup failed; denying quota-gated operation:', error instanceof Error ? error.message : 'unknown')
    return { ok: false, used: limit, limit }
  }
}

export async function trackUsage(userId: string, metric: UsageMetric, quantity: number = 1, metadata?: { projectId?: string; [k: string]: unknown }): Promise<void> {
  try {
    await db.from('usage_events').insert({
      owner_id: userId, metric, quantity,
      project_id: metadata?.projectId || null,
      metadata: JSON.stringify(metadata || {}),
    })
  } catch (err) {
    console.error('[Buildr] trackUsage failed:', err instanceof Error ? err.message : err)
  }
}

export async function getMonthlyUsage(userId: string): Promise<{ plan: PlanId; usage: Record<UsageMetric, { used: number; limit: number; unlimited: boolean }> }> {
  const { planId } = await getOrCreateSubscription(userId)
  const plan = getPlan(planId)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const metrics: UsageMetric[] = ['projects', 'llm_tokens', 'businesses', 'godmode_goals', 'images', 'deployments']
  const usage = {} as Record<UsageMetric, { used: number; limit: number; unlimited: boolean }>

  for (const metric of metrics) {
    const limit = plan.limits[metric]
    if (limit === -1) { usage[metric] = { used: 0, limit: -1, unlimited: true }; continue }
    try {
      const { data: rows, error } = await db.from('usage_events').select('quantity').eq('owner_id', userId).eq('metric', metric).gte('created_at', monthStart.toISOString())
      if (error || !rows) {
        console.error('[Buildr] monthly usage lookup failed:', error?.message || 'missing usage rows')
        usage[metric] = { used: limit, limit, unlimited: false }
        continue
      }
      const used = rows.reduce((sum: number, r: { quantity: number }) => sum + r.quantity, 0)
      usage[metric] = { used, limit, unlimited: false }
    } catch (error) {
      console.error('[Buildr] monthly usage lookup failed:', error instanceof Error ? error.message : 'unknown')
      usage[metric] = { used: limit, limit, unlimited: false }
    }
  }

  return { plan: planId, usage }
}
