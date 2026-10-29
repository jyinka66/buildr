// POST /api/marketing/generate — AI marketing content generator.
// ------------------------------------------------------------------
// Body: { type, platform?, businessId?, projectId?, description? }
//   type: 'ads' | 'social' | 'email' | 'seo'
//
// Uses the ZAI SDK to generate marketing content tailored to the type:
//   - ads    → ad copy (headlines, descriptions, CTAs) for the platform
//   - social → social media posts (caption, hashtags, image prompt)
//   - email  → email campaign (subject, preview, body, CTA)
//   - seo    → SEO package (title, meta description, keywords, blog outline)
//
// Persists a MarketingCampaign record and returns the generated content as JSON.
// Creates a 'marketing' notification so the user sees a breadcrumb in the feed.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

type CampaignType = 'ads' | 'social' | 'email' | 'seo'

interface GenerateBody {
  type?: string
  platform?: string
  businessId?: string
  projectId?: string
  description?: string
}

const VALID_TYPES: CampaignType[] = ['ads', 'social', 'email', 'seo']

const PLATFORM_DEFAULTS: Record<CampaignType, string> = {
  ads: 'google',
  social: 'all',
  email: 'all',
  seo: 'all',
}

function systemPromptFor(type: CampaignType): string {
  switch (type) {
    case 'ads':
      return [
        'You are an expert paid-ads copywriter.',
        'Generate ad copy for the requested platform as a JSON object.',
        '',
        'Return ONLY this JSON shape:',
        '{',
        '  "platform": string — the ad platform',
        '  "headlineVariants": [string] — 3-5 short headlines (max 30 chars each)',
        '  "descriptions": [string] — 2-3 long descriptions (max 90 chars each)',
        '  "cta": string — a single call-to-action (e.g. "Start free trial")',
        '  "targetingTips": [string] — 2-3 audience targeting suggestions',
        '  "budgetHint": string — a suggested starting daily budget + currency',
        '}',
        '',
        'Rules:',
        '- Headlines must be punchy and benefit-driven.',
        '- Descriptions must include a specific value prop + urgency.',
        '- Tailor tone to the platform (Google = direct, Meta = emotional, TikTok = playful).',
        '- Return ONLY the JSON object. No markdown fences.',
      ].join('\n')
    case 'social':
      return [
        'You are an expert social media manager.',
        'Generate a social media post bundle as a JSON object.',
        '',
        'Return ONLY this JSON shape:',
        '{',
        '  "platform": string — the platform the post is optimized for',
        '  "caption": string — the post caption (150-500 chars, emoji-friendly)',
        '  "captionVariants": [string] — 2 alternate captions',
        '  "hashtags": [string] — 5-10 hashtags without the # symbol',
        '  "imagePrompt": string — a prompt usable for an AI image generator',
        '  "bestTimeToPost": string — a suggested posting time + timezone',
        '}',
        '',
        'Rules:',
        '- Match the platform\'s native tone (LinkedIn = professional, Twitter/X = punchy, Instagram = visual).',
        '- Hashtags must be discoverable and specific to the niche.',
        '- Return ONLY the JSON object. No markdown fences.',
      ].join('\n')
    case 'email':
      return [
        'You are an expert email marketing strategist.',
        'Generate a complete email campaign as a JSON object.',
        '',
        'Return ONLY this JSON shape:',
        '{',
        '  "subject": string — the email subject line (max 60 chars)',
        '  "subjectVariants": [string] — 2 A/B subject variants',
        '  "previewText": string — the preheader text (max 90 chars)',
        '  "greeting": string — e.g. "Hi there,"',
        '  "body": string — the email body as plain text with paragraph breaks (\\n\\n)',
        '  "cta": string — a single primary CTA button label',
        '  "postscript": string — a P.S. line that drives urgency',
        '  "sendTip": string — best day + time to send this email',
        '}',
        '',
        'Rules:',
        '- Subject must be open-worthy but not clickbait.',
        '- Body must be benefit-led and include one concrete proof point.',
        '- Return ONLY the JSON object. No markdown fences.',
      ].join('\n')
    case 'seo':
      return [
        'You are an expert SEO strategist.',
        'Generate an SEO content package as a JSON object.',
        '',
        'Return ONLY this JSON shape:',
        '{',
        '  "title": string — the page <title> (max 60 chars)',
        '  "metaDescription": string — the meta description (max 155 chars)',
        '  "primaryKeyword": string — the main target keyword',
        '  "secondaryKeywords": [string] — 4-6 related long-tail keywords',
        '  "urlSlug": string — the recommended URL slug',
        '  "blogOutline": [{ "heading": string, "points": [string] }] — 4-6 H2 sections',
        '  "internalLinkTargets": [string] — 2-3 suggested internal pages to link to',
        '}',
        '',
        'Rules:',
        '- Keywords must have realistic commercial intent.',
        '- Title must include the primary keyword near the front.',
        '- Return ONLY the JSON object. No markdown fences.',
      ].join('\n')
  }
}

