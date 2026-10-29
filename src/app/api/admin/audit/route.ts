// GET /api/admin/audit — list audit log entries with filters.
// ------------------------------------------------------------------
// Query params:
//   ?userId=  filter by acting user
//   ?action=  filter by exact action (e.g. "admin.user.update")
//   ?q=       full-text search on details JSON
//   ?limit=50 &offset=0
//
// Admin-only via requireAdmin().

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

interface AuditRow {
  id: string
  user_id: string | null
  action: string
  details: string
  project_id: string | null
  created_at: string
}

interface UserMini {
  id: string
  email: string
  name: string | null
}

function serialize(row: AuditRow, user: UserMini | null) {
  let detailsParsed: unknown = {}
  try {
    detailsParsed = JSON.parse(row.details || '{}')
  } catch {
    detailsParsed = row.details
  }
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    details: detailsParsed,
    projectId: row.project_id,
    createdAt: row.created_at,
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
  }
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

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') || undefined
  const action = searchParams.get('action') || undefined
  const q = (searchParams.get('q') || '').trim().toLowerCase() || undefined
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50
  const offsetRaw = Number(searchParams.get('offset') || '0')
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  const selectCols = '*'
  // Use `any` for the query builder so we can conditionally chain filters
  // without fighting Supabase's deeply-narrowed generic types.
  let listQuery: any = db.from('audit_log').select(selectCols, { count: 'exact' })
  let countQuery: any = db.from('audit_log').select('id', { count: 'exact', head: true })

  if (userId) {
    listQuery = listQuery.eq('user_id', userId)
    countQuery = countQuery.eq('user_id', userId)
  }
  if (action) {
    listQuery = listQuery.eq('action', action)
    countQuery = countQuery.eq('action', action)
  }
  if (q) {
    listQuery = listQuery.ilike('details', `%${q}%`)
    countQuery = countQuery.ilike('details', `%${q}%`)
  }

  listQuery = listQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const [rowsRes, countRes] = await Promise.all([listQuery, countQuery])
  if (rowsRes.error) {
    return NextResponse.json({ error: rowsRes.error.message }, { status: 500 })
  }

  const rows = (rowsRes.data as AuditRow[] | null) ?? []
  const total = countRes.count ?? 0

  // Hydrate user info for each entry (audit_log.user_id is not FK-constrained,
  // so we resolve manually after fetching the rows).
  const userIds = Array.from(
    new Set(rows.map((r) => r.user_id).filter((u): u is string => !!u)),
  )
  const usersById = new Map<string, UserMini>()
  if (userIds.length) {
    const { data: users } = await db
      .from('users')
      .select('id, email, name')
      .in('id', userIds)
    for (const u of (users as UserMini[] | null) ?? []) {
      usersById.set(u.id, u)
    }
  }

  const entries = rows.map((r) => serialize(r, r.user_id ? usersById.get(r.user_id) ?? null : null))

  return NextResponse.json({
    entries,
    total,
    limit,
    offset,
  })
}
