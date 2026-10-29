// GET /api/analytics — aggregated stats for the analytics dashboard.
// Returns: totals (projects, generations, tokens, providers enabled),
// generations over the last 14 days, tokens by provider, most-used
// integrations, and provider health breakdown. All scoped to the
// signed-in user.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { seedProviders } from '@/lib/llm/router'
import { seedIntegrations } from '@/lib/generator/integrations'

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
  await Promise.all([seedProviders(), seedIntegrations()])

  // Fetch all user projects.
  const { data: projects } = await db
    .from('projects')
    .select('id, name, status, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })

  const projectIds = (projects ?? []).map((p: { id: string }) => p.id)

  // Fetch all generations for these projects.
  let generations: Record<string, unknown>[] = []
  if (projectIds.length) {
    const { data: gens } = await db
      .from('generations')
      .select('id, project_id, role, tokens, duration_ms, created_at, provider_id')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(500 as never)
    generations = (gens ?? []) as Record<string, unknown>[]
  }

  // Fetch providers.
  const { data: providers } = await db
    .from('llm_providers')
    .select('*')
    .order('weight', { ascending: false })

  // Fetch integrations.
  const { data: integrations } = await db
    .from('integrations')
    .select('*')
    .order('category', { ascending: true })

  // Fetch audit log entries for the user.
  const { data: audit } = await db
    .from('audit_log')
    .select('action, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200 as never)

  // ---- Compute stats ----------------------------------------------------

  const totalProjects = projects?.length ?? 0
  const totalGenerations = generations.length
  const totalTokens = generations.reduce(
    (sum, g) => sum + (Number(g.tokens) || 0),
    0,
  )
  const totalDurationMs = generations.reduce(
    (sum, g) => sum + (Number(g.duration_ms) || 0),
    0,
  )
  const enabledProviders = (providers ?? []).filter((p: Record<string, unknown>) => p.enabled).length

  // Generations per day for the last 14 days.
  const dayMap = new Map<string, { count: number; tokens: number }>()
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap.set(key, { count: 0, tokens: 0 })
  }
  for (const g of generations) {
    const ts = g.created_at as string
    if (!ts) continue
    const key = new Date(ts).toISOString().slice(0, 10)
    const entry = dayMap.get(key)
    if (entry) {
      entry.count += 1
      entry.tokens += Number(g.tokens) || 0
    }
  }
  const generationsByDay = Array.from(dayMap.entries()).map(([date, v]) => ({ date, count: v.count, tokens: v.tokens }))

  // Tokens by provider.
  const providerTokenMap = new Map<string, number>()
  for (const g of generations) {
    const pid = g.provider_id as string | null
    if (!pid) continue
    providerTokenMap.set(pid, (providerTokenMap.get(pid) || 0) + (Number(g.tokens) || 0))
  }
  const providerNames = new Map((providers ?? []).map((p: Record<string, unknown>) => [p.id, p.name]))
  const tokensByProvider = Array.from(providerTokenMap.entries())
    .map(([pid, tokens]) => ({ provider: providerNames.get(pid) || 'Unknown', tokens }))
    .sort((a, b) => b.tokens - a.tokens)

  // Most-used integrations across projects.
  const integrationCount = new Map<string, number>()
  for (const p of projects ?? []) {
    const raw = (p as Record<string, unknown>).integrations
    let arr: string[] = []
    if (Array.isArray(raw)) arr = raw as string[]
    else if (typeof raw === 'string') {
      try { arr = JSON.parse(raw) } catch { /* ignore */ }
    }
    for (const key of arr) {
      integrationCount.set(key, (integrationCount.get(key) || 0) + 1)
    }
  }
  const integrationNames = new Map((integrations ?? []).map((i: Record<string, unknown>) => [i.key, i.name]))
  const topIntegrations = Array.from(integrationCount.entries())
    .map(([key, count]) => ({ key, name: integrationNames.get(key) || key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  // Provider health breakdown.
  const healthBreakdown = {
    healthy: (providers ?? []).filter((p: Record<string, unknown>) => p.health === 'healthy').length,
    degraded: (providers ?? []).filter((p: Record<string, unknown>) => p.health === 'degraded').length,
    down: (providers ?? []).filter((p: Record<string, unknown>) => p.health === 'down').length,
  }

  // Recent activity (audit log).
  const recentActivity = (audit ?? []).slice(0, 10).map((a: Record<string, unknown>) => ({
    action: a.action,
    time: new Date(a.created_at as string).toISOString(),
  }))

  return NextResponse.json({
    totals: {
      projects: totalProjects,
      generations: totalGenerations,
      tokens: totalTokens,
      durationMs: totalDurationMs,
      enabledProviders,
      totalProviders: providers?.length ?? 0,
      totalIntegrations: integrations?.length ?? 0,
    },
    generationsByDay,
    tokensByProvider,
    topIntegrations,
    healthBreakdown,
    recentActivity,
    projects: (projects ?? []).map((p: Record<string, unknown>) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      updatedAt: new Date(p.updated_at as string).toISOString(),
    })),
  })
}
