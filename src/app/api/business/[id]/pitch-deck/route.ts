// POST /api/business/[id]/pitch-deck — generates a 10-slide investor pitch deck.
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
        'You are an expert startup pitch deck creator.',
        'Generate a 10-slide investor pitch deck as JSON.',
        '',
        'Return ONLY a JSON object:',
        '{',
        '  "slides": [',
        '    { "number": 1, "title": "Problem", "bullets": [string], "talkingPoints": string },',
        '    { "number": 2, "title": "Solution", "bullets": [string], "talkingPoints": string },',
        '    { "number": 3, "title": "Market Size", "bullets": [string], "talkingPoints": string },',
        '    { "number": 4, "title": "Product", "bullets": [string], "talkingPoints": string },',
        '    { "number": 5, "title": "Traction", "bullets": [string], "talkingPoints": string },',
        '    { "number": 6, "title": "Business Model", "bullets": [string], "talkingPoints": string },',
        '    { "number": 7, "title": "Competition", "bullets": [string], "talkingPoints": string },',
        '    { "number": 8, "title": "Team", "bullets": [string], "talkingPoints": string },',
        '    { "number": 9, "title": "Financials", "bullets": [string], "talkingPoints": string },',
        '    { "number": 10, "title": "The Ask", "bullets": [string], "talkingPoints": string },',
        '  ],',
        '  "summary": string — one-paragraph elevator pitch',
        '}',
        'Rules: Be specific to the business. Use real numbers where possible. Return ONLY JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Business: ${business.name}\nIdea: ${business.idea}\nMission: ${business.mission}\nTarget audience: ${business.target_audience}\nBusiness model: ${business.business_model}\n\nGenerate a 10-slide investor pitch deck as JSON.`,
    },
  ]

  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }),
    thinking: { type: 'disabled' },
  })

  let deck: Record<string, unknown> = {}
  try {
    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) deck = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json({ error: 'Failed to generate pitch deck.' }, { status: 500 })
  }

  await notify({
    ownerId: user.id, source: 'business', severity: 'success',
    title: `Pitch deck generated for ${business.name}`,
    message: '10-slide investor deck ready to view.',
    actionUrl: '/?view=business', metadata: { businessId: id },
  })

  return NextResponse.json({ ok: true, deck })
}
