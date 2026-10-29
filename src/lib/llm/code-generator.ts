// Code Generation Engine (Module 2)
// ------------------------------------------------------------------
// Turns a natural-language brief into a structured set of file operations
// using the LLM router. Forces the model to emit strict JSON describing
// files to create/update. The output is parsed, validated, and applied
// to a project's virtual file system in the DB.
//
// For the *initial* project scaffold, deterministic templates in
// `generator/templates.ts` are layered with LLM-generated app code so the
// result is always a runnable, well-formed repository.

import { db } from '@/lib/db'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { buildScaffold, type ScaffoldInput } from '@/lib/generator/templates'
import { applyIntegrations } from '@/lib/generator/integrations'
import type {
  DbConfig,
  FileOp,
  GenerationResult,
  ProviderKey,
  StackKey,
  StylingKey,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// File-extraction helpers. The model is asked to emit a JSON array, but in
// practice it often returns fenced code blocks (one per file) with path
// comments, or wraps JSON in prose. We support three formats, tried in order:
//   1. A JSON array (raw or fenced) — preferred.
//   2. Multiple fenced code blocks where the first line names the path
//      (e.g. ```tsx\n// src/app/page.tsx\n<code>``` or
//      ```tsx title="src/app/page.tsx"```).
//   3. A single fenced block whose first line is a path comment.
// ---------------------------------------------------------------------------

export interface ExtractedFile {
  path: string
  content: string
  language: string
}

function cleanPath(raw: string): string {
  return raw
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/^[./]+/, '')
    .replace(/^src\/src\//, 'src/')
    .trim()
}

function isValidPath(p: string): boolean {
  if (!p) return false
  if (p.length > 256) return false
  // Must look like a file path: no spaces in the middle of segments, has an
  // extension or is a known dotfile.
  if (/\s/.test(p)) return false
  if (p.includes('\n')) return false
  return /\.[a-z0-9]+$/i.test(p) || p.startsWith('.') || p === 'Dockerfile'
}

function detectLanguageFromFence(fence: string, path: string): string {
  if (fence) return fence.toLowerCase()
  return guessLanguage(path)
}

export function extractFilesFromText(text: string): ExtractedFile[] {
  // 1. Try JSON array (raw or fenced).
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fence ? fence[1] : text
    const start = candidate.indexOf('[')
    const end = candidate.lastIndexOf(']')
    if (start !== -1 && end !== -1 && end > start) {
      const slice = candidate.slice(start, end + 1)
      const parsed = JSON.parse(slice)
      if (Array.isArray(parsed)) {
        const files = parsed
          .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
          .map((f) => ({
            path: cleanPath(String(f.path ?? f.file ?? f.name ?? '')),
            content: String(f.content ?? f.code ?? f.body ?? ''),
            language: String(f.language ?? f.lang ?? guessLanguage(String(f.path ?? ''))),
          }))
          .filter((f) => isValidPath(f.path) && f.content.length > 0)
        if (files.length) return files
      }
    }
  } catch {
    /* fall through */
  }

  // 2. Try fenced code blocks with path annotations.
  //    Matches: ```lang title="path"\n or ```lang\n// path: x\n or ```lang\n// x\n
  const blockRe = /```([a-zA-Z0-9+-]*)[^\n]*\n([\s\S]*?)```/g
  const files: ExtractedFile[] = []
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(text)) !== null) {
    const fenceLang = m[1] ?? ''
    const body = m[2] ?? ''
    const lines = body.split('\n')
    let path = ''
    let contentStart = 0

    // title="path" attribute in the fence line (already consumed into m[0] prefix)
    const titleAttr = /title=["']([^"']+)["']/.exec(m[0])
    if (titleAttr) {
      path = cleanPath(titleAttr[1])
      contentStart = 0
    } else {
      // Inspect first 1-2 lines for a path comment.
      for (let i = 0; i < Math.min(lines.length, 2); i++) {
        const line = lines[i]
        const cmt =
          /^\s*(?:\/\/|#|<!--)\s*(?:path|filepath|file|filename|name)?\s*[:=]?\s*(.+?)\s*(?:-->|#)?\s*$/i.exec(
            line,
          )
        if (cmt && isValidPath(cleanPath(cmt[1]))) {
          path = cleanPath(cmt[1])
          contentStart = i + 1
          break
        }
      }
    }

    if (!path) continue
    const content = lines.slice(contentStart).join('\n').replace(/\s+$/, '\n')
    files.push({
      path,
      content,
      language: detectLanguageFromFence(fenceLang, path),
    })
  }
  if (files.length) return files

  // 3. No structured files found.
  return []
}

// ---------------------------------------------------------------------------
// Build the system prompt that constrains the model to file-emit JSON.
// ---------------------------------------------------------------------------

export interface GenContext {
  stack: StackKey
  styling: StylingKey
  integrations: string[]
  dbConfig: DbConfig
  existingFiles: { path: string }[]
}