function userPromptFor(type: CampaignType, body: GenerateBody, businessContext: string): string {
  const platform = body.platform || PLATFORM_DEFAULTS[type]
  const parts = [
    `Campaign type: ${type}`,
    `Platform: ${platform}`,
  ]
  if (businessContext) parts.push(`Business context:\n${businessContext}`)
  if (body.description) parts.push(`Additional brief: ${body.description.trim()}`)
  parts.push('', `Generate the ${type} marketing package as JSON.`)
  return parts.join('\n')
}

async function loadBusinessContext(body: GenerateBody, userId: string): Promise<string> {
  if (body.businessId) {
    const { data: b } = await db
      .from('businesses')
      .select('name, description, mission, value_prop, target_audience')
      .eq('id', body.businessId)
      .eq('owner_id', userId)
      .maybeSingle()
    if (b) {
      return [
        `Company: ${b.name}`,
        `Tagline: ${b.description}`,
        `Mission: ${b.mission}`,
        `Value proposition: ${b.value_prop}`,
        `Target audience: ${b.target_audience}`,
      ].join('\n')
    }
  }
  if (body.projectId) {
    const { data: p } = await db
      .from('projects')
      .select('name, description, prompt')
      .eq('id', body.projectId)
      .eq('owner_id', userId)
      .maybeSingle()
    if (p) {
      return [
        `Project: ${p.name}`,
        `Description: ${p.description}`,
        `Original prompt: ${p.prompt}`,
      ].join('\n')
    }
  }
  return ''
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

  const body = (await req.json()) as GenerateBody
  const typeRaw = (body.type || '').toLowerCase().trim() as CampaignType
  if (!VALID_TYPES.includes(typeRaw)) {
    return NextResponse.json(
      { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}.` },
      { status: 400 },
    )
  }
  if (!body.description && !body.businessId && !body.projectId) {
    return NextResponse.json(
      { error: 'Please provide a description, businessId, or projectId so the AI has context.' },
      { status: 400 },
    )
  }

  const businessContext = await loadBusinessContext(body, user.id)

  const zai = await ZAI.create()

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPromptFor(typeRaw) },
    { role: 'user', content: userPromptFor(typeRaw, body, businessContext) },
  ]

  const completion = await zai.chat.completions.create({
    messages: messages.map((m) =>
      m.role === 'system'
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: m.content },
    ),
    thinking: { type: 'disabled' },
  })

  let content: Record<string, unknown> = {}
  let rawContent = ''
  let parseError: string | null = null
  try {
    rawContent = completion.choices[0]?.message?.content ?? ''
    const jsonStart = rawContent.indexOf('{')
    const jsonEnd = rawContent.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON found in LLM response')
    }
    content = JSON.parse(rawContent.slice(jsonStart, jsonEnd + 1))
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'parse_failed'
    // Fall back to wrapping the raw text so the user gets *something*.
    content = { raw: rawContent, parseError }
  }

  const platform = (body.platform || PLATFORM_DEFAULTS[typeRaw]).toLowerCase()

  // Persist the campaign record.
  const { data: campaign, error: campaignError } = await db
    .from('marketing_campaigns')
    .insert({
      owner_id: user.id,
      business_id: body.businessId || null,
      project_id: body.projectId || null,
      campaign_type: typeRaw,
      platform,
      content: JSON.stringify(content),
      schedule: JSON.stringify({ generatedAt: new Date().toISOString() }),
      status: parseError ? 'draft' : 'generated',
    })
    .select('*')
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json(
      { error: campaignError?.message || 'campaign_create_failed' },
      { status: 500 },
    )
  }

  // Drop a notification so the marketing feed picks it up.
  try {
    await db.from('notifications').insert({
      owner_id: user.id,
      source: 'marketing',
      severity: parseError ? 'warning' : 'success',
      title: `Marketing content generated (${typeRaw})`,
      message: parseError
        ? `Generated with a parse warning: ${parseError}.`
        : `New ${typeRaw} campaign is ready to review.`,
      link_type: 'marketing',
      link_id: campaign.id,
      action_url: `/marketing?id=${campaign.id}`,
      metadata: JSON.stringify({ campaignId: campaign.id, type: typeRaw, platform }),
    })
  } catch {
    /* non-fatal */
  }

  // Best-effort usage tracking (no dedicated metric — count against llm_tokens).
  await trackUsage(user.id, 'llm_tokens', 1, { via: 'marketing', campaignId: campaign.id, type: typeRaw })

  return NextResponse.json(
    {
      ok: true,
      campaign: {
        id: campaign.id,
        type: typeRaw,
        platform,
        content,
        status: campaign.status,
        createdAt: campaign.created_at,
      },
      parseError,
    },
    { status: 201 },
  )
}
