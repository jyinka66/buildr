// POST /api/github — push project to a GitHub repo using a PAT.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { pushToGitHub } from '@/lib/generator/exporter'
import { requireSessionUser } from '@/lib/session'

interface Body {
  projectId: string
  token: string
  repo: string // owner/name
  branch?: string
  commitMessage?: string
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
  if (!body.projectId || !body.token || !body.repo) {
    return NextResponse.json(
      { error: 'projectId, token and repo are required.' },
      { status: 400 },
    )
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
  try {
    const result = await pushToGitHub({
      projectId: body.projectId,
      token: body.token,
      repo: body.repo,
      branch: body.branch || 'main',
      commitMessage: body.commitMessage,
    })
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', body.projectId)
      .maybeSingle()
    if (project) {
      const { error: deployErr } = await db.from('deployments').insert({
        project_id: body.projectId,
        environment: 'github',
        status: 'success',
        url: result.url,
        repo: result.repo,
        branch: result.branch,
        commit_sha: result.commitSha,
        logs: `Pushed ${result.pushedFiles} files to ${result.repo}@${result.branch}`,
      })
      if (deployErr) throw deployErr
      const { error: updateErr } = await db
        .from('projects')
        .update({ deployment_url: result.url, status: 'deployed' })
        .eq('id', body.projectId)
      if (updateErr) throw updateErr
    }
    return NextResponse.json({ deployment: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'github_push_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
