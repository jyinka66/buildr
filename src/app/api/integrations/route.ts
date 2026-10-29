// GET /api/integrations — marketplace catalogue (seeded from the lib)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase-server'
import { seedIntegrations, INTEGRATION_CATALOG } from '@/lib/generator/integrations'

interface IntegrationRow {
  id: string
  key: string
  name: string
  description: string
  category: string
  icon: string
  env_vars: string[] | string
  enabled: boolean
}

export async function GET(_req: NextRequest) {
  // When Supabase isn't configured, return the static catalogue directly.
  // This keeps the marketplace functional for demos / local dev without a DB.
  if (!isSupabaseConfigured) {
    const integrations = INTEGRATION_CATALOG.map((def) => ({
      id: def.key,
      key: def.key,
      name: def.name,
      description: def.description,
      category: def.category,
      icon: def.icon,
      envVars: def.envVars,
      enabled: def.enabled,
    }))
    return NextResponse.json({ integrations })
  }

  await seedIntegrations()
  const { data: rows, error } = await db
    .from('integrations')
    .select('*')
    .order('category', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error

  const integrations = (rows as IntegrationRow[] | null ?? []).map((r) => {
    // env_vars is jsonb — Supabase may return it parsed (array) or as a JSON string.
    const raw = r.env_vars
    const envVars = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? safeJsonArray(raw)
        : []
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      category: r.category,
      icon: r.icon,
      envVars,
      enabled: r.enabled,
    }
  })
  return NextResponse.json({ integrations })
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
