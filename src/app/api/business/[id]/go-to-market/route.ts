// POST /api/business/[id]/go-to-market — generates a complete go-to-market strategy.
//
// Generates:
//   - Channel selection (which platforms to focus on based on target audience)
//   - Pricing strategy with competitor price comparison
//   - Positioning statement + messaging framework
//   - Customer acquisition cost (CAC) estimate per channel
//   - 90-day launch plan with weekly milestones
//   - Domain name suggestions (brandable + available-sounding)

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

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert go-to-market strategist.',
        'Generate a complete go-to-market plan as JSON.',
        '',
        'Return ONLY a JSON object:',
        '{',
        '  "positioning": {',
        '    "statement": string — one-sentence positioning statement',
        '    "messagingFramework": {',
        '      "category": string — what category the product is in',
        '      "target": string — who it is for',
        '      "benefit": string — the main benefit',
        '      "differentiator": string — why it is different',
        '    },',
        '    "taglines": [string] — 3 alternative taglines',
        '  },',
        '  "channels": [{',
        '    "name": string — channel name (e.g. "Content Marketing", "Paid Ads", "SEO", "Social Media", "Partnerships")',
        '    "priority": "high" | "medium" | "low",',
        '    "whyThisChannel": string — why this channel makes sense for this audience',
        '    "estimatedCAC": string — estimated customer acquisition cost',
        '    "timeToResults": string — how long before seeing results',
        '    "budgetAllocation": number — recommended % of marketing budget',
        '    "tactics": [string] — 3-5 specific tactics for this channel',
        '  }],',
        '  "pricingStrategy": {',
        '    "recommendation": string — freemium / subscription / one-time / usage-based',
        '    "pricingTiers": [{ "name": string, "price": string, "target": string, "features": [string] }],',
        '    "competitorPricing": [{ "competitor": string, "price": string, "model": string }],',
        '    "psychologicalPricing": string — pricing psychology tip',
        '  },',
        '  "ninetyDayPlan": [{',
        '    "week": number,',
        '    "phase": string — "Foundation" | "Launch" | "Scale",',
        '    "goals": [string],',
        '    "activities": [string],',
        '    "successMetrics": [string],',
        '  }],',
        '  "domainSuggestions": [{',
        '    "domain": string — a brandable domain name',
        '    "available": string — "likely available" | "may be taken" | "premium"',
        '    "reasoning": string — why this domain works',
        '  }],',
        '  "launchChecklist": [string] — 10 items to check before launching',
        '}',
        'Rules: Use real numbers. Be specific to the business. Return ONLY JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Business: ${business.name}\nIdea: ${business.idea}\nMission: ${business.mission}\nTarget audience: ${business.target_audience}\nBusiness model: ${business.business_model}\n\nGenerate a complete go-to-market strategy as JSON.`,
    },
  ]

  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }),
    thinking: { type: 'disabled' },
  })

  let gtm: Record<string, unknown> = {}
  try {
    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) gtm = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json({ error: 'Failed to generate go-to-market strategy.' }, { status: 500 })
  }

  await notify({
    ownerId: user.id, source: 'business', severity: 'success',
    title: `Go-to-market strategy generated for ${business.name}`,
    message: 'Channel selection + pricing + 90-day plan + domain suggestions ready.',
    actionUrl: '/?view=business', metadata: { businessId: id },
  })

  return NextResponse.json({ ok: true, gtm })
}
