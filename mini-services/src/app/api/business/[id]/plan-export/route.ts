// POST /api/business/[id]/plan-export — generates a full business plan with financial projections.
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'
import type { ChatMessage } from '@/lib/llm/router'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const { id } = await ctx.params
  const { data: business, error } = await db.from('businesses').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (error || !business) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const zai = await ZAI.create()

  const planMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert business strategist and financial analyst.',
        'Generate a comprehensive business plan document as JSON.',
        '',
        'Return ONLY a JSON object:',
        '{',
        '  "executiveSummary": string — 2-3 paragraph executive summary',
        '  "marketAnalysis": {',
        '    "tam": string — Total Addressable Market (with estimated dollar value)',
        '    "sam": string — Serviceable Addressable Market (with estimated dollar value)',
        '    "som": string — Serviceable Obtainable Market (with estimated dollar value)',
        '    "marketTrends": [string] — 3-5 current market trends',
        '    "marketGrowthRate": string — estimated annual growth rate',
        '  },',
        '  "financialProjections": {',
        '    "year1": {',
        '      "monthly": [{ "month": string, "revenue": number, "costs": number, "netProfit": number }],',
        '      "totalRevenue": number,',
        '      "totalCosts": number,',
        '      "netProfit": number,',
        '      "burnRate": number,',
        '      "breakEvenMonth": string,',
        '    },',
        '    "year3": { "totalRevenue": number, "totalCosts": number, "netProfit": number },',
        '    "year5": { "totalRevenue": number, "totalCosts": number, "netProfit": number },',
        '  },',
        '  "swot": {',
        '    "strengths": [string],',
        '    "weaknesses": [string],',
        '    "opportunities": [string],',
        '    "threats": [string],',
        '    "actionItems": [string],',
        '  },',
        '  "mvpRoadmap": [{ "phase": string, "features": [string], "timeline": string, "goal": string }],',
        '  "fundingStrategy": {',
        '    "recommendation": string,',
        '    "amountToRaise": string,',
        '    "useOfFunds": [{ "category": string, "amount": string, "percentage": number }],',
        '    "milestones": [string],',
        '    "valuationEstimate": string,',
        '  },',
        '  "risks": [{ "risk": string, "impact": string, "mitigation": string }],',
        '}',
        'Rules: Use REAL numbers. Be realistic. Return ONLY JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Business: ${business.name}\nIdea: ${business.idea}\nMission: ${business.mission}\nTarget audience: ${business.target_audience}\nBusiness model: ${business.business_model}\n\nGenerate a comprehensive business plan with financial projections as JSON.`,
    },
  ]

  const completion = await zai.chat.completions.create({
    messages: planMessages.map((m) => m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }),
    thinking: { type: 'disabled' },
  })

  let plan: Record<string, unknown> = {}
  try {
    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) plan = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json({ error: 'Failed to generate business plan.' }, { status: 500 })
  }

  await db.from('businesses').update({
    business_model: JSON.stringify({ ...JSON.parse(business.business_model || '{}'), fullPlan: plan }),
  }).eq('id', id)

  await notify({
    ownerId: user.id, source: 'business', severity: 'success',
    title: `Business plan generated for ${business.name}`,
    message: 'Full financial projections + market analysis + SWOT + funding strategy ready.',
    actionUrl: '/?view=business', metadata: { businessId: id },
  })

  return NextResponse.json({ ok: true, plan })
}
