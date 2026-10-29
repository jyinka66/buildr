// Billing helper — subscription management + usage tracking + limit enforcement.
import { db } from '@/lib/db'
import { getPlan, type PlanId, type UsageMetric } from '@/lib/plans'

export async function getOrCreateSubscription(userId: string): Promise<{ planId: PlanId }> {
  try {
    const { data: existing } = await db.from('subscriptions').select('*').eq('owner_id', userId).maybeSingle()
    if (existing) return { planId: existing.plan_id as PlanId }

    await db.from('subscriptions').insert({ owner_id: userId, plan_id: 'free', status: 'active' })
    return { planId: 'free' }
  } catch { return { planId: 'free' } }
}

export async function checkLimit(userId: string, metric: UsageMetric): Promise<{ ok: boolean; used: number; limit: number }> {
  const { planId } = await getOrCreateSubscription(userId)
  const plan = getPlan(planId)
  const limit = plan.limits[metric]
  if (limit === -1) return { ok: true, used: 0, limit: -1 }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  try {
    const { data: rows } = await db.from('usage_events').select('quantity').eq('owner_id', userId).eq('metric', metric).gte('created_at', monthStart.toISOString())
    const used = (rows ?? []).reduce((sum: number, r: { quantity: number }) => sum + r.quantity, 0)
    return { ok: used < limit, used, limit }
  } catch { return { ok: true, used: 0, limit } }
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
      const { data: rows } = await db.from('usage_events').select('quantity').eq('owner_id', userId).eq('metric', metric).gte('created_at', monthStart.toISOString())
      const used = (rows ?? []).reduce((sum: number, r: { quantity: number }) => sum + r.quantity, 0)
      usage[metric] = { used, limit, unlimited: false }
    } catch { usage[metric] = { used: 0, limit, unlimited: false } }
  }

  return { plan: planId, usage }
}
