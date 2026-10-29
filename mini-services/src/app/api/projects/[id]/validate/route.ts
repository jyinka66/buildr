// POST /api/projects/[id]/validate — runs tsc --noEmit on the generated
// files and returns type errors. Optionally triggers a self-heal pass
// (feeds errors back to the LLM for one retry).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { validateProjectFiles } from '@/lib/validator'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { extractFilesFromText } from '@/lib/llm/code-generator'

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
    .select('owner_id, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: files } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  const result = await validateProjectFiles(files ?? [])

  // If asked to self-heal and there are errors, feed them to the LLM.
  const body = await req.json().catch(() => ({}))
  if (result.errors.length > 0 && body.selfHeal) {
    const errorSummary = result.errors
      .map((e) => `${e.file}:${e.line}:${e.col} — ${e.code}: ${e.message}`)
      .join('\n')

    const fileContents = (files ?? [])
      .filter((f: { path: string }) => /\.(tsx?|jsx?)$/.test(f.path))
      .map((f: { path: string; content: string }) => `// FILE: ${f.path}\n${f.content}`)
      .join('\n\n---\n\n')

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a code repair agent. The user generated TypeScript/React code with type errors. ' +
          'Return ONLY a JSON array of corrected files (same format as the generator): ' +
          '[{"path":"src/app/page.tsx","language":"tsx","content":"..."}]. ' +
          'Fix the type errors. Do not change working code. Return only the fixed files.',
      },
      {
        role: 'user',
        content: `Type errors found by tsc:\n${errorSummary}\n\nCurrent file contents:\n${fileContents}`,
      },
    ]

    try {
      const llmResult = await complete(messages, 'code', {
        temperature: 0.2,
        maxTokens: 8000,
      })
      const healedFiles = extractFilesFromText(llmResult.content)

      // Apply healed files.
      for (const f of healedFiles) {
        const { data: existing } = await db
          .from('project_files')
          .select('id')
          .eq('project_id', id)
          .eq('path', f.path)
          .maybeSingle()
        if (existing) {
          await db
            .from('project_files')
            .update({ content: f.content, language: f.language, updated_at: new Date().toISOString() })
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

      // Re-validate after healing.
      const { data: updatedFiles } = await db
        .from('project_files')
        .select('path, content')
        .eq('project_id', id)
      const recheck = await validateProjectFiles(updatedFiles ?? [])

      await db.from('generations').insert({
        project_id: id,
        role: 'assistant',
        content: `🔧 Self-heal pass: found ${result.errors.length} type error(s), applied ${healedFiles.length} fix(es). ${recheck.errors.length} error(s) remaining.`,
        file_ops: JSON.stringify(healedFiles.map((f) => ({ path: f.path, action: 'update' as const }))),
        provider_id: llmResult.provider.id,
        tokens: llmResult.tokens,
        duration_ms: llmResult.durationMs,
      })

      return NextResponse.json({
        ...result,
        healed: true,
        healedFiles: healedFiles.length,
        remainingErrors: recheck.errors,
        recheckOk: recheck.ok,
      })
    } catch (err) {
      return NextResponse.json({
        ...result,
        healed: false,
        healError: err instanceof Error ? err.message : 'heal_failed',
      })
    }
  }

  return NextResponse.json(result)
}
