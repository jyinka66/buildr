// GET /api/business — list the user's launched businesses.
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { data: businesses } = await db
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    businesses: (businesses ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      status: b.status,
      projectId: b.project_id,
      createdAt: new Date(b.created_at).toISOString(),
    })),
  })
}
