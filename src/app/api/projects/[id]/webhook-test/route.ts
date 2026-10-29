// POST /api/projects/[id]/webhook-test — sends a test webhook payload to a
// generated webhook route (e.g. /api/webhooks/stripe) and returns the
// response. This lets users verify their webhook handlers work without
// needing real service credentials.
//
// The request body specifies:
//   - path: the webhook route path (e.g. /api/webhooks/stripe)
//   - provider: which provider's test event to simulate (stripe, twilio, resend)
//   - eventType: optional event type override
//
// We construct a realistic payload for the provider, send it to the API
// runtime sidecar (port 3030) which executes the generated route handler,
// and return the response.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

// Realistic test payloads for common webhook providers.
function buildTestPayload(provider: string, eventType?: string): { payload: Record<string, unknown>; signature?: string } {
  switch (provider) {
    case 'stripe':
      return {
        payload: {
          id: 'evt_test_webhook',
          object: 'event',
          type: eventType || 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_123',
              object: 'checkout.session',
              amount_total: 2999,
              currency: 'usd',
              customer_email: 'test@example.com',
              payment_status: 'paid',
              status: 'complete',
            },
          },
          created: Math.floor(Date.now() / 1000),
          livemode: false,
        },
      }
    case 'twilio':
      return {
        payload: {
          SmsSid: 'SM' + Math.random().toString(36).slice(2, 34).toUpperCase(),
          SmsStatus: 'received',
          MessageStatus: 'delivered',
          From: '+1234567890',
          To: '+0987654321',
          Body: 'Test message',
          AccountSid: 'AC_test',
          MessageSid: 'SM_test',
        },
      }
    case 'resend':
      return {
        payload: {
          type: eventType || 'email.delivered',
          created_at: new Date().toISOString(),
          data: {
            email_id: 'test-email-id',
            from: 'noreply@buildr.dev',
            to: 'user@example.com',
            subject: 'Test email',
          },
        },
      }
    case 'github':
      return {
        payload: {
          action: eventType || 'opened',
          pull_request: {
            number: 42,
            title: 'Test PR',
            state: 'open',
            user: { login: 'testuser' },
          },
          repository: {
            name: 'test-repo',
            full_name: 'testuser/test-repo',
          },
        },
      }
    default:
      return {
        payload: {
          event: eventType || 'test',
          timestamp: new Date().toISOString(),
          data: { test: true },
        },
      }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const { data: project } = await db
    .from('projects')
    .select('owner_id, name')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 })
  }
  const webhookPath = body.path as string
  const provider = typeof body.provider === 'string' ? body.provider : 'stripe'
  const eventType = typeof body.eventType === 'string' ? body.eventType : undefined

  if (!webhookPath || typeof webhookPath !== 'string' || webhookPath.length > 2048) {
    return NextResponse.json({ error: 'path is required.' }, { status: 400 })
  }

  // SECURITY: path must start with '/' and not contain '@' (which would
  // allow the user to redirect the fetch to an arbitrary host via
  // http://localhost:3030@evil.com/... URL parsing).
  if (!webhookPath.startsWith('/') || webhookPath.startsWith('//') || webhookPath.includes('@') || webhookPath.includes('\\') || /[\r\n]/.test(webhookPath) || webhookPath.includes('#')) {
    return NextResponse.json({ error: 'path must start with / and be a relative path.' }, { status: 400 })
  }

  // Build only supported, deterministic test payloads.
  const allowedProviders = new Set(['stripe', 'twilio', 'resend', 'github'])
  if (!allowedProviders.has(provider)) {
    return NextResponse.json({ error: 'unsupported_provider' }, { status: 400 })
  }
  const { payload } = buildTestPayload(provider, eventType)

  // Send the test request to the API runtime sidecar (port 3030).
  // The sidecar executes the generated route.ts handler and returns the response.
  const sidecarBase = new URL((process.env.SIDECAR_URL || 'http://localhost:3030').replace(/\/$/, ''))
  const sidecarTarget = new URL(webhookPath, sidecarBase)
  if (sidecarTarget.origin !== sidecarBase.origin) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 })
  }
  sidecarTarget.searchParams.set('XTransformPort', '3030')
  sidecarTarget.searchParams.set('pid', id)
  const sidecarUrl = sidecarTarget.toString()
  const sidecarToken = process.env.SIDECAR_AUTH_TOKEN || ''
  if (process.env.NODE_ENV === 'production' && sidecarToken.length < 32) {
    return NextResponse.json({ error: 'api_runtime_not_configured' }, { status: 503 })
  }
  try {
    const sidecarRes = await fetch(sidecarUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=test,v1=test_signature',
        ...(sidecarToken ? { 'x-buildr-auth': sidecarToken } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })

    const responseText = await sidecarRes.text()
    let responseBody: unknown = responseText
    try {
      responseBody = JSON.parse(responseText)
    } catch {
      /* keep as text */
    }

    return NextResponse.json({
      ok: sidecarRes.ok,
      status: sidecarRes.status,
      response: responseBody,
      requestPayload: payload,
      requestPath: webhookPath,
      provider,
      eventType: eventType || (provider === 'stripe' ? 'checkout.session.completed' : 'test'),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sidecar_unreachable'
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        hint: 'Make sure the API runtime sidecar is running (port 3030) and the webhook route exists in your project.',
      },
      { status: 502 },
    )
  }
}
