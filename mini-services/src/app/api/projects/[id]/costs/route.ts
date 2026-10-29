// GET /api/projects/[id]/costs — aggregates LLM token usage + estimated
// costs for a project. Reads from the generations table (tokens, duration,
// provider_id) and applies per-provider pricing estimates.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

// Estimated cost per 1K tokens (input + output blended). These are rough
// estimates for planning purposes — actual costs vary by provider.
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  zai: { input: 0.001, output: 0.002 },
  anthropic: { input: 0.003, output: 0.015 },
  openai: { input: 0.005, output: 0.015 },
  google: { input: 0.00125, output: 0.005 },
  deepseek: { input: 0.00014, output: 0.00028 },
  ollama: { input: 0, output: 0 }, // self-hosted — no API cost
}

// Assume 40% input / 60% output split (rough heuristic for code generation).
const INPUT_RATIO = 0.4
const OUTPUT_RATIO = 0.6

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch all generations for this project.
  const { data: generations, error } = await db
    .from('generations')
    .select('id, tokens, duration_ms, provider_id, role, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch provider names.
  const { data: providers } = await db
    .from('llm_providers')
    .select('id, key, name')
  const providerMap = new Map(
    (providers ?? []).map((p: { id: string; key: string; name: string }) => [p.id, p]),
  )

  let totalTokens = 0
  let totalCost = 0
  let totalDurationMs = 0
  const byProvider = new Map<string, { name: string; tokens: number; cost: number; count: number }>()
  const byDay = new Map<string, { tokens: number; cost: number }>()

  for (const gen of generations ?? []) {
    const tokens = Number(gen.tokens) || 0
    if (tokens === 0) continue
    totalTokens += tokens
    totalDurationMs += Number(gen.duration_ms) || 0

    const provider = gen.provider_id ? providerMap.get(gen.provider_id) : null
    const providerKey = provider?.key || 'unknown'
    const providerName = provider?.name || 'Unknown'
    const pricing = COST_PER_1K_TOKENS[providerKey] || COST_PER_1K_TOKENS.zai

    const inputTokens = tokens * INPUT_RATIO
    const outputTokens = tokens * OUTPUT_RATIO
    const cost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output
    totalCost += cost

    // By provider.
    const provEntry = byProvider.get(providerKey) || { name: providerName, tokens: 0, cost: 0, count: 0 }
    provEntry.tokens += tokens
    provEntry.cost += cost
    provEntry.count += 1
    byProvider.set(providerKey, provEntry)

    // By day.
    const day = new Date(gen.created_at).toISOString().slice(0, 10)
    const dayEntry = byDay.get(day) || { tokens: 0, cost: 0 }
    dayEntry.tokens += tokens
    dayEntry.cost += cost
    byDay.set(day, dayEntry)
  }

  return NextResponse.json({
    totals: {
      tokens: totalTokens,
      cost: Math.round(totalCost * 10000) / 10000, // 4 decimal places
      durationMs: totalDurationMs,
      generations: (generations ?? []).filter((g: { tokens: unknown }) => Number(g.tokens) > 0).length,
      avgCostPerGeneration: totalCost / Math.max(1, (generations ?? []).filter((g: { tokens: unknown }) => Number(g.tokens) > 0).length),
    },
    byProvider: Array.from(byProvider.entries()).map(([key, v]) => ({
      providerKey: key,
      providerName: v.name,
      tokens: v.tokens,
      cost: Math.round(v.cost * 10000) / 10000,
      generations: v.count,
    })),
    byDay: Array.from(byDay.entries()).map(([date, v]) => ({
      date,
      tokens: v.tokens,
      cost: Math.round(v.cost * 10000) / 10000,
    })),
    pricing: COST_PER_1K_TOKENS,
    note: 'Costs are estimates based on published pricing. Actual costs may vary.',
  })
}
