// /api/webhooks — Outgoing webhook management.
// ------------------------------------------------------------------
//   GET    — list the user's webhooks. Never returns the secret.
//   POST   — create a webhook. Generates a secret + returns it ONCE in
//            the response. Subsequent GETs will never expose the secret.
//   DELETE — delete a webhook (?id=).
//
// Session-gated via requireSessionUser().

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { generateWebhookSecret } from '@/lib/webhook'

// The full catalogue of event types a webhook can subscribe to.
// "*" is a wildcard that matches all events (set at the API layer).
export const WEBHOOK_EVENTS = [
  'project.created',
  'project.updated',
  'project.deleted',
  'project.deployed',
  'generation.completed',
  'generation.failed',
  'deployment.success',
  'deployment.failed',
  'business.launched',
  'business.updated',
  'godmode.started',
  'godmode.completed',
  'godmode.failed',
  'support.created',
  'support.resolved',
  'apikey.created',
  'apikey.revoked',
] as const

function isEvent(s: string): boolean {
  return (WEBHOOK_EVENTS as readonly string[]).includes(s)
}

interface WebhookRow {
  id: string
  url: string
  events: string
  description: string
  enabled: boolean
  last_triggered_at: string | null
  last_status: string | null
  last_status_code: number | null
  delivery_count: number
  fail_count: number
  created_at: string
  updated_at: string
}

function serialize(row: WebhookRow) {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events || '[]') as string[],
    description: row.description,
    enabled: row.enabled,
    lastTriggeredAt: row.last_triggered_at,
    lastStatus: row.last_status,
    lastStatusCode: row.last_status_code,
    deliveryCount: row.delivery_count,
    failCount: row.fail_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list webhooks (never returns the secret).
// ---------------------------------------------------------------------------

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { data: rows, error } = await db
    .from('webhooks')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    webhooks: ((rows as WebhookRow[] | null) ?? []).map(serialize),
    events: WEBHOOK_EVENTS,
  })
}

// ---------------------------------------------------------------------------
// POST — create a webhook (returns secret ONCE).
// ---------------------------------------------------------------------------

interface CreateBody {
  url?: string
  events?: string[]
  description?: string
  enabled?: boolean
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

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const url = body.url?.trim() || ''
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: 'Please provide a valid HTTP(S) URL.' },
      { status: 400 },
    )
  }

  const requestedEvents = Array.isArray(body.events) ? body.events : []
  const events = requestedEvents.map((s) => String(s)).filter(isEvent)
  if (events.length === 0) {
    return NextResponse.json(
      { error: 'Please select at least one event.' },
      { status: 400 },
    )
  }

  const description = body.description?.trim() || ''
  const enabled = body.enabled !== false

  // The secret is generated once and treated as a long-lived bearer
  // credential. It is returned only on creation — subsequent reads
  // will not expose it.
  const secret = generateWebhookSecret()

  const { data: webhook, error } = await db
    .from('webhooks')
    .insert({
      owner_id: user.id,
      url,
      secret,
      events: JSON.stringify(events),
      description,
      enabled,
    })
    .select('*')
    .single()

  if (error || !webhook) {
    return NextResponse.json({ error: error?.message || 'create_failed' }, { status: 500 })
  }

  return NextResponse.json(
    {
      webhook: serialize(webhook as WebhookRow),
      // Returned ONCE — the client must persist this.
      secret,
      message: 'Copy this secret now. It will not be shown again.',
    },
    { status: 201 },
  )
}

// ---------------------------------------------------------------------------
// DELETE — delete a webhook (?id=).
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  const { data: existing, error: findError } = await db
    .from('webhooks')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (findError || !existing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { error: deleteError } = await db.from('webhooks').delete().eq('id', existing.id)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
