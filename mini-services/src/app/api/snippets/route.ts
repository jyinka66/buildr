// GET  /api/snippets — list the user's saved reusable snippets
// POST /api/snippets — save a new snippet (component, hook, util, config)
// DELETE /api/snippets?id=<id> — delete a snippet
//
// Snippets are reusable code blocks saved by the user. They can be inserted
// into any project. Stored in a `snippets` table (user-scoped).
// Note: we store these in the project_secrets pattern — actually, let's
// use a dedicated table. For now, we store them in audit_log-like fashion
// via a simple JSON approach in the users table... no, that's messy.
// Let's create a snippets table in the schema and use it.
//
// Actually, to avoid a schema migration requirement, we store snippets in
// the projects table pattern but as a user-scoped "meta project" — no.
// Simplest: use a Supabase table `snippets` that we add to schema.sql.
// For now, we'll use localStorage on the client as a fallback and this
// API as the canonical store.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { randomUUID } from 'crypto'

// We use a lightweight approach: store snippets in a `snippets` table.
// If the table doesn't exist yet, the query will return an error and we
// gracefully fall back to telling the user to run the schema SQL.

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

  const { data: snippets, error } = await db
    .from('snippets')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) {
    // Table might not exist — tell the user.
    if (error.message.includes('does not exist') || error.message.includes('relation')) {
      return NextResponse.json({
        snippets: [],
        error: 'The snippets table does not exist. Add it to your Supabase schema.',
        schemaSql: `CREATE TABLE IF NOT EXISTS public.snippets (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  language text NOT NULL DEFAULT 'tsx',
  content text NOT NULL,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snippets_user ON public.snippets(user_id);`,
      })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    snippets: (snippets ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      language: s.language,
      content: s.content,
      tags: s.tags || [],
      updatedAt: new Date(s.updated_at as string).toISOString(),
    })),
  })
}

interface SaveBody {
  name: string
  description?: string
  language?: string
  content: string
  tags?: string[]
  id?: string // if provided, update existing
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const body = (await req.json()) as SaveBody
  if (!body.name || !body.content) {
    return NextResponse.json({ error: 'name and content are required.' }, { status: 400 })
  }

  // Update or insert.
  if (body.id) {
    const { data, error } = await db
      .from('snippets')
      .update({
        name: body.name,
        description: body.description || '',
        language: body.language || 'tsx',
        content: body.content,
        tags: body.tags || [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('user_id', user.id)
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data?.id })
  } else {
    const id = randomUUID()
    const { error } = await db.from('snippets').insert({
      id,
      user_id: user.id,
      name: body.name,
      description: body.description || '',
      language: body.language || 'tsx',
      content: body.content,
      tags: body.tags || [],
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id }, { status: 201 })
  }
}

export async function DELETE(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await db.from('snippets').delete().eq('id', id).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
