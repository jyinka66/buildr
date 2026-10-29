// GET /api/jobs/[id]/payments — list all payments for a job.
// ------------------------------------------------------------------
// Auth: requireSessionUser() + job ownership.
// Returns: { payments: [...] }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { id } = await ctx.params

  // Verify job ownership.
  const { data: job, error } = await db
    .from('jobs')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { data: rows, error: pErr } = await db
    .from('paystack_payments')
    .select('*')
    .eq('job_id', id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (pErr) {
    return NextResponse.json({ error: 'payment_fetch_failed' }, { status: 500 })
  }

  return NextResponse.json({
    payments: (rows ?? []).map((p: Record<string, unknown>) => {
      // The authorization URL lives in the metadata JSON (set at creation time).
      let authorizationUrl: string | null = null
      const meta = p.metadata
      if (meta && typeof meta === 'object') {
        const m = meta as Record<string, unknown>
        if (typeof m.authorization_url === 'string') authorizationUrl = m.authorization_url
      }
      return {
        id: p.id,
        reference: p.paystack_ref,
        amountKobo: p.amount_kobo,
        currency: p.currency || 'NGN',
        status: p.status || 'pending',
        type: p.type || 'deposit',
        milestoneIndex: p.milestone_index ?? null,
        customerEmail: p.customer_email ?? null,
        authorizationUrl,
        paidAt: p.paid_at ? new Date(p.paid_at as string).toISOString() : null,
        createdAt: p.created_at
          ? new Date(p.created_at as string).toISOString()
          : null,
      }
    }),
  })
}
