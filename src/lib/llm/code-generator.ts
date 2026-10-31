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
import { replaceProjectFiles } from '@/lib/project-files'
import { buildEditPrompt } from '@/lib/llm/project-context'
import {
  batchPlanFiles,
  buildBatchPrompt,
  buildFixPrompt,
  buildPlanPrompt,
  checkProject,
  describeBuildResult,
  parsePlan,
  shipReadyFiles,
  type BuildPlan,
  type QualityIssue,
} from '@/lib/llm/build-quality'
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

// Plain, structured result messages shown in the chat after a build.
export function describeChanges(ops: { path: string; action: string }[]): string {
  const label = (a: string) => (a === 'create' ? 'New' : a === 'delete' ? 'Removed' : 'Updated')
  const lines = ops.map((o) => `- ${label(o.action)}: \`${o.path}\``)
  return [
    `**Done.** ${ops.length} file${ops.length === 1 ? '' : 's'} changed.`,
    '',
    ...lines,
    '',
    'Check the preview to see it. Tell me what to adjust next.',
  ].join('\n')
}

export function describeInitialBuild(paths: string[], total: number): string {
  const shown = paths.slice(0, 12).map((p) => `- \`${p}\``)
  const more = paths.length > 12 ? [`- and ${paths.length - 12} more`] : []
  return [
    `**Your app is ready.** ${total} files created.`,
    '',
    '**Main files**',
    ...shown,
    ...more,
    '',
    'Open the preview to try it, or tell me what to change or add next.',
  ].join('\n')
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
    'QUALITY BAR (what separates shipped apps from demos):',
    '- Clean structure: small focused components, one responsibility per file, shared types in one place, no duplicated logic.',
    '- Strict TypeScript: no "any", explicit prop and return types, handle null/undefined.',
    '- Every screen handles loading, empty, and error states with clear user-facing wording.',
    '- Forms validate input, show inline errors, and disable submit while sending.',
    '- Accessible and responsive: semantic HTML, labels on inputs, visible focus, works at phone width first.',
    '- Consistent, polished UI: one spacing scale, one color palette, real sample content (never "Lorem ipsum").',
    '- Secure by default: never put secrets in client code, validate and escape user input, check auth on every protected route.',
    '- Imports must resolve to files you emit or to files in the scaffold; never reference a file that does not exist.',
    '- When changing an existing app, keep its conventions and do not rewrite files you do not need to touch.',
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
  maxTokens?: number
}

// ---------------------------------------------------------------------------
// Production build pipeline: plan -> build in batches -> check -> auto-fix.
// Falls back to the original single-call build if planning fails, so it is
// never worse than before.
// ---------------------------------------------------------------------------

const BUILD_BUDGET_MS = 170_000
const FIX_BUDGET_MS = 230_000

interface PipelineInput {
  systemPrompt: string
  name: string
  brief: string
  stack: StackKey
  styling: StylingKey
  integrations: string[]
  dbConfig: DbConfig
  baseFiles: ExtractedFile[]
  overrideProvider: ProviderKey | null
  maxTokens?: number
  onStatus?: (message: string) => void
}

interface PipelineResult {
  files: ExtractedFile[]
  plan: BuildPlan | null
  provider: Awaited<ReturnType<typeof complete>>['provider']
  tokens: number
  durationMs: number
  fixedIssues: number
  remaining: QualityIssue[]
  skipped: string[]
}

function mergeByPath(into: Map<string, ExtractedFile>, files: ExtractedFile[]): void {
  for (const f of files) into.set(f.path, f)
}

