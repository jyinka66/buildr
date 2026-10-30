// Billing helper — subscription management + usage tracking + limit enforcement.
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase-server'
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

export interface LimitReservation {
  ok: boolean
  used: number
  limit: number
  reservationId?: string
}

export async function checkLimit(userId: string, metric: UsageMetric): Promise<LimitReservation> {
  let limit = getPlan('free').limits[metric]
  let planId: PlanId
  try {
    const subscription = await getOrCreateSubscription(userId)
    planId = subscription.planId
    limit = getPlan(planId).limits[metric]
  } catch {
    return { ok: false, used: limit, limit }
  }

  // Local demo mode has no Postgres RPCs; retain its non-production behavior.
  if (!isSupabaseConfigured && process.env.NODE_ENV !== 'production') {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    try {
      const { data: rows, error } = await db.from('usage_events').select('quantity').eq('owner_id', userId).eq('metric', metric).gte('created_at', monthStart.toISOString())
      if (error || !rows) return { ok: false, used: limit, limit }
      const used = rows.reduce((sum: number, r: { quantity: number }) => sum + r.quantity, 0)
      return { ok: limit === -1 || used < limit, used, limit }
    } catch {
      return { ok: false, used: limit, limit }
    }
  }

  try {
    // LLM usage is measured in tokens, so reserve all remaining monthly
    // capacity while the generation is in flight. Other metered operations
    // reserve one unit. The reservation is released/committed after the work.
    const { data, error } = await db.rpc('reserve_usage', {
      p_owner_id: userId,
      p_metric: metric,
      p_quantity: metric === 'llm_tokens' ? 0 : 1,
      p_limit: limit,
    })
    const row = (Array.isArray(data) ? data[0] : data) as {
      ok?: boolean
      used?: number
      limit_value?: number
      reserved_quantity?: number
      reservation_id?: string | null
    } | null
    if (error || !row || typeof row.ok !== 'boolean') {
      console.error('[Buildr] atomic quota reservation failed:', error?.message || 'missing RPC result')
      return { ok: false, used: limit, limit }
    }
    return {
      ok: row.ok,
      used: Number(row.used ?? limit),
      limit: Number(row.limit_value ?? limit),
      ...(row.reservation_id ? { reservationId: row.reservation_id } : {}),
    }
  } catch (error) {
    console.error('[Buildr] atomic quota reservation failed:', error instanceof Error ? error.message : 'unknown')
    return { ok: false, used: limit, limit }
  }
}

export async function trackUsage(
  userId: string,
  metric: UsageMetric,
  quantity: number = 1,
  metadata?: { projectId?: string; reservationId?: string; [k: string]: unknown },
): Promise<boolean> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return false
  const cleanMetadata = { ...(metadata || {}) }
  delete cleanMetadata.reservationId

  // Local demo mode uses its local store and does not have SQL RPC support.
  if (!isSupabaseConfigured && process.env.NODE_ENV !== 'production') {
    const { error } = await db.from('usage_events').insert({
      owner_id: userId, metric, quantity,
      project_id: metadata?.projectId || null,
      metadata: cleanMetadata,
    })
    if (error) console.error('[Buildr] trackUsage insert failed:', error.message)
    return !error
  }

  try {
    const { planId } = await getOrCreateSubscription(userId)
    const limit = getPlan(planId).limits[metric]
    const { data, error } = await db.rpc('commit_usage_reservation', {
      p_owner_id: userId,
      p_metric: metric,
      p_quantity: quantity,
      p_limit: limit,
      p_project_id: metadata?.projectId || null,
      p_metadata: cleanMetadata,
      p_reservation_id: metadata?.reservationId || null,
    })
    if (error || data !== true) {
      console.error('[Buildr] usage commit rejected:', error?.message || 'quota reservation expired or actual usage exceeded remaining quota')
      return false
    }
    return true
  } catch (err) {
    console.error('[Buildr] trackUsage failed:', err instanceof Error ? err.message : err)
    return false
  }
}

export async function releaseUsageReservation(userId: string, reservationId?: string): Promise<void> {
  if (!reservationId || !isSupabaseConfigured || process.env.NODE_ENV !== 'production' && !isSupabaseConfigured) return
  try {
    const { error } = await db.rpc('release_usage_reservation', {
      p_owner_id: userId,
      p_reservation_id: reservationId,
    })
    if (error) console.error('[Buildr] quota reservation release failed:', error.message)
  } catch (error) {
    console.error('[Buildr] quota reservation release failed:', error instanceof Error ? error.message : 'unknown')
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
