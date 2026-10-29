// POST /api/jobs/[id]/contract — generates a freelance contract (text, not PDF yet).
// Uses LLM to create a professional contract based on the job scope.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import type { ChatMessage } from '@/lib/llm/router'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let user
  try { user = await requireSessionUser() } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const { id } = await ctx.params
  const { data: job, error } = await db.from('jobs').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const hourlyRate = body.hourlyRate || 75
  const paymentTerms = body.paymentTerms || '50% upfront, 50% on delivery'

  let scope: Record<string, unknown> = {}
  try { scope = JSON.parse(job.scope || '{}') } catch { scope = {} }

  const zai = await ZAI.create()

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a legal document generator specializing in freelance contracts.',
        'Generate a professional freelance contract as plain text (NOT markdown).',
        '',
        'The contract should include:',
        '1. Agreement title and date',
        '2. Parties (Freelancer + Client)',
        `3. Scope of work (based on: ${job.title} — ${job.description})`,
        `4. Deliverables: ${JSON.stringify(scope.deliverables || [])}`,
        `5. Timeline: ${scope.estimatedHours || 40} hours estimated`,
        `6. Payment terms: ${paymentTerms}`,
        `7. Rate: $${hourlyRate}/hour`,
        `8. Total estimated cost: $${((scope.estimatedHours as number) || 40) * hourlyRate}`,
        '9. Intellectual property transfer (upon full payment)',
        '10. Revision policy (2 rounds of revisions included)',
        '11. Termination clause (7 days notice)',
        '12. Confidentiality clause',
        '13. Limitation of liability',
        '14. Governing law (state of freelancer)',
        '15. Signature blocks for both parties',
        '',
        'Return ONLY the contract text. No JSON, no markdown.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Freelancer: ${user.name || user.email}\nClient: ${job.client_name || 'Client'}\nJob: ${job.title}\nDescription: ${job.description}\nEstimated hours: ${scope.estimatedHours || 40}\nRate: $${hourlyRate}/hour\nPayment terms: ${paymentTerms}\n\nGenerate the contract.`,
    },
  ]

  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => m.role === 'system' ? { role: 'assistant' as const, content: m.content } : { role: 'user' as const, content: m.content }),
    thinking: { type: 'disabled' },
  })

  const contractText = completion.choices[0]?.message?.content ?? ''

  return NextResponse.json({
    ok: true,
    contract: contractText,
    estimatedCost: ((scope.estimatedHours as number) || 40) * hourlyRate,
    hourlyRate,
    paymentTerms,
  })
}
