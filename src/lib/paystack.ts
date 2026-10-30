import { randomUUID } from 'node:crypto'

const PAYSTACK_BASE = 'https://api.paystack.co'
const TIMEOUT_MS = 15_000

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim() ?? ''
  if (!key || key === 'your-paystack-secret-key' || key === 'sk_test_xxx') {
    throw new Error('PAYSTACK_NOT_CONFIGURED')
  }
  const configuredMode = process.env.PAYSTACK_MODE?.trim().toLowerCase()
  const mode = configuredMode || (process.env.NODE_ENV === 'production' ? 'live' : 'test')
  if (mode !== 'test' && mode !== 'live') throw new Error('PAYSTACK_MODE_INVALID')
  const requiredPrefix = mode === 'test' ? 'sk_test_' : 'sk_live_'
  if (!key.startsWith(requiredPrefix)) {
    throw new Error(mode === 'test' ? 'PAYSTACK_TEST_KEY_REQUIRED' : 'PAYSTACK_LIVE_KEY_REQUIRED')
  }
  return key
}

export interface InitializePaymentInput {
  email: string
  amountKobo: number
  reference: string
  metadata?: Record<string, unknown>
  callbackUrl?: string
}

export interface InitializePaymentResult {
  authorization_url: string
  access_code: string
  reference: string
}

export interface VerifyPaymentResult {
  status: 'success' | 'failed' | 'pending' | 'abandoned' | 'reversed'
  amount: number
  currency: string | null
  customer_email: string | null
  paid_at: string | null
  reference: string
  raw?: unknown
}

export function generateReference(jobId: string): string {
  const id = (jobId || 'job').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'job'
  return `buildr-${id}-${randomUUID()}`
}

export async function initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
  const secretKey = getSecretKey()
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) {
    throw new Error('INVALID_PAYMENT_AMOUNT')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new Error('INVALID_PAYMENT_EMAIL')
  }
  if (!input.reference || input.reference.length > 100) throw new Error('INVALID_PAYMENT_REFERENCE')

  const payload: Record<string, unknown> = {
    email: input.email,
    amount: input.amountKobo,
    reference: input.reference,
    currency: 'NGN',
    metadata: input.metadata ?? {},
  }
  if (input.callbackUrl) {
    let callback: URL
    try { callback = new URL(input.callbackUrl) } catch { throw new Error('INVALID_PAYMENT_CALLBACK_URL') }
    if (!['http:', 'https:'].includes(callback.protocol) || (process.env.NODE_ENV === 'production' && callback.protocol !== 'https:')) {
      throw new Error('INVALID_PAYMENT_CALLBACK_URL')
    }
    payload.callback_url = callback.toString()
  }

  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secretKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`paystack_initialize_failed: ${res.status} ${text.slice(0, 200)}`)
  }

  const json = await res.json() as {
    status?: boolean
    message?: string
    data?: { authorization_url?: string; access_code?: string; reference?: string }
  }
  const data = json.data
  if (json.status !== true || !data?.authorization_url || !data.access_code || data.reference !== input.reference) {
    throw new Error('PAYSTACK_INVALID_INITIALIZATION_RESPONSE')
  }
  const authorizationUrl = new URL(data.authorization_url)
  if (authorizationUrl.protocol !== 'https:' || !['checkout.paystack.com', 'checkout.paystack.co'].includes(authorizationUrl.hostname)) {
    throw new Error('PAYSTACK_INVALID_CHECKOUT_URL')
  }
  return { authorization_url: authorizationUrl.toString(), access_code: data.access_code, reference: data.reference }
}

export async function verifyPayment(reference: string): Promise<VerifyPaymentResult> {
  const secretKey = getSecretKey()
  if (!reference || reference.length > 100 || /[\r\n]/.test(reference)) throw new Error('INVALID_PAYMENT_REFERENCE')

  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`paystack_verify_failed: ${res.status} ${text.slice(0, 200)}`)
  }

  const json = await res.json() as {
    status?: boolean
    data?: {
      status?: string; amount?: number; currency?: string; reference?: string
      paid_at?: string | null; created_at?: string | null
      customer?: { email?: string } | null
    }
  }
  const data = json.data
  if (json.status !== true || !data || data.reference !== reference) {
    throw new Error('PAYSTACK_INVALID_VERIFICATION_RESPONSE')
  }
  const rawStatus = String(data.status ?? 'pending').toLowerCase()
  const status: VerifyPaymentResult['status'] =
    rawStatus === 'success' ? 'success' :
    rawStatus === 'failed' ? 'failed' :
    rawStatus === 'abandoned' ? 'abandoned' :
    rawStatus === 'reversed' ? 'reversed' : 'pending'

  return {
    status,
    amount: Number(data.amount ?? 0),
    currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : null,
    customer_email: data.customer?.email ?? null,
    paid_at: data.paid_at ?? data.created_at ?? null,
    reference: data.reference,
    raw: data,
  }
}
