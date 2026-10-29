// GET /api/projects/[id]/vulnerabilities — scans the project's package.json
// dependencies against the npm audit API (https://registry.npmjs.org/-/npm/v1/security/audits).
// Returns known CVEs with severity, title, and fix recommendation.
//
// We POST the project's package.json deps to the npm audit endpoint and
// parse the advisory results. This is the same data `npm audit` uses.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

interface AuditResponse {
  advisories?: Record<string, {
    id: number
    title: string
    module_name: string
    severity: 'low' | 'moderate' | 'high' | 'critical'
    url: string
    vulnerable_versions: string
    patched_versions: string
    recommendation: string
    overview: string
  }>
  metadata?: {
    vulnerabilities: {
      info: number
      low: number
      moderate: number
      high: number
      critical: number
      total: number
    }
  }
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

  // Fetch the project's package.json.
  const { data: pkgFile } = await db
    .from('project_files')
    .select('content')
    .eq('project_id', id)
    .eq('path', 'package.json')
    .maybeSingle()

  if (!pkgFile?.content) {
    return NextResponse.json({
      ok: true,
      vulnerabilities: [],
      message: 'No package.json found — vulnerability scan skipped.',
    })
  }

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(pkgFile.content)
  } catch {
    return NextResponse.json({ error: 'Invalid package.json' }, { status: 400 })
  }

  // Build the npm audit payload.
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }

  if (Object.keys(allDeps).length === 0) {
    return NextResponse.json({
      ok: true,
      vulnerabilities: [],
      message: 'No dependencies to scan.',
    })
  }

  // Convert "next": "^16.1.1" → { "next": { "version": "^16.1.1", "integrity": "" } }
  const auditPayload: Record<string, { version: string }> = {}
  for (const [name, version] of Object.entries(allDeps)) {
    auditPayload[name] = { version: String(version) }
  }

  try {
    const auditRes = await fetch('https://registry.npmjs.org/-/npm/v1/security/audits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'buildr-scan',
        version: '1.0.0',
        dependencies: auditPayload,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!auditRes.ok) {
      return NextResponse.json({
        ok: true,
        vulnerabilities: [],
        message: `npm audit API returned ${auditRes.status} — scan skipped.`,
      })
    }

    const auditData = (await auditRes.json()) as AuditResponse
    const advisories = auditData.advisories || {}
    const vulnerabilities = Object.values(advisories).map((a) => ({
      id: a.id,
      module: a.module_name,
      title: a.title,
      severity: a.severity,
      url: a.url,
      vulnerableVersions: a.vulnerable_versions,
      patchedVersions: a.patched_versions,
      recommendation: a.recommendation,
      overview: a.overview.slice(0, 300),
    }))

    const summary = auditData.metadata?.vulnerabilities || {
      info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: vulnerabilities.length,
    }

    await audit('security.scan', { total: summary.total, critical: summary.critical, high: summary.high }, user.id, id)

    return NextResponse.json({
      ok: true,
      vulnerabilities,
      summary,
      scannedDependencies: Object.keys(allDeps).length,
    })
  } catch (err) {
    return NextResponse.json({
      ok: true,
      vulnerabilities: [],
      message: 'Could not reach npm audit API — scan skipped.',
      error: err instanceof Error ? err.message : 'unknown',
    })
  }
}
