// POST /api/jobs/[id]/payment/verify — verify a Paystack payment.
// ------------------------------------------------------------------
// Body: { reference: string }
// Auth:  requireSessionUser() + job ownership.
// Calls Paystack's verify endpoint, updates the paystack_payments row,
// and — if it's a milestone payment that succeeded — marks the milestone's
// tasks as completed.
// Returns: { ok, status, amount, paidAt }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { verifyPayment } from '@/lib/paystack'

interface VerifyBody {
  reference?: string
}

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

  const rl = rateLimit(`payment-verify:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
  })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as VerifyBody | null
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''
  if (!reference || reference.length > 100 || /[\r\n]/.test(reference)) {
    return NextResponse.json({ error: 'missing_reference' }, { status: 400 })
  }

  // Verify job ownership.
  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()
  if (jobErr || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Find the payment row by reference + job_id.
  const { data: payment, error: paymentErr } = await db
    .from('paystack_payments')
    .select('*')
    .eq('paystack_ref', reference)
    .eq('job_id', id)
    .maybeSingle()
  if (paymentErr || !payment) {
    return NextResponse.json({ error: 'payment_not_found' }, { status: 404 })
  }

  // Already verified previously — short-circuit with stored state.
  if (payment.status === 'success' || payment.status === 'failed') {
    return NextResponse.json({
      ok: true,
      status: payment.status,
      amount: Number(payment.amount_kobo ?? 0),
      paidAt: payment.paid_at
        ? new Date(payment.paid_at as string).toISOString()
        : null,
      cached: true,
    })
  }

  // Verify against Paystack's authoritative transaction record.
  let verified
  try {
    verified = await verifyPayment(reference)
  } catch (err) {
    return NextResponse.json(
      {
        error: 'paystack_verify_failed',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 502 },
    )
  }

  // A provider success is insufficient unless every invariant matches the
  // payment we created. Never transition state on mismatched amount/currency.
  if (verified.reference !== payment.paystack_ref) {
    return NextResponse.json({ error: 'payment_reference_mismatch' }, { status: 409 })
  }
  if (verified.status === 'success' && (verified.amount !== Number(payment.amount_kobo) || verified.currency !== String(payment.currency || 'NGN').toUpperCase())) {
    return NextResponse.json({ error: 'payment_amount_or_currency_mismatch' }, { status: 409 })
  }
  if (payment.customer_email && verified.customer_email && String(payment.customer_email).toLowerCase() !== verified.customer_email.toLowerCase()) {
    return NextResponse.json({ error: 'payment_customer_mismatch' }, { status: 409 })
  }

  const isSuccess = verified.status === 'success'
  const isTerminalFailure = ['failed', 'abandoned', 'reversed'].includes(verified.status)
  const paidAt = verified.paid_at || new Date().toISOString()

  if (isSuccess) {
    // The SQL function locks the payment row, checks its reference and amount,
    // and commits the payment + milestone task update atomically.
    const { data: confirmed, error: confirmErr } = await db.rpc('confirm_paystack_payment', {
      p_payment_id: String(payment.id),
      p_reference: reference,
      p_amount_kobo: verified.amount,
      p_paid_at: paidAt,
    })
    if (confirmErr || confirmed !== true) {
      return NextResponse.json({ error: 'payment_confirmation_failed' }, { status: 500 })
    }
  } else if (isTerminalFailure) {
    const { error: updateErr } = await db
      .from('paystack_payments')
      .update({ status: 'failed', paid_at: null })
      .eq('id', payment.id)
      .eq('status', 'pending')
    if (updateErr) return NextResponse.json({ error: 'payment_state_update_failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    status: verified.status,
    amount: verified.amount,
    paidAt: isSuccess ? paidAt : null,
  })
}
