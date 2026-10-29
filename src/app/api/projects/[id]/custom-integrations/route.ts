// GET  /api/projects/[id]/custom-integrations — list custom integrations
// POST /api/projects/[id]/custom-integrations — create/update a custom integration
// DELETE /api/projects/[id]/custom-integrations?key=<key> — remove a custom integration
//
// Custom integrations are user-defined connectors stored as project-level
// metadata. Each defines:
//   - key: stable identifier (e.g. "my-payment-gateway")
//   - name: display name
//   - description: what it does
//   - envVars: required env var names
//   - installSnippet: the npm install command (e.g. "npm i my-package")
//   - importSnippet: the import statement (e.g. "import { Client } from 'my-package'")
//   - usageExample: a code example showing how to use it
//
// When the code generator runs, it receives the project's custom integrations
// in the system prompt so it can wire them into generated code.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

// Custom integrations are stored in the project's db_config as a
// `customIntegrations` field (JSON array). This avoids a new table.
async function getCustomIntegrations(projectId: string): Promise<Record<string, unknown>[]> {
  const { data: project } = await db
    .from('projects')
    .select('db_config')
    .eq('id', projectId)
    .maybeSingle()
  if (!project?.db_config) return []
  let config: Record<string, unknown>
  try {
    config = typeof project.db_config === 'string'
      ? JSON.parse(project.db_config)
      : (project.db_config as Record<string, unknown>)
  } catch {
    return []
  }
  const customs = config.customIntegrations
  return Array.isArray(customs) ? customs : []
}

async function setCustomIntegrations(projectId: string, customs: Record<string, unknown>[]): Promise<void> {
  const { data: project } = await db
    .from('projects')
    .select('db_config')
    .eq('id', projectId)
    .maybeSingle()
  let config: Record<string, unknown> = {}
  try {
    config = typeof project?.db_config === 'string'
      ? JSON.parse(project.db_config || '{}')
      : (project?.db_config as Record<string, unknown>) || {}
  } catch { /* empty */ }
  config.customIntegrations = customs
  await db.from('projects').update({ db_config: JSON.stringify(config) }).eq('id', projectId)
}

async function assertOwnership(id: string) {
  const user = await requireSessionUser()
  const { data: project } = await db.from('projects').select('owner_id').eq('id', id).maybeSingle()
  if (!project) return { user, status: 404 } as const
  if (project.owner_id !== user.id) return { user, status: 403 } as const
  return { user, status: 200 } as const
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let owner
  try {
    owner = await assertOwnership(id)
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  if (owner.status === 404) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (owner.status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const customs = await getCustomIntegrations(id)
  return NextResponse.json({ integrations: customs })
}

interface CreateBody {
  key: string
  name: string
  description: string
  envVars: string[]
  installSnippet: string
  importSnippet: string
  usageExample: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    const o = await assertOwnership(id)
    user = o.user
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json()) as CreateBody
  const key = body.key?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (!key || !body.name) {
    return NextResponse.json({ error: 'key and name are required.' }, { status: 400 })
  }

  const customs = await getCustomIntegrations(id)
  const idx = customs.findIndex((c) => c.key === key)
  const entry = {
    key,
    name: body.name,
    description: body.description || '',
    envVars: body.envVars || [],
    installSnippet: body.installSnippet || '',
    importSnippet: body.importSnippet || '',
    usageExample: body.usageExample || '',
  }

  if (idx >= 0) {
    customs[idx] = entry
  } else {
    customs.push(entry)
  }

  await setCustomIntegrations(id, customs)
  await audit('integration.custom_create', { key, name: body.name }, user.id, id)

  return NextResponse.json({ ok: true, integration: entry })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    const o = await assertOwnership(id)
    user = o.user
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const customs = await getCustomIntegrations(id)
  const filtered = customs.filter((c) => c.key !== key)
  await setCustomIntegrations(id, filtered)
  await audit('integration.custom_delete', { key }, user.id, id)

  return NextResponse.json({ ok: true })
}
