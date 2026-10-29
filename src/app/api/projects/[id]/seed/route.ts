// POST /api/projects/[id]/seed — generates a database seed script using the
// LLM. Analyzes the project's Prisma schema (or SQL files) to understand the
// data models, then generates realistic seed data (10-50 rows per table).
//
// Creates: prisma/seed.ts (or supabase/migrations/0003_seed_data.sql).
// The seed script uses Prisma's createMany or raw SQL inserts with
// realistic mock data (names, emails, dates, etc.).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface SeedBody {
  format?: 'prisma' | 'sql' // default: 'prisma'
  rowCount?: number // default: 25 per model
  providerKey?: string | null
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
  const rl = rateLimit(`seed:${user.id}`, { limit: 5, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, name, stack, db_config')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as SeedBody
  const format = body.format || 'prisma'
  const rowCount = body.rowCount || 25

  // Fetch the Prisma schema (or SQL files) to understand data models.
  const { data: files } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  const schemaFile = (files ?? []).find(
    (f: { path: string }) => f.path === 'prisma/schema.prisma' || f.path.endsWith('.prisma'),
  )
  const sqlFiles = (files ?? []).filter(
    (f: { path: string }) => f.path.startsWith('supabase/migrations/') && f.path.endsWith('.sql'),
  )

  if (!schemaFile && sqlFiles.length === 0) {
    return NextResponse.json(
      { error: 'No Prisma schema or SQL migration files found. Use the Schema Designer first.' },
      { status: 400 },
    )
  }

  const schemaContent = schemaFile?.content || sqlFiles.map((f: { path: string; content: string }) => `-- ${f.path}\n${f.content}`).join('\n\n')

  // Parse db_config for ORM choice.
  let dbConfig: Record<string, unknown> = {}
  try {
    dbConfig = typeof project.db_config === 'string'
      ? JSON.parse(project.db_config)
      : (project.db_config as Record<string, unknown>) || {}
  } catch {}

  const orm = (dbConfig.orm as string) || 'prisma'

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a database seeding expert. You receive a database schema and generate',
        'realistic seed data for development and testing.',
        '',
        'Rules:',
        '- Generate realistic data (real names, emails, addresses, dates — not "test1", "test2")',
        `- Generate ${rowCount} rows per model/table`,
        '- Respect relationships (foreign keys must reference existing records)',
        '- Use unique values for @unique fields',
        '- Use appropriate data types (dates in ISO format, numbers as numbers, etc.)',
        `- Return the seed as a ${format === 'sql' ? 'SQL file with INSERT statements' : 'TypeScript file using Prisma client'}`,
        '- No placeholders. All data must be real and varied.',
        '',
        'Return ONLY the file content. No markdown fences.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `ORM: ${orm}`,
        `Format: ${format}`,
        '',
        'DATABASE SCHEMA:',
        schemaContent,
        '',
        `Generate a seed script with ${rowCount} rows per model.`,
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.3,
      maxTokens: 6000,
    }, (body.providerKey as never) ?? null)

    let seedCode = result.content
    const fence = seedCode.match(/```(?:typescript|ts|sql)?\s*([\s\S]*?)```/i)
    if (fence) seedCode = fence[1].trim()

    // Determine the file path.
    const seedPath = format === 'sql'
      ? `supabase/migrations/${Date.now()}_seed_data.sql`
      : 'prisma/seed.ts'

    // Save the seed file.
    const { data: existing } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', id)
      .eq('path', seedPath)
      .maybeSingle()

    if (existing) {
      await db
        .from('project_files')
        .update({ content: seedCode, updated_at: new Date().toISOString() })
        .eq('project_id', id)
        .eq('path', seedPath)
    } else {
      await db.from('project_files').insert({
        project_id: id,
        path: seedPath,
        content: seedCode,
        language: format === 'sql' ? 'sql' : 'ts',
        generated: true,
      })
    }

    // If Prisma, also update package.json to add the seed script.
    if (format === 'prisma') {
      const { data: pkgFile } = await db
        .from('project_files')
        .select('content')
        .eq('project_id', id)
        .eq('path', 'package.json')
        .maybeSingle()

      if (pkgFile?.content) {
        try {
          const pkg = JSON.parse(pkgFile.content)
          if (!pkg.scripts) pkg.scripts = {}
          pkg.scripts['db:seed'] = 'tsx prisma/seed.ts'
          if (!pkg.prisma) pkg.prisma = {}
          pkg.prisma.seed = 'tsx prisma/seed.ts'

          await db
            .from('project_files')
            .update({ content: JSON.stringify(pkg, null, 2) + '\n', updated_at: new Date().toISOString() })
            .eq('project_id', id)
            .eq('path', 'package.json')
        } catch { /* ignore JSON parse errors */ }
      }
    }

    await audit('seed.generate', { format, rowCount, path: seedPath }, user.id, id)

    return NextResponse.json({
      ok: true,
      seedPath,
      format,
      rowCount,
      runCommand: format === 'sql'
        ? 'Run the SQL in the Supabase SQL Editor'
        : 'npm run db:seed',
      provider: { name: result.provider.name, model: result.provider.model },
      tokens: result.tokens,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'seed_generation_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
