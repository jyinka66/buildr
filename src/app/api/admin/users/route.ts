// /api/admin/users — platform user management.
// ------------------------------------------------------------------
//   GET   — list all users (with optional search, pagination, filters).
//   PATCH  — update a user: promote/demote admin, enable/disable.
//
// Admin-only via requireAdmin(). Every mutation is recorded in the audit
// log with the acting admin's id + before/after snapshot.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin'

interface UserRow {
  id: string
  email: string
  name: string | null
  is_admin: boolean
  is_disabled: boolean
  email_verified: boolean
  totp_enabled: boolean
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

function serialize(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.is_admin,
    isDisabled: row.is_disabled,
    emailVerified: row.email_verified,
    totpEnabled: row.totp_enabled,
    onboardingCompleted: row.onboarding_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list users with search + pagination.
// ---------------------------------------------------------------------------

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
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  const role = searchParams.get('role') // 'admin' | 'user' | 'disabled' | 'active'
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50
  const offsetRaw = Number(searchParams.get('offset') || '0')
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0

  const selectCols =
    'id, email, name, is_admin, is_disabled, email_verified, totp_enabled, onboarding_completed, created_at, updated_at'

  // Use `any` for the query builder so we can conditionally chain filters
  // without fighting Supabase's deeply-narrowed generic types.
  let listQuery: any = db.from('users').select(selectCols, { count: 'exact' })
  let countQuery: any = db.from('users').select('id', { count: 'exact', head: true })

  if (q) {
    const orFilter = `email.ilike.%${q}%,name.ilike.%${q}%`
    listQuery = listQuery.or(orFilter)
    countQuery = countQuery.or(orFilter)
  }
  if (role === 'admin') {
    listQuery = listQuery.eq('is_admin', true)
    countQuery = countQuery.eq('is_admin', true)
  }
  if (role === 'user') {
    listQuery = listQuery.eq('is_admin', false)
    countQuery = countQuery.eq('is_admin', false)
  }
  if (role === 'disabled') {
    listQuery = listQuery.eq('is_disabled', true)
    countQuery = countQuery.eq('is_disabled', true)
  }
  if (role === 'active') {
    listQuery = listQuery.eq('is_disabled', false)
    countQuery = countQuery.eq('is_disabled', false)
  }

  listQuery = listQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const [rowsRes, countRes] = await Promise.all([listQuery, countQuery])

  const rows = (rowsRes.data as UserRow[] | null) ?? []
  const total = countRes.count ?? 0

  return NextResponse.json({
    users: rows.map(serialize),
    total,
    limit,
    offset,
  })
}

// ---------------------------------------------------------------------------
// PATCH — promote/demote admin or enable/disable user.
// ---------------------------------------------------------------------------

interface PatchBody {
  id?: string
  isAdmin?: boolean
  isDisabled?: boolean
}

export async function PATCH(req: NextRequest) {
  let admin
  try {
    admin = await requireAdmin()
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const id = body.id?.trim() || ''
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }
  if (body.isAdmin === undefined && body.isDisabled === undefined) {
    return NextResponse.json(
      { error: 'Provide isAdmin or isDisabled to update.' },
      { status: 400 },
    )
  }

  const { data: target, error: targetError } = await db
    .from('users')
    .select('id, email, is_admin, is_disabled')
    .eq('id', id)
    .maybeSingle()
  if (targetError || !target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Guard: admins cannot demote or disable themselves (lockout protection).
  if (target.id === admin.id) {
    if (body.isAdmin === false || body.isDisabled === true) {
      return NextResponse.json(
        { error: 'You cannot demote or disable your own account.' },
        { status: 400 },
      )
    }
  }

  // Guard: don't disable the last admin.
  if (body.isDisabled === true && target.is_admin && !target.is_disabled) {
    const { count: adminCount } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)
      .eq('is_disabled', false)
    if ((adminCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot disable the last active admin.' },
        { status: 400 },
      )
    }
  }

  // Guard: don't demote the last admin.
  if (body.isAdmin === false && target.is_admin) {
    const { count: adminCount } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)
      .eq('is_disabled', false)
    if ((adminCount ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last admin.' },
        { status: 400 },
      )
    }
  }

  const data: { is_admin?: boolean; is_disabled?: boolean } = {}
  if (typeof body.isAdmin === 'boolean') data.is_admin = body.isAdmin
  if (typeof body.isDisabled === 'boolean') data.is_disabled = body.isDisabled

  const { data: updated, error: updateError } = await db
    .from('users')
    .update(data)
    .eq('id', id)
    .select('id, email, name, is_admin, is_disabled, email_verified, totp_enabled, onboarding_completed, created_at, updated_at')
    .single()
  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'update_failed' }, { status: 500 })
  }

  // Record an audit entry with before/after snapshot.
  try {
    await db.from('audit_log').insert({
      user_id: admin.id,
      action: 'admin.user.update',
      details: JSON.stringify({
        targetId: target.id,
        targetEmail: target.email,
        before: { isAdmin: target.is_admin, isDisabled: target.is_disabled },
        after: { isAdmin: updated.is_admin, isDisabled: updated.is_disabled },
      }),
    })
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ user: serialize(updated as UserRow) })
}
