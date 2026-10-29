// GET /api/projects/[id]/logs — returns recent log entries from the API
// runtime sidecar (port 3030). The sidecar logs each request it processes
// (method, path, status, duration). We read from the audit_log table
// (action='api_test' or 'route_execution') and format them as a log stream.
//
// Also returns the sidecar's health + connection status.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

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

  // Fetch recent audit log entries (API tests + route executions + generations).
  const { data: logs, error } = await db
    .from('audit_log')
    .select('action, details, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Format logs with severity + message.
  const formattedLogs = (logs ?? []).map((entry: Record<string, unknown>) => {
    const action = entry.action as string
    const details = typeof entry.details === 'string' ? JSON.parse(entry.details || '{}') : (entry.details || {})
    const time = new Date(entry.created_at as string).toISOString()

    let level: 'info' | 'warning' | 'error' = 'info'
    let message = action

    switch (action) {
      case 'api_test': {
        const status = details.status as number
        level = status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info'
        message = `${details.method} ${details.path} → ${status} (${details.durationMs}ms)`
        break
      }
      case 'image.generate':
        level = 'info'
        message = `Image generated: ${details.category || 'general'} → ${details.path}`
        break
      case 'refactor.apply':
        level = 'info'
        message = `Refactor applied: ${details.filesChanged} files changed`
        break
      case 'refactor.preview':
        level = 'info'
        message = `Refactor previewed: ${details.filesAffected} files affected`
        break
      case 'security.scan': {
        const total = details.total as number
        level = total > 0 ? 'warning' : 'info'
        message = `Security scan: ${total} vulnerabilities found`
        break
      }
      case 'deploy.vercel':
      case 'deploy.netlify':
        level = details.status === 'success' ? 'info' : 'error'
        message = `Deploy to ${action.split('.')[1]}: ${details.status}`
        break
      case 'github.branch_pr':
        level = 'info'
        message = `GitHub branch/PR: ${details.branch} (${details.pushedFiles} files)`
        break
      case 'schema.design':
        level = 'info'
        message = `Schema designed: ${details.tables} tables, ${details.relations} relations`
        break
      case 'feature_flag.toggle':
        level = 'info'
        message = `Feature flag "${details.key}" ${details.enabled ? 'enabled' : 'disabled'}`
        break
      case 'ab_test.create':
        level = 'info'
        message = `A/B test created: "${details.name}" (${details.variants} variants)`
        break
      default:
        level = 'info'
        message = action
    }

    return {
      level,
      action,
      message,
      time,
      details,
    }
  })

  // Check sidecar health.
  let sidecarHealth: { ok: boolean; port: number; supabase: boolean } | null = null
  try {
    const sidecarUrl = (process.env.SIDECAR_URL || 'http://localhost:3030').replace(/\/$/, '')
    const sidecarToken = process.env.SIDECAR_AUTH_TOKEN || ''
    const healthRes = await fetch(`${sidecarUrl}/__health`, {
      headers: sidecarToken ? { 'x-buildr-auth': sidecarToken } : {},
      signal: AbortSignal.timeout(2000),
    })
    if (healthRes.ok) {
      sidecarHealth = await healthRes.json()
    }
  } catch {
    sidecarHealth = null
  }

  // Summary stats.
  const totalLogs = formattedLogs.length
  const errors = formattedLogs.filter((l) => l.level === 'error').length
  const warnings = formattedLogs.filter((l) => l.level === 'warning').length

  return NextResponse.json({
    logs: formattedLogs,
    summary: {
      total: totalLogs,
      errors,
      warnings,
      info: totalLogs - errors - warnings,
    },
    sidecar: {
      running: !!sidecarHealth,
      health: sidecarHealth,
    },
  })
}
