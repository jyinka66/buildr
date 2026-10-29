// POST /api/deploy/netlify — deploys a project to Netlify via the Netlify API.
// The user provides a Netlify personal access token
// (https://app.netlify.com/user/applications#personal-access-tokens).
//
// Flow:
//   1. Zip the project files (using JSZip — same as the export engine).
//   2. Create or reuse a Netlify site (POST /api/v1/sites).
//   3. Create a deploy on that site by uploading the zip
//      (POST /api/v1/sites/{site_id}/deploys with the zip body).
//   4. Poll the deploy until ready.
//   5. Return the live URL.
//   6. Record a deployment row in Supabase + audit log.

import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const NETLIFY_API = 'https://api.netlify.com/api/v1'

interface DeployBody {
  projectId: string
  token: string
  siteName?: string
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

  // Build a zip of the project files.
  const zip = new JSZip()
  for (const f of files as { path: string; content: string }[]) {
    zip.file(f.path, f.content)
  }
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })

  // Create a site (or reuse existing by name).
  const siteName = (body.siteName || project.slug || 'buildr-app')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 63)

  const createSiteRes = await fetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${body.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: siteName,
      custom_domain: null,
    }),
  })

  let siteId: string
  if (createSiteRes.ok) {
    const site = await createSiteRes.json()
    siteId = site.id
  } else if (createSiteRes.status === 422) {
    // Site name taken — try to find the user's existing site by name.
    const listRes = await fetch(`${NETLIFY_API}/sites?name=${encodeURIComponent(siteName)}`, {
      headers: { authorization: `Bearer ${body.token}` },
    })
    if (!listRes.ok) {
      return NextResponse.json(
        { error: 'Could not create or find a Netlify site with that name.' },
        { status: 502 },
      )
    }
    const sites = await listRes.json()
    const existing = Array.isArray(sites) ? sites[0] : sites
    if (!existing?.id) {
      return NextResponse.json(
        { error: 'Site name unavailable and no existing site found.' },
        { status: 409 },
      )
    }
    siteId = existing.id
  } else {
    const txt = await createSiteRes.text()
    return NextResponse.json(
      { error: `Netlify site creation failed (${createSiteRes.status}): ${txt}` },
      { status: 502 },
    )
  }

  // Create a deploy by uploading the zip.
  const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${body.token}`,
      'content-type': 'application/zip',
      'content-length': String(zipBuffer.length),
    },
    body: new Uint8Array(zipBuffer),
  })

  if (!deployRes.ok) {
    const txt = await deployRes.text()
    return NextResponse.json(
      { error: `Netlify deploy failed (${deployRes.status}): ${txt}` },
      { status: 502 },
    )
  }

  const deploy = await deployRes.json()
  const deployId = deploy.id
  let status = deploy.state || 'uploading'
  let finalUrl = deploy.ssl_url || deploy.url

  // Poll for completion (up to 90s).
  const startTime = Date.now()
  while (
    status !== 'ready' &&
    status !== 'error' &&
    Date.now() - startTime < 90_000
  ) {
    await new Promise((r) => setTimeout(r, 4000))
    const checkRes = await fetch(`${NETLIFY_API}/deploys/${deployId}`, {
      headers: { authorization: `Bearer ${body.token}` },
    })
    if (checkRes.ok) {
      const d = await checkRes.json()
      status = d.state || status
      if (d.ssl_url) finalUrl = d.ssl_url
      else if (d.url) finalUrl = `https://${d.url}`
    }
  }

  const ok = status === 'ready'
  const logs = ok
    ? `Deployed to Netlify. URL: ${finalUrl}. Status: ${status}.`
    : `Deployment ${status}. Check Netlify dashboard for details.`

  const { data: dep } = await db
    .from('deployments')
    .insert({
      project_id: body.projectId,
      environment: 'production',
      status: ok ? 'success' : 'failed',
      url: finalUrl,
      repo: `netlify/${siteName}`,
      branch: 'main',
      commit_sha: deployId,
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
    'deploy.netlify',
    { deployId, url: finalUrl, status },
    user.id,
    body.projectId,
  )

  return NextResponse.json({
    ok,
    status,
    url: finalUrl,
    deployId,
    deploymentLogId: dep?.id,
  })
}
