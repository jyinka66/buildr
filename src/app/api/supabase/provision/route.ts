// POST /api/supabase/provision — creates a real Supabase project via the
// Supabase Management API. The user provides their Supabase access token
// (https://supabase.com/dashboard/account/tokens).
//
// Flow:
//   1. Validate the token by listing organizations (GET /v1/organizations).
//   2. Create a project in the first organization
//      (POST /v1/projects with name, organization_id, db_password, region, plan).
//   3. Wait for the project to be active (poll GET /v1/projects/{id}).
//   4. Fetch the project's API URL + anon key.
//   5. Return the connection details so the generated code can be wired to
//      the real database.
//   6. Record an audit log entry.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { encrypt } from '@/lib/crypto'

const SUPABASE_API = 'https://api.supabase.com'

interface ProvisionBody {
  name: string
  token: string
  dbPassword: string
  region?: string
  projectId?: string // optional — to record against a Buildr project
}

interface SupabaseOrg {
  id: string
  name: string
}

interface SupabaseProject {
  id: string
  name: string
  status: string
  region: string
  // present after active:
  database?: { host: string; version?: string }
  api_url?: string
  anon_key?: string
  service_key?: string
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
  const rl = rateLimit(`supabase:${user.id}`, { limit: 3, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as ProvisionBody
  if (!body.name || !body.token || !body.dbPassword) {
    return NextResponse.json(
      { error: 'name, token, and dbPassword are required.' },
      { status: 400 },
    )
  }
  if (body.dbPassword.length < 12) {
    return NextResponse.json(
      { error: 'Database password must be at least 12 characters.' },
      { status: 400 },
    )
  }

  // 1. List organizations to find the first one.
  const orgsRes = await fetch(`${SUPABASE_API}/v1/organizations`, {
    headers: {
      authorization: `Bearer ${body.token}`,
      accept: 'application/json',
    },
  })
  if (!orgsRes.ok) {
    const txt = await orgsRes.text()
    return NextResponse.json(
      { error: `Supabase auth failed (${orgsRes.status}): ${txt}` },
      { status: 502 },
    )
  }
  const orgs = (await orgsRes.json()) as SupabaseOrg[]
  if (!orgs || orgs.length === 0) {
    return NextResponse.json(
      { error: 'No organizations found for this token. Create one at supabase.com/dashboard.' },
      { status: 400 },
    )
  }
  const orgId = orgs[0].id
  const orgName = orgs[0].name

  // 2. Create the project.
  const slugName = body.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40)

  const createRes = await fetch(`${SUPABASE_API}/v1/projects`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${body.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      organization_id: orgId,
      name: slugName,
      db_password: body.dbPassword,
      region: body.region || 'us-east-1',
      plan: 'free',
    }),
  })

  if (!createRes.ok) {
    const txt = await createRes.text()
    let msg = `Supabase project creation failed (${createRes.status})`
    try {
      const j = JSON.parse(txt)
      msg = j?.message || j?.error || msg
    } catch { /* keep default */ }
    return NextResponse.json({ error: msg, status: createRes.status }, { status: 502 })
  }

  const project = (await createRes.json()) as SupabaseProject
  const projectId = project.id

  // 3. Poll for the project to become ACTIVE (up to 3 min — Supabase
  // provisioning can take a while).
  let status = project.status || 'RESTORING'
  const startTime = Date.now()
  while (
    status !== 'ACTIVE' &&
    status !== 'PAUSED' &&
    Date.now() - startTime < 180_000
  ) {
    await new Promise((r) => setTimeout(r, 5000))
    const checkRes = await fetch(`${SUPABASE_API}/v1/projects/${projectId}`, {
      headers: {
        authorization: `Bearer ${body.token}`,
        accept: 'application/json',
      },
    })
    if (checkRes.ok) {
      const d = (await checkRes.json()) as SupabaseProject
      status = d.status || status
    }
  }

  // 4. Fetch the API keys.
  let apiUrl = ''
  let anonKey = ''
  let serviceKey = ''
  const keysRes = await fetch(`${SUPABASE_API}/v1/projects/${projectId}/api-keys`, {
    headers: {
      authorization: `Bearer ${body.token}`,
      accept: 'application/json',
    },
  })
  if (keysRes.ok) {
    const keys = (await keysRes.json()) as { name: string; api_key: string }[]
    for (const k of keys) {
      if (k.name === 'anon') anonKey = k.api_key
      if (k.name === 'service_role') serviceKey = k.api_key
    }
  }
  // API URL convention: https://<project-ref>.supabase.co
  apiUrl = `https://${projectId}.supabase.co`

  const ok = status === 'ACTIVE' || status === 'PAUSED'

  // 5. If a Buildr project was specified, update its db_config with the
  // real Supabase connection details (encrypted service key at rest).
  if (body.projectId) {
    const { data: bProject } = await db
      .from('projects')
      .select('owner_id')
      .eq('id', body.projectId)
      .maybeSingle()
    if (bProject && bProject.owner_id === user.id) {
      await db
        .from('projects')
        .update({
          db_config: JSON.stringify({
            engine: 'supabase',
            orm: 'prisma',
            supabaseUrl: projectId,
            supabaseAnonKey: anonKey,
            supabaseProjectRef: projectId,
            supabaseApiUrl: apiUrl,
          }),
        })
        .eq('id', body.projectId)
    }
  }

  // 6. Audit log.
  await audit(
    'supabase.provision',
    {
      supabaseProjectId: projectId,
      name: slugName,
      org: orgName,
      region: body.region || 'us-east-1',
      status,
      apiUrl,
    },
    user.id,
    body.projectId,
  )

  return NextResponse.json({
    ok,
    status,
    supabaseProjectId: projectId,
    name: slugName,
    organization: orgName,
    region: body.region || 'us-east-1',
    apiUrl,
    anonKey,
    serviceKeyEncrypted: serviceKey ? encrypt(serviceKey) : null,
    // The service role key is returned encrypted so the client can store it
    // without ever seeing the plaintext. The .env for local dev would use
    // the anon key (public-safe).
    envVars: {
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      // For server-side: SUPABASE_SERVICE_ROLE_KEY (user must copy from dashboard)
    },
    schemaSql: '/api/projects/.../export' as string, // hint — the schema can be exported
  })
}
