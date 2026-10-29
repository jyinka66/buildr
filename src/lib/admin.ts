// Admin helper — determines which emails have platform-admin privileges.
import { db } from '@/lib/db'

export function isAdminEmail(email: string): boolean {
  const list = process.env.ADMIN_EMAILS
  if (!list) return false
  return list.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase())
}

export async function syncAdminFlag(userId: string, email: string): Promise<boolean> {
  const shouldBeAdmin = isAdminEmail(email)
  try {
    const { data: user } = await db.from('users').select('is_admin').eq('id', userId).maybeSingle()
    if (user && Boolean(user.is_admin) !== shouldBeAdmin) {
      await db.from('users').update({ is_admin: shouldBeAdmin }).eq('id', userId)
    }
    return shouldBeAdmin
  } catch { return shouldBeAdmin }
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  try {
    const { data: user } = await db.from('users').select('is_admin, is_disabled').eq('id', userId).maybeSingle()
    if (!user || user.is_disabled) return false
    return Boolean(user.is_admin)
  } catch { return false }
}

export async function requireAdmin(): Promise<{ id: string; email: string; name?: string | null }> {
  const { requireSessionUser } = await import('@/lib/session')
  const user = await requireSessionUser()
  const admin = await isUserAdmin(user.id)
  if (!admin) {
    const err = new Error('forbidden') as Error & { status?: number }
    err.status = 403
    throw err
  }
  return user
}
