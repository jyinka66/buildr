// GET /api/admin/stats — platform-wide stats.
// ------------------------------------------------------------------
// Returns aggregate counts across the whole platform. Used by the admin
// console overview tab. Admin-only via requireAdmin().

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

export async function GET() {
  try {
    await requireAdmin()
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    throw err
  }

  const [
    totalUsers,
    disabledUsers,
    admins,
    totalProjects,
    totalBusinesses,
    totalGodModeGoals,
    totalWorkspaces,
    totalWebhooks,
    totalApiKeys,
    totalSupportTickets,
    openSupportTickets,
    totalCronJobs,
    totalDeployments,
    totalUsageEvents,
    activeSubscriptions,
    totalAuditLogs,
  ] = await Promise.all([
    db.from('users').select('id', { count: 'exact', head: true }),
    db.from('users').select('id', { count: 'exact', head: true }).eq('is_disabled', true),
    db.from('users').select('id', { count: 'exact', head: true }).eq('is_admin', true),
    db.from('projects').select('id', { count: 'exact', head: true }),
    db.from('businesses').select('id', { count: 'exact', head: true }),
    db.from('god_mode_goals').select('id', { count: 'exact', head: true }),
    db.from('workspaces').select('id', { count: 'exact', head: true }),
    db.from('webhooks').select('id', { count: 'exact', head: true }),
    db.from('api_keys').select('id', { count: 'exact', head: true }),
    db.from('support_tickets').select('id', { count: 'exact', head: true }),
    db.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['new', 'triaged', 'answering', 'escalated']),
    db.from('cron_jobs').select('id', { count: 'exact', head: true }),
    db.from('deployments').select('id', { count: 'exact', head: true }),
    db.from('usage_events').select('id', { count: 'exact', head: true }),
    db.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('audit_log').select('id', { count: 'exact', head: true }),
  ])

  // Users created in the last 7 days (growth signal).
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const { count: newUsers7dCount } = await db
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since.toISOString())
  const newUsers7d = newUsers7dCount ?? 0

  return NextResponse.json({
    stats: {
      users: {
        total: totalUsers.count ?? 0,
        disabled: disabledUsers.count ?? 0,
        admins: admins.count ?? 0,
        new7d: newUsers7d,
      },
      projects: totalProjects.count ?? 0,
      businesses: totalBusinesses.count ?? 0,
      godModeGoals: totalGodModeGoals.count ?? 0,
      workspaces: totalWorkspaces.count ?? 0,
      webhooks: totalWebhooks.count ?? 0,
      apiKeys: totalApiKeys.count ?? 0,
      cronJobs: totalCronJobs.count ?? 0,
      deployments: totalDeployments.count ?? 0,
      usageEvents: totalUsageEvents.count ?? 0,
      activeSubscriptions: activeSubscriptions.count ?? 0,
      auditLogs: totalAuditLogs.count ?? 0,
      support: {
        total: totalSupportTickets.count ?? 0,
        open: openSupportTickets.count ?? 0,
      },
    },
  })
}
