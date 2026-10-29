// GET /api/account/export — downloads ALL of the user's data as JSON (GDPR Article 20)
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET() {
  try {
    const user = await requireSessionUser()
    const [
      { data: profile },
      { data: projectsRaw },
      { data: businesses },
      { data: goals },
      { data: campaigns },
      { data: ticketsRaw },
      { data: cronJobs },
      { data: healActions },
      { data: notifications },
      { data: apiKeys },
      { data: subscription },
      { data: webhooks },
      { data: auditLogs },
    ] = await Promise.all([
      db.from('users').select('id, email, name, email_verified, is_admin, created_at').eq('id', user.id).maybeSingle(),
      db.from('projects').select('*').eq('owner_id', user.id),
      db.from('businesses').select('*').eq('owner_id', user.id),
      db.from('god_mode_goals').select('*').eq('owner_id', user.id),
      db.from('marketing_campaigns').select('*').eq('owner_id', user.id),
      db.from('support_tickets').select('*').eq('owner_id', user.id),
      db.from('cron_jobs').select('*').eq('owner_id', user.id),
      db.from('heal_actions').select('*').eq('owner_id', user.id),
      db.from('notifications').select('*').eq('owner_id', user.id).limit(1000),
      db.from('api_keys').select('id, name, token_prefix, scopes, last_used_at, request_count, created_at, revoked_at').eq('owner_id', user.id),
      db.from('subscriptions').select('*').eq('owner_id', user.id).maybeSingle(),
      db.from('webhooks').select('id, url, events, description, enabled, delivery_count, fail_count, created_at').eq('owner_id', user.id),
      db.from('audit_log').select('*').eq('user_id', user.id).limit(5000),
    ])

    // Replicate Prisma's `include: { _count: { select: { files: true } } }` for projects.
    const projectIds = (projectsRaw ?? []).map((p: { id: string }) => p.id)
    let fileCounts: Record<string, number> = {}
    if (projectIds.length > 0) {
      const { data: fileRows } = await db.from('project_files').select('project_id').in('project_id', projectIds)
      for (const f of fileRows ?? []) {
        fileCounts[f.project_id] = (fileCounts[f.project_id] || 0) + 1
      }
    }
    const projects = (projectsRaw ?? []).map((p) => ({ ...p, _count: { files: fileCounts[p.id] || 0 } }))

    // Replicate Prisma's `include: { messages: true }` for support tickets.
    const ticketIds = (ticketsRaw ?? []).map((t: { id: string }) => t.id)
    const messagesByTicket: Record<string, unknown[]> = {}
    if (ticketIds.length > 0) {
      const { data: allMessages } = await db.from('support_messages').select('*').in('ticket_id', ticketIds)
      for (const m of allMessages ?? []) {
        if (!messagesByTicket[m.ticket_id]) messagesByTicket[m.ticket_id] = []
        messagesByTicket[m.ticket_id].push(m)
      }
    }
    const tickets = (ticketsRaw ?? []).map((t) => ({ ...t, messages: messagesByTicket[t.id] || [] }))

    await db.from('audit_log').insert({ user_id: user.id, action: 'account.export' })
    const filename = `buildr-export-${user.email.replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), platform: 'Buildr', profile, projects, businesses: businesses || [], godModeGoals: goals || [], marketingCampaigns: campaigns || [], supportTickets: tickets, cronJobs: cronJobs || [], healActions: healActions || [], notifications: notifications || [], apiKeys: apiKeys || [], subscription, webhooks: webhooks || [], auditLogs: auditLogs || [] }, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${filename}"` } })
  } catch (err) {
    if ((err as { status?: number }).status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    throw err
  }
}
