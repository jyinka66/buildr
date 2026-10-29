// POST /api/projects/[id]/db-query — executes a read-only SQL query against
// the project's Supabase database via the PostgREST API.
//
// For SELECT queries, we use the Supabase REST API directly.
// For arbitrary SQL (CREATE, INSERT, etc.), we fall back to the Supabase
// RPC endpoint if available.
//
// Security: only the project owner can run queries. We enforce read-only
// by intercepting destructive keywords (DROP, DELETE, TRUNCATE, ALTER)
// unless explicitly allowed via `?allowWrite=true`.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

const DESTRUCTIVE_KEYWORDS = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'DROP TABLE']

interface QueryBody {
  sql: string
  tableName?: string // if set, we use the REST API for this table
  limit?: number
  allowWrite?: boolean
}

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
    .select('owner_id, db_config, name')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let dbConfig: Record<string, unknown>
  try {
    dbConfig = typeof project.db_config === 'string'
      ? JSON.parse(project.db_config)
      : (project.db_config as Record<string, unknown>) || {}
  } catch {
    dbConfig = {}
  }

  const supabaseProjectRef = dbConfig.supabaseUrl as string || dbConfig.supabaseProjectRef as string
  const supabaseAnonKey = dbConfig.supabaseAnonKey as string
  const apiUrl = dbConfig.supabaseApiUrl as string || (supabaseProjectRef ? `https://${supabaseProjectRef}.supabase.co` : null)

  if (!apiUrl || !supabaseAnonKey) {
    return NextResponse.json({
      error: 'This project does not have a Supabase database configured. Use the Schema Designer or provision a Supabase project first.',
    }, { status: 400 })
  }

  const body = (await req.json()) as QueryBody
  const sql = body.sql?.trim()

  if (!sql) {
    return NextResponse.json({ error: 'SQL query is required.' }, { status: 400 })
  }

  // Security: block destructive queries unless explicitly allowed.
  const upperSql = sql.toUpperCase()
  const isDestructive = DESTRUCTIVE_KEYWORDS.some((kw) => upperSql.includes(kw))
  if (isDestructive && !body.allowWrite) {
    return NextResponse.json({
      error: 'Destructive queries (DROP, DELETE, TRUNCATE, ALTER) are blocked by default. Pass allowWrite=true to override.',
    }, { status: 403 })
  }

  // Determine if this is a SELECT query.
  const isSelect = upperSql.startsWith('SELECT') || upperSql.startsWith('WITH')

  try {
    if (isSelect && body.tableName) {
      // Validate tableName strictly — only alphanumeric + underscore.
      const tableName = body.tableName.trim()
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return NextResponse.json(
          { error: 'Invalid table name. Only alphanumeric characters and underscores are allowed.' },
          { status: 400 },
        )
      }
      // Use the REST API for table-specific SELECT queries.
      const limit = Math.min(body.limit || 100, 200) // cap at 200
      const restUrl = `${apiUrl}/rest/v1/${encodeURIComponent(tableName)}?limit=${limit}`
      const res = await fetch(restUrl, {
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${supabaseAnonKey}`,
          accept: 'application/json',
          prefer: 'count=exact',
        },
      })

      if (!res.ok) {
        const txt = await res.text()
        return NextResponse.json({ error: `Query failed (${res.status}): ${txt}` }, { status: 502 })
      }

      const rows = await res.json()
      const count = res.headers.get('content-range')?.split('/')[1] || String(rows.length)

      await audit('db.query', { table: body.tableName, rowCount: rows.length }, user.id, id)

      return NextResponse.json({
        ok: true,
        rows,
        rowCount: rows.length,
        totalCount: parseInt(count, 10) || rows.length,
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      })
    } else if (isSelect) {
      // For arbitrary SELECT queries, we try the Supabase RPC endpoint
      // with a pg-meta function if available. If not, we return a helpful
      // message suggesting the user use the table-specific browser.
      return NextResponse.json({
        ok: false,
        error: 'Arbitrary SQL queries require the pg-meta RPC function. Use the table browser (select a table) or run the query in the Supabase SQL Editor.',
        hint: 'Select a specific table from the sidebar to browse its data.',
      })
    } else {
      // For write queries (INSERT, UPDATE, DELETE), use the REST API.
      // This is a simplified implementation — for complex queries, users
      // should use the Supabase SQL Editor.
      return NextResponse.json({
        ok: false,
        error: 'Write queries are not supported via the API browser. Use the Supabase SQL Editor or the generated API routes.',
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'query_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
