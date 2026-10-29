// POST /api/projects/[id]/branches — creates a GitHub branch + optional PR
// from the project's current files. Uses the GitHub API.
//
// Body:
//   - token: GitHub PAT
//   - repo: "owner/name"
//   - branchName: the new branch name
//   - baseBranch: the base branch to create from (default: repo's default)
//   - createPR: boolean — also create a pull request
//   - prTitle: PR title (required if createPR=true)
//   - prBody: PR description (optional)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const GITHUB_API = 'https://api.github.com'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const rl = rateLimit(`branches:${user.id}`, { limit: 10, windowMs: 300_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, name')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const token = body.token as string
  const repo = body.repo as string
  const branchName = body.branchName as string
  const baseBranch = body.baseBranch as string | undefined
  const createPR = body.createPR as boolean
  const prTitle = body.prTitle as string | undefined
  const prBody = body.prBody as string | undefined

  if (!token || !repo || !branchName) {
    return NextResponse.json({ error: 'token, repo, and branchName are required.' }, { status: 400 })
  }
  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    return NextResponse.json({ error: 'repo must be "owner/name".' }, { status: 400 })
  }

  const ghHeaders: HeadersInit = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'content-type': 'application/json',
  }

  // Determine the base branch if not specified.
  let base = baseBranch || ''
  if (!base) {
    const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}`, { headers: ghHeaders })
    if (!repoRes.ok) {
      return NextResponse.json({ error: `Repo not found (${repoRes.status}).` }, { status: 404 })
    }
    const repoData = await repoRes.json()
    base = repoData.default_branch || 'main'
  }

  // Get the base branch's SHA.
  const refRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repoName}/git/refs/heads/${encodeURIComponent(base)}`,
    { headers: ghHeaders },
  )
  if (!refRes.ok) {
    return NextResponse.json({ error: `Base branch ${base} not found.` }, { status: 404 })
  }
  const refData = await refRes.json()
  const baseSha = refData?.object?.sha

  if (!baseSha) {
    return NextResponse.json({ error: 'Could not get base branch SHA.' }, { status: 500 })
  }

  // Create the new branch.
  const createBranchRes = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}/git/refs`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  })

  if (!createBranchRes.ok) {
    const txt = await createBranchRes.text()
    let msg = `Branch creation failed (${createBranchRes.status})`
    try {
      const j = JSON.parse(txt)
      msg = j?.message || msg
    } catch { /* keep default */ }
    return NextResponse.json({ error: msg }, { status: createBranchRes.status === 422 ? 409 : 502 })
  }

  // Push the project files to the new branch.
  const { data: files } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  let pushedFiles = 0
  for (const file of (files ?? []) as { path: string; content: string }[]) {
    // Check if file exists on the branch.
    const existingRes = await fetch(
      `${GITHUB_API}/repos/${owner}/${repoName}/contents/${file.path}?ref=${encodeURIComponent(branchName)}`,
      { headers: ghHeaders },
    )
    const existing = existingRes.ok ? await existingRes.json() : null

    const upRes = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}/contents/${file.path}`, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify({
        message: `chore(buildr): sync ${file.path}`,
        content: Buffer.from(file.content).toString('base64'),
        branch: branchName,
        ...(existing?.sha ? { sha: existing.sha } : {}),
      }),
    })
    if (upRes.ok) pushedFiles++
  }

  let prUrl: string | null = null
  if (createPR && prTitle) {
    const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repoName}/pulls`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        title: prTitle,
        body: prBody || `Synced ${pushedFiles} files from Buildr.`,
        head: branchName,
        base,
      }),
    })
    if (prRes.ok) {
      const prData = await prRes.json()
      prUrl = prData?.html_url || null
    }
  }

  await audit(
    'github.branch_pr',
    { repo, branch: branchName, base, pushedFiles, prUrl },
    user.id,
    id,
  )

  return NextResponse.json({
    ok: true,
    branch: branchName,
    base,
    pushedFiles,
    prUrl,
    repoUrl: `https://github.com/${owner}/${repoName}/tree/${encodeURIComponent(branchName)}`,
  })
}
