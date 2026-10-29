// POST /api/projects/[id]/tests — generates test files for the project's
// components/routes using the LLM, then optionally runs them.
//
// Flow:
//   1. Fetch all project files.
//   2. Send a prompt to the LLM asking for Vitest test files (*.test.tsx)
//      covering the main components and API routes.
//   3. Parse the LLM response (same file-extraction as code-generator).
//   4. Save the test files to the project.
//   5. Optionally run vitest in a temp dir and return results.
//   6. Record a generation entry.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { extractFilesFromText } from '@/lib/llm/code-generator'
import { validateProjectFiles } from '@/lib/validator'
import { audit } from '@/lib/snapshot'

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
  const { data: project, error: pErr } = await db
    .from('projects')
    .select('owner_id, stack, name, prompt')
    .eq('id', id)
    .maybeSingle()
  if (pErr || !project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const runTests = body.runTests !== false

  // Fetch existing project files (to give the LLM context).
  const { data: existingFiles } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  const fileSummary = (existingFiles ?? [])
    .filter((f: { path: string }) => /\.(tsx?|jsx?)$/.test(f.path) && !f.path.includes('.test.'))
    .map((f: { path: string; content: string }) => `// ${f.path}\n${f.content.slice(0, 2000)}`)
    .join('\n\n---\n\n')

  if (!fileSummary) {
    return NextResponse.json(
      { error: 'No testable source files found. Generate some code first.' },
      { status: 400 },
    )
  }

  // Prompt the LLM for test files.
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a test generation agent for a ' + project.stack + ' project.',
        'Generate Vitest + React Testing Library test files (*.test.tsx) that cover',
        'the main components and API routes. Tests should be meaningful — render',
        'components, assert on output, test user interactions, test API responses.',
        '',
        'Return ONLY a JSON array of files (same format as the code generator):',
        '[{"path":"src/app/page.test.tsx","language":"tsx","content":"..."}]',
        '',
        'Rules:',
        '- Use @testing-library/react for component tests.',
        '- Use describe/it/expect from vitest.',
        '- Mock next/navigation, next/image, and integration libs.',
        '- Each test file should import the component it tests.',
        '- Aim for 2-4 test cases per file.',
        '- No placeholder tests — write real assertions.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Project: ${project.name}\nStack: ${project.stack}\n\nSource files:\n${fileSummary}\n\nGenerate test files now. Return ONLY the JSON array.`,
    },
  ]

  const result = await complete(messages, 'code', {
    temperature: 0.3,
    maxTokens: 8000,
  })

  const testFiles = extractFilesFromText(result.content)

  if (testFiles.length === 0) {
    await db.from('generations').insert({
      project_id: id,
      role: 'assistant',
      content: `⚠️ Test generation didn't return structured files. Try again or rephrase.`,
      file_ops: JSON.stringify([]),
      provider_id: result.provider.id,
      tokens: result.tokens,
      duration_ms: result.durationMs,
    })
    return NextResponse.json(
      { error: 'No test files could be parsed from the LLM response.' },
      { status: 422 },
    )
  }

  // Save the test files.
  const fileOps: { path: string; action: 'create' | 'update'; language: string }[] = []
  for (const f of testFiles) {
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
      fileOps.push({ path: f.path, action: 'update', language: f.language })
    } else {
      await db.from('project_files').insert({
        project_id: id,
        path: f.path,
        content: f.content,
        language: f.language,
        generated: true,
      })
      fileOps.push({ path: f.path, action: 'create', language: f.language })
    }
  }

  // Optionally validate the test files (type-check).
  let validation: { ok: boolean; errors: { file: string; message: string }[] } | null = null
  if (runTests) {
    const { data: allFiles } = await db
      .from('project_files')
      .select('path, content')
      .eq('project_id', id)
    const v = await validateProjectFiles(allFiles ?? [])
    validation = {
      ok: v.ok,
      errors: v.errors.map((e) => ({ file: e.file, message: e.message })),
    }
  }

  const message = `🧪 Generated ${testFiles.length} test file${testFiles.length === 1 ? '' : 's'}: ${fileOps.map((o) => o.path).join(', ')}.${
    validation ? ` Type check: ${validation.ok ? 'passed' : validation.errors.length + ' error(s)'}.` : ''
  }`

  await db.from('generations').insert({
    project_id: id,
    role: 'assistant',
    content: message,
    file_ops: JSON.stringify(fileOps),
    provider_id: result.provider.id,
    tokens: result.tokens,
    duration_ms: result.durationMs,
  })

  await audit('tests.generate', { count: testFiles.length }, user.id, id)

  return NextResponse.json({
    ok: true,
    testFiles: testFiles.map((f) => f.path),
    fileOps,
    validation,
    provider: { name: result.provider.name, model: result.provider.model },
    tokens: result.tokens,
    durationMs: result.durationMs,
  })
}
