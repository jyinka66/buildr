// GET  /api/providers       — list providers (no secrets returned) [any authenticated user]
// POST /api/providers       — upsert a provider config [ADMIN ONLY]
// PATCH /api/providers/[key] — update enabled/health/key [ADMIN ONLY]
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadProviders, seedProviders } from '@/lib/llm/router'
import { requireAdmin } from '@/lib/admin'

export async function GET() {
  await seedProviders()
  const providers = await loadProviders()
  // Mask API keys.
  const masked = providers.map((p) => ({
    ...p,
    apiKey:
      p.key === 'zai'
        ? '(managed)'
        : p.apiKey
          ? p.apiKey.slice(0, 4) + '••••••' + p.apiKey.slice(-4)
          : '',
    hasKey: Boolean(p.apiKey && p.apiKey !== '(managed)'),
  }))
  return NextResponse.json({ providers: masked })
}

interface UpdateBody {
  key: string
  apiKey?: string
  enabled?: boolean
  weight?: number
  model?: string
  baseUrl?: string
  speciality?: string
}

export async function POST(req: NextRequest) {
  // SECURITY: only admins can modify provider configs — otherwise any
  // logged-in user could point baseUrl at their own server and steal
  // prompts + keys, or disable providers to take generation down.
  try {
    await requireAdmin()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    if ((err as { status?: number }).status === 403) {
      return NextResponse.json({ error: 'forbidden — admin access required' }, { status: 403 })
    }
    throw err
  }
  await seedProviders()
  const body = (await req.json()) as UpdateBody
  const { data: existing } = await db
    .from('llm_providers')
    .select('id')
    .eq('key', body.key)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 })
  }
  const data: Record<string, unknown> = {}
  if (typeof body.apiKey === 'string' && body.apiKey.trim() && body.key !== 'zai') {
    data.api_key = body.apiKey.trim()
  }
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body.weight === 'number') data.weight = body.weight
  if (typeof body.model === 'string' && body.model) data.model = body.model
  if (typeof body.baseUrl === 'string') data.base_url = body.baseUrl || null
  if (typeof body.speciality === 'string') data.speciality = body.speciality
  const { error } = await db
    .from('llm_providers')
    .update(data)
    .eq('key', body.key)
  if (error) throw error
  const providers = await loadProviders()
  return NextResponse.json({
    providers: providers.map((p) => ({
      ...p,
      apiKey:
        p.key === 'zai'
          ? '(managed)'
          : p.apiKey
            ? p.apiKey.slice(0, 4) + '••••••' + p.apiKey.slice(-4)
            : '',
      hasKey: Boolean(p.apiKey && p.apiKey !== '(managed)'),
    })),
  })
}
