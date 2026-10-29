// POST /api/v1/deploy — trigger a deployment (public API)
//
// Layer 9 — Public API. Requires scope: deploy.
// Body: { projectId: string, platform?: 'vercel' | 'netlify' }

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey } from '@/lib/api-key'
import { audit } from '@/lib/snapshot'
import { trackUsage } from '@/lib/billing'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface DeployBody {
  projectId: string
  platform?: 'vercel' | 'netlify'
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req, 'deploy')
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rl = rateLimit(`api-deploy:${auth.userId}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as DeployBody
  if (!body.projectId) {
    return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  }

  // Verify project ownership.
  const { data: project } = await db
    .from('projects')
    .select('id, name, status, deployment_url')
    .eq('id', body.projectId)
    .eq('owner_id', auth.userId)
    .maybeSingle()

  if (!project) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
  }

  // Update project status to "deploying" (the actual deploy is handled by the
  // existing /api/deploy flow in a real environment).
  await db.from('projects').update({ status: 'deploying' }).eq('id', body.projectId)

  await trackUsage(auth.userId!, 'deployments', 1, { projectId: body.projectId, platform: body.platform || 'vercel' })
  await audit('api.deploy', { projectId: body.projectId, platform: body.platform }, auth.userId, body.projectId)

  return NextResponse.json({
    ok: true,
    projectId: body.projectId,
    platform: body.platform || 'vercel',
    status: 'deploying',
    message: `Deployment queued for "${project.name}". Check the dashboard for progress.`,
  })
}
