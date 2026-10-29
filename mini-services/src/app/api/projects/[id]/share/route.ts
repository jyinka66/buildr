// POST /api/projects/[id]/share — toggles public sharing for a project.
// When enabled, generates a random share_slug that allows unauthenticated
// read-only access to the project's preview + file tree via /api/shared/{slug}.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'
import { randomBytes } from 'crypto'

export async function POST(
  req: NextRequest,
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
    .select('id, owner_id, is_public, share_slug')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const enable = body.enable !== false

  let shareSlug = project.share_slug
  if (enable && !shareSlug) {
    shareSlug = randomBytes(8).toString('hex')
  }
  if (!enable) {
    shareSlug = null
  }

  await db
    .from('projects')
    .update({ is_public: enable, share_slug: shareSlug })
    .eq('id', id)

  await audit(
    enable ? 'project.share_enabled' : 'project.share_disabled',
    { shareSlug },
    user.id,
    id,
  )

  const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  return NextResponse.json({
    isPublic: enable,
    shareSlug,
    shareUrl: enable && shareSlug ? `${appUrl}/?shared=${shareSlug}` : null,
  })
}
