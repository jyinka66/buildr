// GET /api/projects/[id]/db-tables — lists all tables in the project's
// Supabase database. Uses the project's db_config to connect.
// Returns table names + column definitions (name, type, nullable, default).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

export async function GET(
  _req: NextRequest,
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
    .select('owner_id, db_config')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Parse db_config to get the Supabase URL.
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
      tables: [],
      error: 'This project does not have a Supabase database configured. Use the Schema Designer or provision a Supabase project first.',
    })
  }

  // Query the Postgres information_schema via the Supabase REST API.
  // We use the PostgREST endpoint to query the `information_schema.columns` view.
  try {
    // First, list all tables in the `public` schema.
    const tablesRes = await fetch(
      `${apiUrl}/rest/v1/information_schema.tables?select=table_name&schema=eq.public&order=table_name.asc`,
      {
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${supabaseAnonKey}`,
          accept: 'application/json',
        },
      },
    )

    if (!tablesRes.ok) {
      return NextResponse.json({
        tables: [],
        error: `Could not connect to the Supabase database (${tablesRes.status}). Verify the project's database configuration.`,
      })
    }

    const tablesData = (await tablesRes.json()) as { table_name: string }[]
    const tableNames = tablesData.map((t) => t.table_name)

    if (tableNames.length === 0) {
      return NextResponse.json({ tables: [], message: 'No tables found in the public schema. Run a migration first.' })
    }

    // Fetch columns for each table.
    const columnsRes = await fetch(
      `${apiUrl}/rest/v1/information_schema.columns?select=table_name,column_name,data_type,is_nullable,column_default&table_schema=eq.public&order=table_name.asc,ordinal_position.asc`,
      {
        headers: {
          apikey: supabaseAnonKey,
          authorization: `Bearer ${supabaseAnonKey}`,
          accept: 'application/json',
        },
      },
    )

    let columnsByTable: Record<string, { name: string; type: string; nullable: boolean; default: string | null }[]> = {}
    if (columnsRes.ok) {
      const columnsData = (await columnsRes.json()) as {
        table_name: string
        column_name: string
        data_type: string
        is_nullable: 'YES' | 'NO'
        column_default: string | null
      }[]
      for (const col of columnsData) {
        if (!columnsByTable[col.table_name]) columnsByTable[col.table_name] = []
        columnsByTable[col.table_name].push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          default: col.column_default,
        })
      }
    }

    const tables = tableNames.map((name) => ({
      name,
      columns: columnsByTable[name] || [],
      rowCount: null, // we don't count rows by default (expensive)
    }))

    return NextResponse.json({ tables, apiUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'db_connection_failed'
    return NextResponse.json({ tables: [], error: msg }, { status: 500 })
  }
}
