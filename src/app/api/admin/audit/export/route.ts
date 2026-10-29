// GET /api/admin/audit/export — download the audit log as CSV (admin only).
//
// Query: ?action=substring  &userId=...  &limit=1000
//
// Returns a CSV file with columns: id, timestamp, user_id, action, project_id, details.
// The CSV is properly escaped (RFC 4180) for values containing commas/quotes/newlines.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

function csvEscape(value: unknown): string {
  const str = value == null ? '' : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    throw err
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const userId = url.searchParams.get('userId')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 5000)

  let query = db
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit as never)
  if (action) query = query.ilike('action', `%${action}%`) as typeof query
  if (userId) query = query.eq('user_id', userId) as typeof query

  const { data: entries, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build CSV.
  const header = ['id', 'timestamp', 'user_id', 'action', 'project_id', 'details']
  const rows = (entries ?? []).map((e: Record<string, unknown>) => [
    csvEscape(e.id),
    csvEscape(new Date(e.created_at as string).toISOString()),
    csvEscape(e.user_id),
    csvEscape(e.action),
    csvEscape(e.project_id),
    csvEscape(e.details),
  ])

  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n')

  const filename = `buildr-audit-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
