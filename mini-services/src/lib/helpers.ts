// Small shared helpers.
import { db } from '@/lib/db'
import type {
  DbConfig,
  FileOp,
  GenerationView,
  IntegrationDef,
  ProjectView,
  StackKey,
  StylingKey,
} from '@/lib/types'
import { INTEGRATION_CATALOG } from '@/lib/generator/integrations'
import { PROVIDER_CATALOG } from '@/lib/llm/router'

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'buildr-app'
  )
}

export function parseDbConfig(
  raw: string | Record<string, unknown> | null | undefined,
): DbConfig {
  try {
    const obj = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Partial<DbConfig>
    return {
      engine: (obj.engine as DbConfig['engine']) ?? 'sqlite',
      orm: (obj.orm as DbConfig['orm']) ?? 'prisma',
      supabaseUrl: obj.supabaseUrl,
      supabaseAnonKey: obj.supabaseAnonKey,
    }
  } catch {
    return { engine: 'sqlite', orm: 'prisma' }
  }
}

export function parseIntegrations(
  raw: string | string[] | null | undefined,
): string[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function parseFileOps(
  raw: string | unknown[] | null | undefined,
): FileOp[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? (arr as FileOp[]) : []
  } catch {
    return []
  }
}

export function isStackKey(s: string): s is StackKey {
  return ['nextjs', 'node-express', 'react-vite', 'static-html'].includes(s)
}

export function isStylingKey(s: string): s is StylingKey {
  return ['tailwind', 'bootstrap', 'plain'].includes(s)
}

// Row shape returned by Supabase for a `projects` row.
export interface ProjectDbRow {
  id: string
  name: string
  slug: string
  description: string
  stack: string
  styling: string
  prompt: string
  provider_id: string | null
  integrations: string | string[]
  db_config: string | Record<string, unknown>
  status: string
  preview_url: string | null
  deployment_url: string | null
  owner_id: string
  workspace_id: string | null
  created_at: string
  updated_at: string
}

export async function toProjectView(
  row: ProjectDbRow | null,
): Promise<ProjectView | null> {
  if (!row) return null
  const { count } = await db
    .from('project_files')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', row.id)
  const fileCount = count ?? 0
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    stack: row.stack as StackKey,
    styling: row.styling as StylingKey,
    prompt: row.prompt,
    providerId: row.provider_id,
    integrations: parseIntegrations(row.integrations),
    dbConfig: parseDbConfig(row.db_config),
    status: row.status as ProjectView['status'],
    previewUrl: row.preview_url,
    deploymentUrl: row.deployment_url,
    fileCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Row shape for a `generations` row.
export interface GenerationDbRow {
  id: string
  role: string
  content: string
  file_ops: string | unknown[]
  provider_id: string | null
  tokens: number
  duration_ms: number
  created_at: string
}

export function toGenerationView(row: GenerationDbRow): GenerationView {
  return {
    id: row.id,
    role: row.role as GenerationView['role'],
    content: row.content,
    fileOps: parseFileOps(row.file_ops),
    providerId: row.provider_id,
    tokens: row.tokens,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Catalog views for the UI (without secrets).
// ---------------------------------------------------------------------------

export function getIntegrationCatalog(): IntegrationDef[] {
  return INTEGRATION_CATALOG
}

export function getProviderCatalog(): (typeof PROVIDER_CATALOG)[number][] {
  return PROVIDER_CATALOG
}
