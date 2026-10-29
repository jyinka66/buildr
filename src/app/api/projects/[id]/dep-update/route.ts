// GET /api/projects/[id]/dep-update — checks the project's package.json
// dependencies against the npm registry for outdated versions.
// Returns a list of packages with current vs latest version + whether
// the update is a major/minor/patch bump.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

interface OutdatedPackage {
  name: string
  current: string
  latest: string
  type: 'major' | 'minor' | 'patch' | 'up-to-date'
  isDev: boolean
}

export async function GET(
  _req: NextRequest,
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
  const { data: project } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch package.json.
  const { data: pkgFile } = await db
    .from('project_files')
    .select('content')
    .eq('project_id', id)
    .eq('path', 'package.json')
    .maybeSingle()

  if (!pkgFile?.content) {
    return NextResponse.json({
      packages: [],
      message: 'No package.json found.',
    })
  }

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(pkgFile.content)
  } catch {
    return NextResponse.json({ error: 'Invalid package.json' }, { status: 400 })
  }

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }

  if (Object.keys(allDeps).length === 0) {
    return NextResponse.json({ packages: [], message: 'No dependencies found.' })
  }

  // Fetch latest versions from npm registry (batched — one request per package).
  // We limit to 30 deps to avoid rate limiting.
  const depEntries = Object.entries(allDeps).slice(0, 30)
  const devDepNames = new Set(Object.keys(pkg.devDependencies || {}))

  const results: OutdatedPackage[] = []

  // Batch requests (5 at a time to avoid overwhelming npm).
  const batchSize = 5
  for (let i = 0; i < depEntries.length; i += batchSize) {
    const batch = depEntries.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(async ([name, currentVersion]) => {
        const cleanVersion = String(currentVersion).replace(/[\^~>=<]/g, '').split(' ')[0]
        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
          signal: AbortSignal.timeout(5000),
          headers: { accept: 'application/json' },
        })
        if (!res.ok) return null
        const data = await res.json()
        const latest = data.version as string
        if (!latest) return null

        // Determine update type.
        const currentParts = cleanVersion.split('.').map((n) => parseInt(n, 10) || 0)
        const latestParts = latest.split('.').map((n) => parseInt(n, 10) || 0)

        let type: OutdatedPackage['type'] = 'up-to-date'
        if (latestParts[0] > currentParts[0]) type = 'major'
        else if (latestParts[1] > currentParts[1]) type = 'minor'
        else if (latestParts[2] > currentParts[2]) type = 'patch'

        return {
          name,
          current: cleanVersion,
          latest,
          type,
          isDev: devDepNames.has(name),
        } as OutdatedPackage
      }),
    )

    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value)
      }
    }
  }

  // Sort: major updates first, then minor, then patch.
  const typeOrder = { major: 0, minor: 1, patch: 2, 'up-to-date': 3 }
  results.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])

  const summary = {
    total: results.length,
    major: results.filter((r) => r.type === 'major').length,
    minor: results.filter((r) => r.type === 'minor').length,
    patch: results.filter((r) => r.type === 'patch').length,
    upToDate: results.filter((r) => r.type === 'up-to-date').length,
  }

  await audit('dep.check', { total: summary.total, major: summary.major }, user.id, id)

  return NextResponse.json({
    packages: results,
    summary,
  })
}
