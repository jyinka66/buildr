// POST /api/deploy — record a "deployment" (preview/production) target.
// In this sandbox we can't actually spin up remote containers, but we
// create a deploy record + a preview URL pointing at the in-app preview
// endpoint so the UX is honest: "deployed to preview" opens the live
// preview iframe route.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface Body {
  projectId: string
  environment: 'preview' | 'production'
}

interface ProjectRow {
  id: string
  name: string
  preview_url: string | null
  deployment_url: string | null
}

interface DeploymentRow {
  id: string
  project_id: string
  environment: string
  status: string
  url: string | null
  repo: string | null
  branch: string | null
  commit_sha: string | null
  logs: string
  created_at: string
  updated_at: string
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
  const body = (await req.json()) as Body
  if (!body.projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }
  // Verify project ownership:
  const { data: ownerProject } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', body.projectId)
    .maybeSingle()
  if (!ownerProject || ownerProject.owner_id !== user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const env = body.environment === 'production' ? 'production' : 'preview'
  const { data: project, error: projectErr } = await db
    .from('projects')
    .select('*')
    .eq('id', body.projectId)
    .maybeSingle()
  if (projectErr) throw projectErr
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const p = project as ProjectRow

  const url = `/api/projects/${p.id}/preview`
  const { data: deployment, error: deployErr } = await db
    .from('deployments')
    .insert({
      project_id: p.id,
      environment: env,
      status: 'success',
      url,
      logs: `Promoted ${p.name} to ${env}. Preview URL generated.`,
    })
    .select('*')
    .single()
  if (deployErr) throw deployErr
  const d = deployment as DeploymentRow

  const { error: updateErr } = await db
    .from('projects')
    .update({
      preview_url: env === 'preview' ? url : p.preview_url,
      deployment_url: env === 'production' ? url : p.deployment_url,
      status: env === 'production' ? 'deployed' : 'preview-ready',
    })
    .eq('id', p.id)
  if (updateErr) throw updateErr

  return NextResponse.json({
    deployment: {
      ...d,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    },
  })
}

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  if (projectId) {
    // Verify project ownership:
    const { data: ownerProject } = await db
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle()
    if (!ownerProject || ownerProject.owner_id !== user.id) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
  }
  let query = db
    .from('deployments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (projectId) {
    query = query.eq('project_id', projectId)
  }
  const { data: rows, error } = await query
  if (error) throw error
  return NextResponse.json({
    deployments: (rows as DeploymentRow[] | null ?? []).map((d) => ({
      ...d,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
  })
}
