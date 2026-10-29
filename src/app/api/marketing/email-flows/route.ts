// POST /api/marketing/email-flows — generates email automation flows.
// Body: { type: 'welcome'|'abandoned_cart'|'reengagement', businessId?, description? }
//
// Generates a complete email automation flow with:
//   - Trigger condition
//   - Email sequence (3-5 emails with subject, preview text, body, delay, goal)
//   - Branching logic (if/else conditions)

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'
import { trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

const FLOW_TYPES: Record<string, { name: string; description: string }> = {
  welcome: { name: 'Welcome Flow', description: 'Triggered when a user signs up. Nurtures them toward their first conversion.' },
  abandoned_cart: { name: 'Abandoned Cart Flow', description: 'Triggered when a user adds to cart but doesn\'t checkout. Recovers lost revenue.' },
  reengagement: { name: 'Re-engagement Flow', description: 'Triggered when a user is inactive for 30+ days. Wins them back.' },
}

export async function POST(req: NextRequest) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const body = await req.json()
  const type = body.type || 'welcome'
  const flowType = FLOW_TYPES[type]
  if (!flowType) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })

  // Fetch business context if provided
  let businessName = ''
  let businessIdea = ''
  if (body.businessId) {
    const { data: biz } = await db.from('businesses').select('name, idea').eq('id', body.businessId).eq('owner_id', user.id).maybeSingle()
    if (biz) { businessName = biz.name as string; businessIdea = biz.idea as string }
  }

  const zai = await ZAI.create()

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert email marketing automation strategist.',
        `Flow type: ${flowType.name} — ${flowType.description}`,
        `Business: ${businessName || 'Your business'}`,
        `Description: ${body.description || businessIdea || 'A product people love'}`,
        '',
        'Generate a complete email automation flow as JSON:',
        '{',
        '  "flowName": string,',
        '  "trigger": {',
        '    "event": string — what triggers this flow (e.g. "user_signup", "cart_abandoned", "inactive_30_days"),',
        '    "condition": string — the filter condition',
        '  },',
        '  "emails": [{',
        '    "step": number,',
        '    "name": string — email name (e.g. "Welcome Email", "Reminder", "Last Chance"),',
        '    "subject": string — email subject line',
        '    "previewText": string — preview text (max 100 chars)',
        '    "body": string — full email body (HTML-safe, with personalization tokens like {{first_name}})',
        '    "delay": string — when to send after previous email (e.g. "immediate", "1 day", "3 days")',
        '    "goal": string — what this email should achieve',
        '    "ctaText": string — call to action button text',
        '    "ctaUrl": string — placeholder URL for the CTA',
        '  }],',
        '  "branches": [{',
        '    "condition": string — if/else condition (e.g. "if user opened previous email"),',
        '    "ifTrue": string — what happens if true',
        '    "ifFalse": string — what happens if false',
        '  }],',
        '  "tips": [string] — 3-5 optimization tips for this flow',
        '}',
        'Return ONLY JSON. Use real, specific content.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Business: ${businessName}\nDescription: ${body.description || businessIdea}\nFlow type: ${type}\n\nGenerate the email automation flow as JSON.`,
    },
  ]

  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }),
    thinking: { type: 'disabled' },
  })

  let flow: Record<string, unknown> = {}
  try {
    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) flow = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json({ error: 'Failed to generate email flow.' }, { status: 500 })
  }

  await trackUsage(user.id, 'llm_tokens', 1, { via: 'email-flows', type })

  await notify({
    ownerId: user.id, source: 'marketing', severity: 'success',
    title: `Email flow generated: ${flowType.name}`,
    message: `${(flow.emails as unknown[])?.length || 0} emails in sequence.`,
    actionUrl: '/?view=marketing', metadata: { type },
  })

  return NextResponse.json({ ok: true, type, flowName: flowType.name, flow })
}
