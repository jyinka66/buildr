// Session helper used by server code (API routes) to gate project access.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export interface SessionUser {
  id: string
  email: string
  name?: string | null
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as { id?: string } | undefined)?.id
  if (!session?.user?.email || !id) return null
  return {
    id,
    email: session.user.email,
    name: session.user.name ?? null,
  }
}

// Require a session or throw a 401-shaped error the API can translate.
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    const err = new Error('unauthorized') as Error & { status?: number }
    err.status = 401
    throw err
  }
  return user
}
