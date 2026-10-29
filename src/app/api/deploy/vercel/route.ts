// POST /api/deploy/vercel — deploys a project to Vercel via the Vercel API.
// The user provides a Vercel access token (https://vercel.com/account/tokens).
// We create a deployment by uploading the project files directly to the
// Vercel deployment endpoint (v13 deployments API — file-by-file).
//
// Flow:
//   1. Fetch the project's files from Supabase.
//   2. Create a deployment via POST /v13/deployments with the file contents
//      inlined as "files" (base64 or utf-8). We use the "files" upload mode
//      where each file is sent as { file, data, encoding }.
//   3. Wait for the deployment to be READY (poll the deployment status).
//   4. Return the live URL (xxx.vercel.app).
//   5. Record a deployment row in Supabase + audit log.
//
// The Vercel API requires the project name + files. If the project doesn't
// exist on Vercel, the deployment creates it implicitly.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const VERCEL_API = 'https://api.vercel.com'

interface VercelFile {
  file: string
  data: string
  encoding: 'utf-8' | 'base64'
}

interface DeployBody {
  projectId: string
  token: string
  projectName?: string
  target?: 'production' | 'preview'
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
  const rl = rateLimit(`deploy:${user.id}`, { limit: 5, windowMs: 300_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as DeployBody
  if (!body.projectId || !body.token) {
    return NextResponse.json(
      { error: 'projectId and token are required.' },
      { status: 400 },
    )
  }

  // Verify ownership.
  const { data: project, error: pErr } = await db
    .from('projects')
    .select('id, name, slug, owner_id')
    .eq('id', body.projectId)
    .maybeSingle()
  if (pErr || !project) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch project files.
  const { data: files, error: fErr } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', body.projectId)
  if (fErr || !files || files.length === 0) {
    return NextResponse.json(
      { error: 'No files to deploy. Generate code first.' },
      { status: 400 },
    )
  }

  // Build the Vercel files payload. Binary-ish files use base64, text uses utf-8.
  const vercelFiles: VercelFile[] = files.map((f: { path: string; content: string }) => ({
    file: f.path,
    data: f.content,
    encoding: 'utf-8' as const,
  }))

  const projectName = (body.projectName || project.slug || 'buildr-app')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 100)

  // Create the deployment.
  const createRes = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${body.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      files: vercelFiles,
      target: body.target || 'production',
      projectSettings: {
        framework: 'nextjs',
        buildCommand: 'next build',
        outputDirectory: '.next',
        installCommand: 'npm install',
      },
    }),
  })

  if (!createRes.ok) {
    const txt = await createRes.text()
    let msg = `Vercel API error (${createRes.status})`
    try {
      const j = JSON.parse(txt)
      msg = j?.error?.message || j?.message || msg
    } catch { /* keep default */ }
    return NextResponse.json(
      { error: msg, status: createRes.status },
      { status: 502 },
    )
  }

  const deployment = await createRes.json()
  const deploymentId = deployment?.id
  const initialUrl = deployment?.url

  // Poll for deployment status (up to 60s).
  let status = deployment?.status || 'QUEUED'
  let finalUrl = initialUrl ? `https://${initialUrl}` : null
  const startTime = Date.now()
  while (
    status !== 'READY' &&
    status !== 'ERROR' &&
    Date.now() - startTime < 60_000
  ) {
    await new Promise((r) => setTimeout(r, 3000))
    const checkRes = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { authorization: `Bearer ${body.token}` },
    })
    if (checkRes.ok) {
      const d = await checkRes.json()
      status = d?.status || status
      if (d?.url) finalUrl = `https://${d.url}`
    }
  }

  const ok = status === 'READY'
  const logs = ok
    ? `Deployed to Vercel. URL: ${finalUrl}. Status: ${status}.`
    : `Deployment ${status}. Check Vercel dashboard for details.`

  // Record deployment.
  const { data: dep } = await db
    .from('deployments')
    .insert({
      project_id: body.projectId,
      environment: body.target === 'preview' ? 'preview' : 'production',
      status: ok ? 'success' : 'failed',
      url: finalUrl,
      repo: `vercel/${projectName}`,
      branch: body.target || 'production',
      commit_sha: deploymentId,
      logs,
    })
    .select('id')
    .single()

  if (ok) {
    await db
      .from('projects')
      .update({ deployment_url: finalUrl, status: 'deployed' })
      .eq('id', body.projectId)
  }

  await audit(
    'deploy.vercel',
    { deploymentId, url: finalUrl, status },
    user.id,
    body.projectId,
  )

  return NextResponse.json({
    ok,
    status,
    url: finalUrl,
    deploymentId,
    deploymentLogId: dep?.id,
  })
}
