// POST /api/import/github — imports an existing GitHub repository as a new
// Buildr project. Fetches the repo's file tree via the GitHub Contents API,
// downloads each file, and creates a project with those files.
//
// The user provides:
//   - repo: "owner/name" of the GitHub repo
//   - token: a GitHub personal access token (for private repos + rate limits)
//   - branch: optional branch name (defaults to the repo's default branch)
//   - name: optional project name (defaults to the repo name)
//
// We fetch the file tree recursively, download each file's raw content,
// filter out node_modules/.git/dist, and create a project with the files.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { slugify } from '@/lib/helpers'
import { guessLanguage } from '@/lib/llm/code-generator'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface GitHubContent {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  content?: string
  encoding?: string
  download_url?: string
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  '.cache', '.turbo', 'coverage', '.vscode', '.idea',
  '__pycache__', '.venv', 'vendor',
])
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.mp3', '.wav',
  '.zip', '.tar', '.gz', '.lock',
])
const MAX_FILES = 200
const MAX_FILE_SIZE = 100_000 // 100KB per file

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
  const rl = rateLimit(`import:${user.id}`, { limit: 3, windowMs: 600_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = await req.json()
  const repo = body.repo as string
  const token = body.token as string
  const branch = (body.branch as string) || undefined
  const name = (body.name as string) || ''

  if (!repo || !token) {
    return NextResponse.json(
      { error: 'repo and token are required.' },
      { status: 400 },
    )
  }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    return NextResponse.json(
      { error: 'repo must be in "owner/name" form.' },
      { status: 400 },
    )
  }

  const headers: HeadersInit = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  // Determine the default branch if not specified.
  let targetBranch = branch || ''
  if (!targetBranch) {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers })
    if (!repoRes.ok) {
      return NextResponse.json(
        { error: `Could not access repo ${repo} (${repoRes.status}). Check the token and repo name.` },
        { status: 402 },
      )
    }
    const repoData = await repoRes.json()
    targetBranch = repoData.default_branch || 'main'
  }

  // Fetch the file tree recursively.
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/trees/${encodeURIComponent(targetBranch)}?recursive=1`,
    { headers },
  )
  if (!treeRes.ok) {
    return NextResponse.json(
      { error: `Could not fetch repo tree (${treeRes.status}).` },
      { status: 502 },
    )
  }
  const tree = await treeRes.json()
  const treeItems = (tree.tree || []) as { path: string; type: string; size?: number }[]

  // Filter to text files, skip large/binary/node_modules.
  const filesToFetch = treeItems
    .filter((item) => item.type === 'blob')
    .filter((item) => {
      const parts = item.path.split('/')
      if (parts.some((p) => SKIP_DIRS.has(p))) return false
      const ext = '.' + (item.path.split('.').pop() || '')
      if (SKIP_EXTENSIONS.has(ext.toLowerCase())) return false
      if (item.size && item.size > MAX_FILE_SIZE) return false
      return true
    })
    .slice(0, MAX_FILES)

  if (filesToFetch.length === 0) {
    return NextResponse.json(
      { error: 'No importable files found in this repository.' },
      { status: 400 },
    )
  }

  // Download each file's content. We use the raw content URL for efficiency.
  const projectFiles: { path: string; content: string; language: string }[] = []
  for (const item of filesToFetch) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${encodeURIComponent(targetBranch)}/${item.path}`
    try {
      const rawRes = await fetch(rawUrl, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!rawRes.ok) continue
      const content = await rawRes.text()
      if (content && content.length <= MAX_FILE_SIZE) {
        projectFiles.push({
          path: item.path,
          content,
          language: guessLanguage(item.path),
        })
      }
    } catch {
      /* skip individual file failures */
    }
  }

  if (projectFiles.length === 0) {
    return NextResponse.json(
      { error: 'Could not download any files from the repository.' },
      { status: 502 },
    )
  }

  // Detect the stack from the files.
  let detectedStack = 'nextjs'
  if (projectFiles.some((f) => f.path.startsWith('app/') && f.path.endsWith('.tsx'))) {
    detectedStack = 'nextjs'
  } else if (projectFiles.some((f) => f.path.startsWith('src/routes/') && f.path.endsWith('.tsx'))) {
    detectedStack = 'remix'
  } else if (projectFiles.some((f) => f.path.endsWith('.astro'))) {
    detectedStack = 'astro'
  } else if (projectFiles.some((f) => f.path.endsWith('.svelte'))) {
    detectedStack = 'sveltekit'
  } else if (projectFiles.some((f) => f.path.includes('express') || f.path === 'src/index.ts')) {
    detectedStack = 'node-express'
  } else if (projectFiles.some((f) => f.path === 'src/App.tsx' || f.path === 'src/App.jsx')) {
    detectedStack = 'react-vite'
  }

  // Create the project.
  const projectName = name || repoName
  const slug = await uniqueSlug(slugify(projectName))

  const { data: project, error } = await db
    .from('projects')
    .insert({
      name: projectName,
      slug,
      description: `Imported from github.com/${owner}/${repoName} (${targetBranch})`,
      stack: detectedStack,
      styling: 'tailwind',
      prompt: `Imported from GitHub: ${repo}`,
      status: 'preview-ready',
      owner_id: user.id,
    })
    .select('id, slug')
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message || 'create_failed' }, { status: 500 })
  }

  // Insert the files.
  await db.from('project_files').insert(
    projectFiles.map((f) => ({
      project_id: project.id,
      path: f.path,
      content: f.content,
      language: f.language,
      generated: true,
    })),
  )

  await audit(
    'project.import_github',
    { repo, branch: targetBranch, fileCount: projectFiles.length },
    user.id,
    project.id,
  )

  return NextResponse.json({
    ok: true,
    projectId: project.id,
    slug: project.slug,
    fileCount: projectFiles.length,
    stack: detectedStack,
    repo: `${owner}/${repoName}`,
    branch: targetBranch,
  }, { status: 201 })
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data } = await db.from('projects').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
    candidate = `${base}-${i++}`
  }
}
