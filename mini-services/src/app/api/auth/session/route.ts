// GET /api/auth/session — returns the current session (or null) for the client.
// Wraps getServerSession so the browser can determine auth state on boot.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ session: null })
  }
  const id = (session.user as { id?: string }).id
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin ?? false
  return NextResponse.json({
    session: {
      user: {
        id,
        email: session.user.email ?? null,
        name: session.user.name ?? null,
        isAdmin,
      },
    },
  })
}
