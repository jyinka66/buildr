// PATCH /api/account/profile — update the signed-in user's display name.
// Email is intentionally not editable here: it is the sign-in identity and is verified at registration.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { distributedRateLimit } from '@/lib/distributed-rate-limit'
import { rateLimitedResponse } from '@/lib/rate-limit'

const MAX_NAME = 80

export async function PATCH(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }

  const rl = await distributedRateLimit(`profile:${user.id}`, { limit: 20, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  }
  // Collapse whitespace and strip control characters so the name is safe to show anywhere.
  const name = body.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (name.length < 1) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
  if ([...name].length > MAX_NAME) {
    return NextResponse.json({ error: `Name must be ${MAX_NAME} characters or fewer.` }, { status: 400 })
  }

  const { error } = await db.from('users').update({ name }).eq('id', user.id)
  if (error) return NextResponse.json({ error: 'profile_update_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, name })
}