export function buildSystemPrompt(ctx: GenContext): string {
  return [
    'You are Buildr, an enterprise-grade full-stack code generator.',
    'You receive a user brief and emit a set of complete source files.',
    'You NEVER return prose explanations. You ONLY return files.',
    '',
    'STACK=' + ctx.stack,
    'STYLING=' + ctx.styling,
    'DATABASE=' + ctx.dbConfig.engine + ' ORM=' + ctx.dbConfig.orm,
    'INTEGRATIONS=' + JSON.stringify(ctx.integrations),
    '',
    'OUTPUT FORMAT (choose ONE and use it consistently):',
    '',
    'OPTION A (preferred) — a single JSON array:',
    '  [',
    '    { "path": "src/app/page.tsx", "language": "tsx", "content": "..." }',
    '  ]',
    '',
    'OPTION B — one fenced code block per file, with the path as the FIRST line comment:',
    '  ```tsx',
    '  // src/app/page.tsx',
    '  "use client";',
    '  export default function Page() { ... }',
    '  ```',
    '  ```tsx',
    '  // src/components/Hero.tsx',
    '  ...',
    '  ```',
    '',
    'Each file object has:',
    '  path:    string — repo-relative path (e.g. "src/app/page.tsx")',
    '  content: string — full file content, no placeholders, no ellipsis, no "// ...rest"',
    '  language:string — one of: tsx, ts, js, jsx, json, css, html, md, sql, env, prisma, yml, toml, txt',
    '',
    'RULES:',
    '- Emit COMPLETE file contents only. Never abbreviate with "// ...rest" or "...".',
    '- Use the framework conventions of the stack.',
    '- Every Next.js route file must start with "use client" only when it uses hooks/state.',
    '- For Tailwind v4 use the new @import "tailwindcss" syntax in globals.css.',
    '- Do not include files already provided by the scaffold unless you are updating them.',
    '  Existing scaffold files: ' + JSON.stringify(ctx.existingFiles.map((f) => f.path)),
    '- Keep the response under 12 files. Prefer fewer, complete files.',
    '- If the user asks to "update" or "add a feature", only emit the changed/new files.',
    '- Real, runnable code. No TODOs, no placeholders.',
    '',
    'Return ONLY files. No preamble, no postscript.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Generate the *initial* project: combine deterministic scaffold + LLM app
// code. This guarantees the project is structurally complete even if the
// model omits boilerplate.
// ---------------------------------------------------------------------------

export interface InitialGenerationInput {
  projectId: string
  name: string
  prompt: string
  stack: StackKey
  styling: StylingKey
  integrations: string[]
  dbConfig: DbConfig
  overrideProvider?: ProviderKey | null
}

export async function generateInitialProject(
  input: InitialGenerationInput,
): Promise<GenerationResult> {
  const { projectId, prompt, stack, styling, integrations, dbConfig, overrideProvider } = input

  // 1. Deterministic scaffold (package.json, configs, layout, etc.).
  const scaffold = buildScaffold({
    name: input.name,
    stack,
    styling,
    dbConfig,
    prompt,
    integrations,
  })

  // 2. Integration scaffolding (auth, payments, comms, db drivers).
  const integrationFiles = applyIntegrations({
    stack,
    integrations,
    dbConfig,
  })

  // 3. LLM generates the *application* code (pages/components/API routes).
  const existing = [...scaffold, ...integrationFiles].map((f) => ({ path: f.path }))
  const systemPrompt = buildSystemPrompt({
    stack,
    styling,
    integrations,
    dbConfig,
    existingFiles: existing,
  })

  const userPrompt = [
    `Project name: ${input.name}`,
    `Stack: ${stack} with ${styling}`,
    `Database: ${dbConfig.engine} via ${dbConfig.orm}`,
    `Integrations: ${integrations.join(', ') || 'none'}`,
    '',
    'Brief:',
    prompt,
    '',
    'Generate the application code now. Return ONLY the JSON file array.',
  ].join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const result = await complete(messages, 'code', {
    temperature: 0.4,
    maxTokens: 8000,
  }, overrideProvider ?? null)

  // 4. Parse LLM files (tolerant: JSON array OR fenced code blocks).
  const llmFiles = extractFilesFromText(result.content)

  // 5. Merge: scaffold first, then integrations, then LLM (LLM wins on path conflicts).
  const merged = new Map<string, { path: string; content: string; language: string }>()
  for (const f of scaffold) merged.set(f.path, f)
  for (const f of integrationFiles) merged.set(f.path, f)
  for (const f of llmFiles) merged.set(f.path, f)

  // 6. Persist all files to the DB + record the generation.
  // Replace the previous file tree, then bulk-insert the new one.
  // (Replaces Prisma $transaction with sequential awaits.)
  const files = Array.from(merged.values())
  const fileOps: FileOp[] = files.map((f) => ({
    path: f.path,
    action: 'create',
    language: f.language,
  }))

  await db.from('project_files').delete().eq('project_id', projectId)
  if (files.length) {
    await db.from('project_files').insert(
      files.map((f) => ({
        project_id: projectId,
        path: f.path,
        content: f.content,
        language: f.language,
        generated: !scaffold.some((s) => s.path === f.path),
      })),
    )
  }

  const assistantMessage =
    llmFiles.length > 0
      ? `Generated ${files.length} files for your ${stack} project: ${llmFiles.length} AI-authored files layered onto the ${scaffold.length}-file scaffold and ${integrationFiles.length} integration files. Ready to preview and export.`
      : `Scaffolded ${files.length} files for your ${stack} project. The AI code generation step didn't return structured files, so the base template is in place — describe what to build in chat to add features.`

  await db.from('generations').insert({
    project_id: projectId,
    role: 'assistant',
    content: assistantMessage,
    file_ops: JSON.stringify(fileOps),
    provider_id: result.provider.id,
    tokens: result.tokens,
    duration_ms: result.durationMs,
  })

  await db
    .from('projects')
    .update({ status: 'preview-ready' })
    .eq('id', projectId)

  return {
    message: assistantMessage,
    fileOps,
    files,
    provider: result.provider,
    tokens: result.tokens,
    durationMs: result.durationMs,
  }
}

// ---------------------------------------------------------------------------
// Incremental generation — user asks to add/modify within an existing project.
// ---------------------------------------------------------------------------

export interface IncrementalInput {
  projectId: string
  message: string
  stack: StackKey
  styling: StylingKey
  integrations: string[]
  dbConfig: DbConfig
  history: { role: 'user' | 'assistant'; content: string }[]
  existingFiles: { path: string; content: string }[]
  overrideProvider?: ProviderKey | null
}

export async function generateIncremental(
  input: IncrementalInput,
): Promise<GenerationResult> {
  const { projectId, message, stack, styling, integrations, dbConfig, history, existingFiles, overrideProvider } = input

  const fileSummary = existingFiles
    .slice(0, 40)
    .map((f) => `- ${f.path} (${Math.round(f.content.length / 1024)}KB)`)
    .join('\n')

  const systemPrompt = buildSystemPrompt({
    stack,
    styling,
    integrations,
    dbConfig,
    existingFiles: existingFiles.map((f) => ({ path: f.path })),
  })

  const userPrompt = [
    'EXISTING PROJECT FILES:',
    fileSummary || '(none)',
    '',
    'USER REQUEST:',
    message,
    '',
    'Return ONLY a JSON array of files to create or update. ' +
      'For updates, return the FULL new content of the file. ' +
      'Do not return unchanged files.',
  ].join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map((h) => ({
      role: h.role,
      content: h.content,
    })),
    { role: 'user', content: userPrompt },
  ]

  const result = await complete(messages, 'code', {
    temperature: 0.4,
    maxTokens: 8000,
  }, overrideProvider ?? null)

  const llmFiles = extractFilesFromText(result.content)

  // Apply updates (upsert by path).
  const fileOps: FileOp[] = []
  for (const f of llmFiles) {
    const { data: existing } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', projectId)
      .eq('path', f.path)
      .maybeSingle()
    const exists = !!existing

    // Upsert using the (project_id, path) unique constraint.
    const { error: upsertError } = await db
      .from('project_files')
      .upsert({
        project_id: projectId,
        path: f.path,
        content: f.content,
        language: f.language,
        generated: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,path' })

    if (upsertError) {
      // Best-effort: skip on error to avoid blocking the rest of the batch.
      continue
    }
    fileOps.push({ path: f.path, action: exists ? 'update' : 'create', language: f.language })
  }

  const assistantMessage =
    llmFiles.length > 0
      ? `Applied ${llmFiles.length} file change${llmFiles.length === 1 ? '' : 's'}: ${fileOps.map((o) => o.path).join(', ')}.`
      : `I couldn't parse structured file changes from the model response. Try rephrasing, e.g. "Add a login page" or "Create an API route at /api/users".`

  await db.from('generations').insert({
    project_id: projectId,
    role: 'assistant',
    content: assistantMessage,
    file_ops: JSON.stringify(fileOps),
    provider_id: result.provider.id,
    tokens: result.tokens,
    duration_ms: result.durationMs,
  })

  await db
    .from('projects')
    .update({ status: 'preview-ready', updated_at: new Date().toISOString() })
    .eq('id', projectId)

  return {
    message: assistantMessage,
    fileOps,
    files: llmFiles,
    provider: result.provider,
    tokens: result.tokens,
    durationMs: result.durationMs,
  }
}

// ---------------------------------------------------------------------------
// Language detection from path.
// ---------------------------------------------------------------------------

export function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tsx':
      return 'tsx'
    case 'ts':
      return 'ts'
    case 'jsx':
      return 'jsx'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
    case 'htm':
      return 'html'
    case 'md':
    case 'mdx':
      return 'md'
    case 'sql':
      return 'sql'
    case 'env':
    case 'example':
      return 'env'
    case 'prisma':
      return 'prisma'
    case 'yml':
    case 'yaml':
      return 'yml'
    case 'toml':
      return 'toml'
    case 'sh':
      return 'sh'
    default:
      if (path.endsWith('.env.example') || path === '.env.example') return 'env'
      if (path === 'Dockerfile') return 'sh'
      return 'text'
  }
}
