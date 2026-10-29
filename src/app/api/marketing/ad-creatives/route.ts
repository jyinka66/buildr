// POST /api/marketing/ad-creatives — generates ad creative images + A/B test variants.
//
// Body: { businessId?, projectId?, description?, platform: 'meta'|'google'|'tiktok' }
//
// Generates:
//   - 3 A/B test headline variants
//   - 3 primary text variants
//   - Ad creative image (via image generation)
//   - Targeting suggestions
//   - Budget recommendation

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'
import { trackUsage } from '@/lib/billing'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import type { ChatMessage } from '@/lib/llm/router'

export async function POST(req: NextRequest) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const rl = rateLimit(`ad-creatives:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = await req.json()
  const platform = body.platform || 'meta'
  const description = body.description || ''

  // Fetch business context if provided
  let businessName = ''
  let businessIdea = ''
  if (body.businessId) {
    const { data: biz } = await db.from('businesses').select('name, idea, mission, brand_colors').eq('id', body.businessId).eq('owner_id', user.id).maybeSingle()
    if (biz) {
      businessName = biz.name as string
      businessIdea = biz.idea as string
    }
  }

  const zai = await ZAI.create()

  // Step 1: Generate A/B test ad copy variants
  const copyMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert digital marketing copywriter.',
        `Platform: ${platform} (${platform === 'meta' ? 'Facebook/Instagram' : platform === 'google' ? 'Google Ads' : 'TikTok'})`,
        `Business: ${businessName || 'Your business'}`,
        `Description: ${description || businessIdea || 'A great product'}`,
        '',
        'Generate 3 A/B test variants of ad copy as JSON:',
        '{',
        '  "variants": [{',
        '    "headline": string — attention-grabbing headline (max 40 chars for meta, 30 for google)',
        '    "primaryText": string — body text (max 125 chars for meta)',
        '    "cta": string — call to action ("Shop Now", "Sign Up", "Learn More", etc.)',
        '    "targetAudience": string — who to target',
        '    "objective": string — campaign objective ("awareness", "traffic", "conversions", "app_installs")',
        '    "budgetRecommendation": string — daily budget suggestion with reasoning',
        '  }],',
        '  "targetingSuggestions": {',
        '    "ageRange": string,',
        '    "interests": [string],',
        '    "behaviors": [string],',
        '    "locations": string,',
        '  },',
        '  "creativeImagePrompt": string — a detailed prompt for generating the ad creative image',
        '}',
        'Return ONLY JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Business: ${businessName}\nDescription: ${description || businessIdea}\nPlatform: ${platform}\n\nGenerate 3 ad copy variants with targeting suggestions as JSON.`,
    },
  ]

  const copyCompletion = await zai.chat.completions.create({
    messages: copyMessages.map((m) => m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }),
    thinking: { type: 'disabled' },
  })

  let adData: Record<string, unknown> = {}
  try {
    const raw = copyCompletion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) adData = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    adData = { variants: [], targetingSuggestions: {}, creativeImagePrompt: '' }
  }

  // Step 2: Generate the ad creative image
  let imageBase64: string | null = null
  const imagePrompt = String(adData.creativeImagePrompt || `Professional ${platform} ad creative for ${businessName || 'a product'}. Clean, modern design with bold text overlay. Eye-catching colors.`)
  try {
    const imgResponse = await zai.images.generations.create({
      prompt: imagePrompt,
      size: '1024x1024',
    })
    imageBase64 = imgResponse.data?.[0]?.base64 || null
  } catch {
    // Image generation is best-effort
  }

  await trackUsage(user.id, 'images', 1, { via: 'ad-creatives', platform })

  await notify({
    ownerId: user.id, source: 'marketing', severity: 'success',
    title: `Ad creatives generated (${platform})`,
    message: `3 A/B variants + ${imageBase64 ? 'creative image' : 'no image'} ready.`,
    actionUrl: '/?view=marketing', metadata: { platform },
  })

  return NextResponse.json({
    ok: true,
    platform,
    variants: adData.variants || [],
    targeting: adData.targetingSuggestions || {},
    imageBase64,
    imagePrompt,
  })
}
