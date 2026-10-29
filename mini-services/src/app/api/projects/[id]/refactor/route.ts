// POST /api/projects/[id]/refactor — multi-file AI refactoring.
// ------------------------------------------------------------------
// Unlike the regular chat generator (which regenerates individual files),
// the refactor mode understands the project as a file GRAPH:
//   1. Sends ALL project files to the LLM with the refactor instruction
//      (e.g. "Rename TaskList to TodoList" or "Extract a Header component
//      from page.tsx").
//   2. The LLM returns ALL files that need updating (not just the one being
//      renamed — it understands import chains and updates every file that
//      references the renamed symbol).
//   3. We return diffs for each affected file so the user can preview.
//   4. If `apply` is true, we persist the changes.
//
// This is the feature that separates a code generator from a real IDE.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { extractFilesFromText } from '@/lib/llm/code-generator'
import { invalidateRuntimeCache } from '@/lib/runtime-notify'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface RefactorBody {
  instruction: string
  apply?: boolean // if true, persist changes; if false, return diffs only
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
  const rl = rateLimit(`refactor:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, stack, styling, name')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as RefactorBody
  const instruction = body.instruction?.trim()
  if (!instruction) {
    return NextResponse.json({ error: 'instruction is required.' }, { status: 400 })
  }

  // Fetch ALL source files (not configs, not images).
  const { data: allFiles, error: fErr } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  if (fErr || !allFiles || allFiles.length === 0) {
    return NextResponse.json({ error: 'No files to refactor.' }, { status: 400 })
  }

  // Filter to code files only (ts/tsx/js/jsx/svelte/astro/css/prisma/sql).
  const codeFiles = allFiles.filter(
    (f: { path: string; content: string }) =>
      /\.(tsx?|jsx?|svelte|astro|css|prisma|sql)$/i.test(f.path) &&
      !f.path.startsWith('public/') &&
      !f.path.startsWith('node_modules/'),
  )

  // Build the file graph — send all code files with their paths so the LLM
  // understands the import structure.
  const fileGraph = codeFiles
    .map((f: { path: string; content: string }) => {
      // Truncate very large files to keep the prompt manageable.
      const maxLen = 4000
      const content = f.content.length > maxLen
        ? f.content.slice(0, maxLen) + '\n// ... truncated ...'
        : f.content
      return `// FILE: ${f.path}\n${content}`
    })
    .join('\n\n---\n\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a multi-file refactoring agent for a ' + project.stack + ' project.',
        'You receive a refactoring instruction and ALL the project files.',
        'Your job is to understand the file graph (imports, exports, references)',
        'and return ONLY the files that need updating — including every file that',
        'imports a renamed symbol, references a moved component, or is affected by',
        'the refactor.',
        '',
        'Return ONLY a JSON array of files (same format as the code generator):',
        '[{"path":"src/components/TodoList.tsx","language":"tsx","content":"..."}]',
        '',
        'Rules:',
        '- Return the FULL content of every affected file (not diffs).',
        '- Include ALL files that reference a renamed/moved/extracted symbol.',
        '- Do NOT return files that are unchanged.',
        '- If renaming a component, update ALL imports across ALL files.',
        '- If extracting a component, create the new file AND update the file it was extracted from.',
        '- Preserve all existing functionality — only apply the requested refactor.',
        '- Keep all code real and runnable. No placeholders.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Stack: ${project.stack}`,
        '',
        'REFACTOR INSTRUCTION:',
        instruction,
        '',
        'CURRENT PROJECT FILES:',
        fileGraph,
        '',
        'Return ONLY the JSON array of affected files. Include every file that needs updating.',
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.2,
      maxTokens: 8000,
    }, (body.providerKey as never) ?? null)

    const affectedFiles = extractFilesFromText(result.content)

    if (affectedFiles.length === 0) {
      return NextResponse.json({
        ok: true,
        affectedFiles: [],
        message: 'No files need updating for this refactor. The instruction may not require changes, or the affected files could not be parsed.',
      })
    }

    // Build diffs (old content → new content) for each affected file.
    const diffs: {
      path: string
      action: 'create' | 'update'
      oldContent: string | null
      newContent: string
      language: string
    }[] = []

    for (const f of affectedFiles) {
      const existing = codeFiles.find((cf: { path: string }) => cf.path === f.path)
      diffs.push({
        path: f.path,
        action: existing ? 'update' : 'create',
        oldContent: existing?.content ?? null,
        newContent: f.content,
        language: f.language,
      })
    }

    // If apply=true, persist the changes.
    if (body.apply) {
      for (const f of affectedFiles) {
        const { data: existing } = await db
          .from('project_files')
          .select('id')
          .eq('project_id', id)
          .eq('path', f.path)
          .maybeSingle()
        if (existing) {
          await db
            .from('project_files')
            .update({
              content: f.content,
              language: f.language,
              updated_at: new Date().toISOString(),
            })
            .eq('project_id', id)
            .eq('path', f.path)
        } else {
          await db.from('project_files').insert({
            project_id: id,
            path: f.path,
            content: f.content,
            language: f.language,
            generated: true,
          })
        }
      }
      invalidateRuntimeCache(id)
      await audit('refactor.apply', { instruction: instruction.slice(0, 200), filesChanged: affectedFiles.length }, user.id, id)
    } else {
      await audit('refactor.preview', { instruction: instruction.slice(0, 200), filesAffected: affectedFiles.length }, user.id, id)
    }

    return NextResponse.json({
      ok: true,
      instruction,
      affectedCount: affectedFiles.length,
      diffs,
      applied: body.apply === true,
      provider: { name: result.provider.name, model: result.provider.model },
      tokens: result.tokens,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'refactor_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