export async function runBuildPipeline(input: PipelineInput): Promise<PipelineResult> {
  const started = Date.now()
  const maxTokens = Math.max(1, Math.min(8000, input.maxTokens ?? 8000))
  let tokens = 0
  let provider: PipelineResult['provider'] | null = null
  const note = (r: Awaited<ReturnType<typeof complete>>) => {
    tokens += r.tokens
    provider = provider ?? r.provider
  }
  const call = async (user: string, task: 'code' | 'general', temperature: number, max: number, system = input.systemPrompt) => {
    const r = await complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      task,
      { temperature, maxTokens: max },
      input.overrideProvider,
    )
    note(r)
    return r
  }

  // 1. Plan.
  let plan: BuildPlan | null = null
  input.onStatus?.('Planning the app…')
  try {
    const r = await call(
      buildPlanPrompt({
        name: input.name,
        brief: input.brief,
        stack: input.stack,
        styling: input.styling,
        database: `${input.dbConfig.engine} via ${input.dbConfig.orm}`,
        integrations: input.integrations,
        existingPaths: input.baseFiles.map((f) => f.path),
      }),
      'general',
      0.2,
      2500,
      'You are a senior software architect. You reply with a single JSON object and no other text.',
    )
    plan = parsePlan(r.content)
  } catch (err) {
    if (err instanceof Error && /No configured LLM providers/i.test(err.message)) throw err
    plan = null
  }

  // 2. Build in batches.
  const written = new Map<string, ExtractedFile>()
  const skipped: string[] = []
  if (plan) {
    const batches = batchPlanFiles(plan.files)
    for (let i = 0; i < batches.length; i++) {
      if (Date.now() - started > BUILD_BUDGET_MS) {
        skipped.push(...batches.slice(i).flat().map((f) => f.path))
        break
      }
      input.onStatus?.(`Building step ${i + 1} of ${batches.length}…`)
      try {
        const r = await call(
          buildBatchPrompt({
            plan,
            batch: batches[i],
            written: Array.from(written.values()),
            brief: input.brief,
            batchIndex: i,
            batchCount: batches.length,
          }),
          'code',
          0.4,
          maxTokens,
        )
        mergeByPath(written, extractFilesFromText(r.content))
      } catch (err) {
        if (err instanceof Error && /No configured LLM providers/i.test(err.message)) throw err
        skipped.push(...batches.slice(i).flat().map((f) => f.path))
        break
      }
    }
  }

  // Fallback: no plan, or nothing came back. One call, as before.
  if (written.size === 0) {
    input.onStatus?.('Building your app…')
    const r = await call(
      [
        `Project name: ${input.name}`,
        `Stack: ${input.stack} with ${input.styling}`,
        `Database: ${input.dbConfig.engine} via ${input.dbConfig.orm}`,
        `Integrations: ${input.integrations.join(', ') || 'none'}`,
        '',
        'Brief:',
        input.brief,
        '',
        'Generate the application code now. Return ONLY the JSON file array.',
      ].join('\n'),
      'code',
      0.4,
      maxTokens,
    )
    mergeByPath(written, extractFilesFromText(r.content))
    plan = null
    skipped.length = 0
  }

  // 3. Check and auto-fix (one pass, within the time budget).
  let fixedIssues = 0
  let remaining: QualityIssue[] = []
  if (written.size > 0) {
    const project = () => {
      const all = new Map<string, ExtractedFile>()
      mergeByPath(all, input.baseFiles)
      mergeByPath(all, Array.from(written.values()))
      return Array.from(all.values())
    }
    input.onStatus?.('Checking the code…')
    let issues = checkProject(project(), input.stack)
    if (issues.length > 0 && Date.now() - started < FIX_BUDGET_MS) {
      input.onStatus?.(`Fixing ${issues.length} problem${issues.length === 1 ? '' : 's'}…`)
      try {
        const r = await call(buildFixPrompt(issues, project()), 'code', 0.2, maxTokens)
        const fixes = extractFilesFromText(r.content)
        mergeByPath(written, fixes)
        const after = checkProject(project(), input.stack)
        fixedIssues = Math.max(0, issues.length - after.length)
        issues = after
      } catch {
        /* keep the unfixed build; the issues are reported to the user */
      }
    }
    remaining = issues
  }

  return {
    files: Array.from(written.values()),
    plan,
    provider: provider as unknown as PipelineResult['provider'],
    tokens,
    durationMs: Date.now() - started,
    fixedIssues,
    remaining,
    skipped,
  }
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

  // 4. Plan -> build in batches -> check -> auto-fix (see build-quality.ts).
  const built = await runBuildPipeline({
    systemPrompt,
    name: input.name,
    brief: prompt,
    stack,
    styling,
    integrations,
    dbConfig,
    baseFiles: [...scaffold, ...integrationFiles],
    overrideProvider: overrideProvider ?? null,
    maxTokens: input.maxTokens,
  })
  const llmFiles = built.files
  const result = { provider: built.provider, tokens: built.tokens, durationMs: built.durationMs }

  // 5. Merge: scaffold first, then integrations, then LLM (LLM wins on path conflicts).
  const merged = new Map<string, { path: string; content: string; language: string }>()
  for (const f of scaffold) merged.set(f.path, f)
  for (const f of integrationFiles) merged.set(f.path, f)
  for (const f of llmFiles) merged.set(f.path, f)
  // Production extras: README, .env.example, error/loading/404 pages, CI.
  if (llmFiles.length > 0) {
    const extras = shipReadyFiles(Array.from(merged.values()), {
      name: input.name,
      stack,
      plan: built.plan,
      integrations,
    })
    for (const f of extras) {
      merged.set(f.path, { path: f.path, content: f.content, language: f.language ?? guessLanguage(f.path) })
    }
  }

  // 6. Persist all files to the DB + record the generation.
  // Replace the previous file tree with the new one.
  const files = Array.from(merged.values())
  const fileOps: FileOp[] = files.map((f) => ({
    path: f.path,
    action: 'create',
    language: f.language,
  }))

  // Upsert first, then drop only stale paths, so a failed write can never leave the
  // project with no files (see src/lib/project-files.ts).
  await replaceProjectFiles(
    db,
    projectId,
    files.map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language,
      generated: !scaffold.some((s) => s.path === f.path),
    })),
  )

  const assistantMessage =
    llmFiles.length > 0
      ? describeBuildResult({
          plan: built.plan,
          writtenPaths: llmFiles.map((f) => f.path),
          total: files.length,
          fixedIssues: built.fixedIssues,
          remainingIssues: built.remaining,
          skippedPaths: built.skipped,
        })
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
  maxTokens?: number
}

export async function generateIncremental(
  input: IncrementalInput,
): Promise<GenerationResult> {
  const { projectId, message, stack, styling, integrations, dbConfig, history, existingFiles, overrideProvider } = input

  const systemPrompt = buildSystemPrompt({
    stack,
    styling,
    integrations,
    dbConfig,
    existingFiles: existingFiles.map((f) => ({ path: f.path })),
  })

  const userPrompt = buildEditPrompt(existingFiles, message)

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
    maxTokens: Math.max(1, Math.min(8000, input.maxTokens ?? 8000)),
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
      ? describeChanges(fileOps)
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
