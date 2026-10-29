// POST /api/jobs/[id]/payment — create a Paystack payment link for a job.
// ------------------------------------------------------------------
// Body: { type: 'deposit' | 'milestone' | 'final', amountKobo: number, milestoneIndex?: number }
// Auth:  requireSessionUser() + job ownership.
// Calls Paystack's initialize endpoint, then inserts a row into paystack_payments.
// Returns: { ok, authorizationUrl, reference, paymentId }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { generateReference, initializePayment } from '@/lib/paystack'

interface CreatePaymentBody {
  type?: 'deposit' | 'milestone' | 'final'
  amountKobo?: number
  milestoneIndex?: number
}

const VALID_TYPES = new Set(['deposit', 'milestone', 'final'])

export async function POST(
  req: NextRequest,
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

  const rl = rateLimit(`payment-create:${user.id}`, {
    limit: 20,
    windowMs: 60_000,
  })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { id } = await ctx.params
  const { data: job, error } = await db
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as CreatePaymentBody | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  const type = body.type ?? 'deposit'
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json({ error: 'invalid_payment_type' }, { status: 400 })
  }
  const amountKobo = Number(body.amountKobo)
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 || amountKobo > 2_147_483_647) {
    return NextResponse.json(
      { error: 'invalid_amount', message: 'amountKobo must be a positive integer.' },
      { status: 400 },
    )
  }
  if (type === 'milestone' && (!Number.isSafeInteger(body.milestoneIndex) || (body.milestoneIndex as number) < 0)) {
    return NextResponse.json({ error: 'invalid_milestone_index' }, { status: 400 })
  }
  const milestoneIndex = type === 'milestone' ? body.milestoneIndex as number : null

  const reference = generateReference(id)
  const customerEmail = (job.client_email as string) || user.email
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return NextResponse.json({ error: 'valid_customer_email_required' }, { status: 400 })
  }

  // Persist the intent before contacting the provider so a successful provider
  // initialization can never become an untracked payment if the DB write fails.
  const { data: payment, error: insertErr } = await db
    .from('paystack_payments')
    .insert({
      job_id: id,
      owner_id: user.id,
      paystack_ref: reference,
      amount_kobo: amountKobo,
      currency: 'NGN',
      status: 'pending',
      type,
      milestone_index: milestoneIndex,
      customer_email: customerEmail,
      customer_name: (job.client_name as string) || user.name || null,
      metadata: {},
    })
    .select('*')
    .single()

  if (insertErr || !payment) {
    return NextResponse.json({ error: 'payment_persist_failed' }, { status: 500 })
  }

  let init
  try {
    init = await initializePayment({
      email: customerEmail,
      amountKobo,
      reference,
      metadata: {
        job_id: id,
        job_title: job.title,
        type,
        milestone_index: milestoneIndex,
        owner_id: user.id,
      },
    })
  } catch (err) {
    await db.from('paystack_payments').update({ status: 'failed' }).eq('id', payment.id).eq('status', 'pending')
    return NextResponse.json(
      { error: 'paystack_init_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    )
  }

  const { error: updateErr } = await db
    .from('paystack_payments')
    .update({ access_code: init.access_code, metadata: { authorization_url: init.authorization_url } })
    .eq('id', payment.id)
    .eq('status', 'pending')
  if (updateErr) {
    // Do not return a checkout link when the local payment record is incomplete.
    return NextResponse.json({ error: 'payment_persist_failed' }, { status: 500 })
  }
  if (!init.authorization_url.startsWith('https://checkout.paystack.com/') && !init.authorization_url.startsWith('https://checkout.paystack.co/')) {
    await db.from('paystack_payments').update({ status: 'failed' }).eq('id', payment.id).eq('status', 'pending')
    return NextResponse.json({ error: 'invalid_payment_checkout_url' }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    authorizationUrl: init.authorization_url,
    reference,
    paymentId: payment.id,
  })
}
