// Pure helpers for the production-grade build pipeline.
// ------------------------------------------------------------------
// plan  -> build in batches -> check -> auto-fix -> ship-ready extras.
// Nothing here talks to a model or the database, so every rule is unit tested
// (tests/build-quality.test.mjs). The orchestration lives in code-generator.ts.

export interface PlanFile {
  path: string
  purpose: string
}

export interface BuildPlan {
  summary: string
  features: string[]
  pages: { route: string; purpose: string }[]
  dataModel: { name: string; fields: string[] }[]
  files: PlanFile[]
  envVars: string[]
}

export interface ProjectFileLike {
  path: string
  content: string
  language?: string
}

export interface QualityIssue {
  path: string
  message: string
}

const MAX_PLAN_FILES = 24
const SAFE_PATH = /^[A-Za-z0-9_.@()[\]/-]+$/

function str(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function strList(v: unknown, max = 20, each = 200): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : []
}

export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 200 || p.startsWith('/') || p.includes('..') || p.includes('\\') || p.includes('\0')) return false
  return SAFE_PATH.test(p)
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function buildPlanPrompt(opts: {
  name: string
  brief: string
  stack: string
  styling: string
  database: string
  integrations: string[]
  existingPaths: string[]
}): string {
  return [
    'You are the lead engineer for Buildr. Plan the app BEFORE any code is written.',
    'Return ONE JSON object and nothing else, with exactly these keys:',
    '{',
    '  "summary": "two sentences: what the app does and who it is for",',
    '  "features": ["5 to 10 concrete user-facing features"],',
    '  "pages": [{ "route": "/", "purpose": "..." }],',
    '  "dataModel": [{ "name": "Task", "fields": ["id", "title: string", "done: boolean"] }],',
    '  "files": [{ "path": "src/app/page.tsx", "purpose": "..." }],',
    '  "envVars": ["NAMES_OF_ENV_VARS_THE_APP_NEEDS"]',
    '}',
    '',
    'RULES:',
    '- Plan a complete, shippable product, not a demo: every page a user would expect, real data flow, empty/loading/error states.',
    `- "files" lists only the application files to WRITE (max ${MAX_PLAN_FILES}), ordered so shared code (types, lib, data access) comes before the pages that use it.`,
    '- Do not list files that already exist in the scaffold unless they must change: ' + JSON.stringify(opts.existingPaths.slice(0, 40)),
    '- If the app stores data, include the data model, the schema/migration file for the chosen database, and API routes or server actions that read and write it.',
    '- If the app has users, include sign-up, sign-in, sign-out and route protection.',
    '- Keep one responsibility per file. Use small reusable components.',
    '',
    `Project: ${opts.name}`,
    `Stack: ${opts.stack} with ${opts.styling}`,
    `Database: ${opts.database}`,
    `Integrations: ${opts.integrations.join(', ') || 'none'}`,
    '',
    'Brief:',
    opts.brief,
  ].join('\n')
}

export function parsePlan(text: string): BuildPlan | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const seen = new Set<string>()
  const files: PlanFile[] = []
  for (const f of Array.isArray(o.files) ? o.files : []) {
    if (!f || typeof f !== 'object') continue
    const path = str((f as Record<string, unknown>).path, 200).replace(/^\.\//, '')
    if (!isSafeRelativePath(path) || seen.has(path)) continue
    seen.add(path)
    files.push({ path, purpose: str((f as Record<string, unknown>).purpose, 200) })
    if (files.length >= MAX_PLAN_FILES) break
  }
  if (files.length === 0) return null

  const pages = (Array.isArray(o.pages) ? o.pages : [])
    .map((p) => ({
      route: str((p as Record<string, unknown>)?.route, 120),
      purpose: str((p as Record<string, unknown>)?.purpose, 200),
    }))
    .filter((p) => p.route)
    .slice(0, 20)

  const dataModel = (Array.isArray(o.dataModel) ? o.dataModel : [])
    .map((m) => ({
      name: str((m as Record<string, unknown>)?.name, 60),
      fields: strList((m as Record<string, unknown>)?.fields, 30, 80),
    }))
    .filter((m) => m.name)
    .slice(0, 20)

  const envVars = strList(o.envVars, 30, 80).filter((v) => /^[A-Z][A-Z0-9_]*$/.test(v))

  return {
    summary: str(o.summary, 500),
    features: strList(o.features, 12, 160),
    pages,
    dataModel,
    files,
    envVars,
  }
}

// Split the planned files into build batches. Order is kept, so shared code
// is written before the files that import it.
export function batchPlanFiles(files: PlanFile[], size = 5, maxBatches = 4): PlanFile[][] {
  const batches: PlanFile[][] = []
  const perBatch = Math.max(size, Math.ceil(files.length / maxBatches))
  for (let i = 0; i < files.length; i += perBatch) batches.push(files.slice(i, i + perBatch))
  return batches
}

// One line per written file: path plus its exports, so the next batch imports
// things that really exist instead of guessing names.
export function summarizeExports(files: ProjectFileLike[]): string {
  return files
    .map((f) => {
      const exports = (f.content.match(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+\w+/gm) ?? [])
        .map((e) => e.replace(/^export\s+/, '').replace(/\s+/g, ' '))
        .slice(0, 12)
      const hasDefault = /^export\s+default\b/m.test(f.content)
      const list = [...new Set(exports)]
      if (hasDefault && !list.some((e) => e.startsWith('default'))) list.push('default')
      return `- ${f.path}${list.length ? ` — exports: ${list.join('; ')}` : ''}`
    })
    .join('\n')
}

export function buildBatchPrompt(opts: {
  plan: BuildPlan
  batch: PlanFile[]
  written: ProjectFileLike[]
  brief: string
  batchIndex: number
  batchCount: number
}): string {
  const { plan } = opts
  return [
    `BUILD STEP ${opts.batchIndex + 1} OF ${opts.batchCount}.`,
    '',
    'APP PLAN',
    `Summary: ${plan.summary}`,
    `Features: ${plan.features.join('; ') || '-'}`,
    `Pages: ${plan.pages.map((p) => `${p.route} (${p.purpose})`).join('; ') || '-'}`,
    `Data model: ${plan.dataModel.map((m) => `${m.name}{${m.fields.join(', ')}}`).join('; ') || 'none'}`,
    `Env vars: ${plan.envVars.join(', ') || 'none'}`,
    '',
    'ALL PLANNED FILES (for imports):',
    plan.files.map((f) => `- ${f.path}: ${f.purpose}`).join('\n'),
    '',
    opts.written.length
      ? 'FILES ALREADY WRITTEN (import only what they export):\n' + summarizeExports(opts.written)
      : 'No files written yet.',
    '',
    'WRITE ONLY THESE FILES NOW (complete content, exactly these paths):',
    opts.batch.map((f) => `- ${f.path}: ${f.purpose}`).join('\n'),
    '',
    'Original brief:',
    opts.brief,
    '',
    'Return ONLY the JSON array of files.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Static checks (no compiler needed, so they run anywhere and never hang)
// ---------------------------------------------------------------------------

const CODE_FILE = /\.(tsx?|jsx?|mjs)$/
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream', 'events', 'child_process', 'buffer',
  'zlib', 'querystring', 'assert', 'net', 'tls', 'dns', 'readline', 'timers', 'process', 'worker_threads', 'perf_hooks',
])
const REACT_HOOKS = /\b(useState|useEffect|useRef|useReducer|useContext|useLayoutEffect|useTransition|useOptimistic|useActionState)\s*\(/
const PLACEHOLDER = /(\/\/\s*\.\.\.\s*(rest|existing|remaining)|\/\*\s*\.\.\.\s*\*\/|\blorem ipsum\b|\bTODO:?\s*implement\b|your code here)/i

function importSpecifiers(content: string): string[] {
  const specs: string[] = []
  const re = /(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) specs.push(m[1] ?? m[2] ?? m[3])
  return specs.filter(Boolean)
}

function packageName(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/')
  return spec.split('/')[0]
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

export function checkProject(files: ProjectFileLike[], stack: string): QualityIssue[] {
  const issues: QualityIssue[] = []
  const paths = new Set(files.map((f) => f.path))
  const exists = (base: string) => EXTENSIONS.some((ext) => paths.has(base + ext))

  // Declared dependencies (when a package.json is present).
  let deps: Set<string> | null = null
  const pkg = files.find((f) => f.path === 'package.json')
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as Record<string, Record<string, string> | undefined>
      deps = new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})])
    } catch {
      issues.push({ path: 'package.json', message: 'package.json is not valid JSON.' })
    }
  }

  for (const f of files) {
    if (f.path.endsWith('.json') && f.path !== 'package.json') {
      try {
        JSON.parse(f.content)
      } catch {
        issues.push({ path: f.path, message: 'File is not valid JSON.' })
      }
    }
    if (!CODE_FILE.test(f.path)) continue

    if (PLACEHOLDER.test(f.content)) {
      issues.push({ path: f.path, message: 'Contains placeholder text (lorem ipsum, "...rest", TODO implement). Write the real content.' })
    }

    const isNextApp = stack === 'nextjs' && /^src\/app\/.*\.(tsx|jsx)$/.test(f.path)
    if (isNextApp) {
      const isRouteFile = /\/(page|layout|not-found|error|loading)\.(tsx|jsx)$/.test(f.path)
      if (isRouteFile && !/^export\s+default\b/m.test(f.content)) {
        issues.push({ path: f.path, message: 'Route file must have a default export.' })
      }
      const clientNeeded = REACT_HOOKS.test(f.content) || /\bon(Click|Change|Submit|Input|KeyDown)=/.test(f.content)
      const hasDirective = /^\s*['"]use client['"]/.test(f.content)
      if (clientNeeded && !hasDirective && !/\/layout\.(tsx|jsx)$/.test(f.path)) {
        issues.push({ path: f.path, message: 'Uses React hooks or event handlers but is missing "use client" at the top.' })
      }
    }
    if (stack === 'nextjs' && /^src\/components\/.*\.(tsx|jsx)$/.test(f.path)) {
      const clientNeeded = REACT_HOOKS.test(f.content) || /\bon(Click|Change|Submit|Input|KeyDown)=/.test(f.content)
      if (clientNeeded && !/^\s*['"]use client['"]/.test(f.content)) {
        issues.push({ path: f.path, message: 'Uses React hooks or event handlers but is missing "use client" at the top.' })
      }
    }

    // Data loaded from the app's own API must never crash the screen when the
    // response is not a list (preview, empty database, failed request).
    if (/\bfetch\(\s*[`'"]\/api\//.test(f.content) && /\.map\(/.test(f.content) && !/Array\.isArray\(/.test(f.content)) {
      issues.push({
        path: f.path,
        message: 'Fetches from /api and renders a list with .map() without checking Array.isArray(data). Guard the response and fall back to built-in sample data so the screen never crashes or stays empty.',
      })
    }

    for (const spec of importSpecifiers(f.content)) {
      if (spec.startsWith('.')) {
        const target = normalize(`${dirOf(f.path)}/${spec}`)
        if (!exists(target)) issues.push({ path: f.path, message: `Imports "${spec}" but that file does not exist.` })
      } else if (spec.startsWith('@/')) {
        const target = normalize(`src/${spec.slice(2)}`)
        if (!exists(target) && !exists(normalize(spec.slice(2)))) {
          issues.push({ path: f.path, message: `Imports "${spec}" but that file does not exist.` })
        }
      } else if (deps) {
        const name = packageName(spec.replace(/^node:/, ''))
        if (spec.startsWith('node:') || NODE_BUILTINS.has(name)) continue
        if (!deps.has(name) && !deps.has(`@types/${name}`)) {
          issues.push({ path: f.path, message: `Imports package "${name}" which is not in package.json. Add it to dependencies or remove the import.` })
        }
      }
    }
  }

  // Cap so a badly broken build does not produce a huge fix prompt.
  return issues.slice(0, 40)
}

export function buildFixPrompt(issues: QualityIssue[], files: ProjectFileLike[]): string {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const affected = [...new Set(issues.map((i) => i.path))].slice(0, 8)
  const blocks = affected
    .map((p) => byPath.get(p))
    .filter((f): f is ProjectFileLike => !!f)
    .map((f) => `FILE: ${f.path}\n${f.content.slice(0, 9000)}`)
  return [
    'The generated project has these problems. Fix every one of them.',
    '',
    'PROBLEMS:',
    issues.map((i) => `- ${i.path}: ${i.message}`).join('\n'),
    '',
    'FILES WITH PROBLEMS:',
    blocks.join('\n\n---\n\n'),
    '',
    'ALL FILE PATHS IN THE PROJECT:',
    files.map((f) => f.path).join('\n'),
    '',
    'RULES: fix by editing the listed files or by creating a missing file. If a package is missing, add it to package.json with a real, current version (return the full package.json). Return ONLY a JSON array of the files you changed or created, with full content.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Ship-ready extras (deterministic, so they are always present)
// ---------------------------------------------------------------------------

export interface ShipContext {
  name: string
  stack: string
  plan: BuildPlan | null
  integrations: string[]
}

export function detectEnvVars(files: ProjectFileLike[]): string[] {
  const found = new Set<string>()
  for (const f of files) {
    if (!CODE_FILE.test(f.path)) continue
    for (const m of f.content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1])
    for (const m of f.content.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(m[1])
  }
  for (const builtin of ['NODE_ENV', 'PORT', 'MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR', 'NEXT_RUNTIME', 'VERCEL', 'CI']) found.delete(builtin)
  return [...found].sort()
}

export function mergeEnvExample(existing: string, vars: string[]): string {
  const have = new Set(
    existing
      .split('\n')
      .map((l) => /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(l)?.[1])
      .filter((v): v is string => !!v),
  )
  const missing = vars.filter((v) => !have.has(v))
  if (missing.length === 0) return existing
  const base = existing.endsWith('\n') || existing === '' ? existing : existing + '\n'
  return base + '\n# Added for this app\n' + missing.map((v) => `${v}=""`).join('\n') + '\n'
}

const NEXT_NOT_FOUND = `import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium text-neutral-500">404</p>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="max-w-md text-neutral-500">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-neutral-100">
        Back to home
      </Link>
    </main>
  )
}
`

const NEXT_ERROR = `'use client'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-neutral-500">
        {error.digest ? \`Reference: \${error.digest}\` : 'An unexpected error happened. Please try again.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-neutral-100"
      >
        Try again
      </button>
    </main>
  )
}
`

const NEXT_LOADING = `export default function Loading() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
    </main>
  )
}
`

const CI_WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
`

export function buildReadme(ctx: ShipContext, envVars: string[]): string {
  const { plan } = ctx
  const lines: string[] = [`# ${ctx.name}`, '']
  lines.push(plan?.summary || 'Generated with Buildr.', '')
  if (plan?.features.length) {
    lines.push('## Features', '', ...plan.features.map((f) => `- ${f}`), '')
  }
  if (plan?.pages.length) {
    lines.push('## Pages', '', '| Route | Purpose |', '| --- | --- |', ...plan.pages.map((p) => `| \`${p.route}\` | ${p.purpose} |`), '')
  }
  if (plan?.dataModel.length) {
    lines.push('## Data model', '')
    for (const m of plan.dataModel) lines.push(`- **${m.name}**: ${m.fields.join(', ')}`)
    lines.push('')
  }
  lines.push('## Getting started', '', '```bash', 'npm install', 'cp .env.example .env', 'npm run dev', '```', '')
  if (envVars.length) {
    lines.push('## Environment variables', '', 'Set these in `.env` locally and in your host\'s settings in production.', '')
    lines.push('| Variable |', '| --- |', ...envVars.map((v) => `| \`${v}\` |`), '')
  }
  lines.push(
    '## Scripts',
    '',
    '- `npm run dev` start the development server',
    '- `npm run build` create a production build',
    '- `npm run start` run the production build',
    '',
    '## Deploy',
    '',
    '1. Push this project to GitHub.',
    '2. Import the repository on your host (Render, Vercel or Netlify).',
    '3. Add the environment variables above.',
    '4. Deploy. Use `npm run build` as the build command.',
    '',
  )
  return lines.join('\n')
}

// Returns the files to add or replace. Existing files are never overwritten,
// except README.md and .env.example which are completed from the plan.
export function shipReadyFiles(files: ProjectFileLike[], ctx: ShipContext): ProjectFileLike[] {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const out: ProjectFileLike[] = []
  const add = (path: string, content: string, language: string) => {
    if (!byPath.has(path)) out.push({ path, content, language })
  }

  const planned = new Set([...(ctx.plan?.envVars ?? []), ...detectEnvVars(files)])
  const envVars = [...planned].sort()
  const env = byPath.get('.env.example')
  const mergedEnv = mergeEnvExample(env?.content ?? '', envVars)
  if (!env) out.push({ path: '.env.example', content: mergedEnv || '# No environment variables are required.\n', language: 'env' })
  else if (mergedEnv !== env.content) out.push({ path: '.env.example', content: mergedEnv, language: 'env' })

  if (ctx.plan) out.push({ path: 'README.md', content: buildReadme(ctx, envVars), language: 'md' })

  if (ctx.stack === 'nextjs') {
    add('src/app/not-found.tsx', NEXT_NOT_FOUND, 'tsx')
    add('src/app/error.tsx', NEXT_ERROR, 'tsx')
    add('src/app/loading.tsx', NEXT_LOADING, 'tsx')
  }
  if (ctx.stack === 'nextjs' || ctx.stack === 'react-vite' || ctx.stack === 'node-express') {
    add('.github/workflows/ci.yml', CI_WORKFLOW, 'yml')
  }
  return out
}

// ---------------------------------------------------------------------------
// Result message shown in the chat
// ---------------------------------------------------------------------------

export function describeBuildResult(opts: {
  plan: BuildPlan | null
  writtenPaths: string[]
  total: number
  fixedIssues: number
  remainingIssues: QualityIssue[]
  skippedPaths: string[]
}): string {
  const { plan } = opts
  const lines: string[] = [`**Your app is ready.** ${opts.total} files created.`, '']
  if (plan?.summary) lines.push(plan.summary, '')
  if (plan?.pages.length) {
    lines.push('**Pages**', ...plan.pages.slice(0, 10).map((p) => `- \`${p.route}\` ${p.purpose}`), '')
  }
  if (plan?.dataModel.length) {
    lines.push('**Data**', ...plan.dataModel.slice(0, 8).map((m) => `- ${m.name}`), '')
  }
  const shown = opts.writtenPaths.slice(0, 12).map((p) => `- \`${p}\``)
  if (shown.length) {
    lines.push('**Main files**', ...shown)
    if (opts.writtenPaths.length > 12) lines.push(`- and ${opts.writtenPaths.length - 12} more`)
    lines.push('')
  }
  lines.push('**Included for production**', '- README with setup and deploy steps', '- `.env.example` listing every variable', '- Error, loading and not-found pages', '- CI workflow that builds on every push', '')
  if (opts.fixedIssues > 0) lines.push(`I checked the code and fixed ${opts.fixedIssues} problem${opts.fixedIssues === 1 ? '' : 's'} automatically.`, '')
  if (opts.remainingIssues.length > 0) {
    lines.push(
      `**Needs a look:** ${opts.remainingIssues.length} issue${opts.remainingIssues.length === 1 ? '' : 's'} could not be fixed automatically.`,
      ...opts.remainingIssues.slice(0, 5).map((i) => `- \`${i.path}\`: ${i.message}`),
      'Tell me "fix the issues" and I will try again.',
      '',
    )
  }
  if (opts.skippedPaths.length > 0) {
    lines.push(
      `**Not built yet (${opts.skippedPaths.length}):** ${opts.skippedPaths.slice(0, 6).map((p) => `\`${p}\``).join(', ')}. Say "continue building" to add them.`,
      '',
    )
  }
  lines.push('Open the preview to try it, or tell me what to change next.')
  return lines.join('\n')
}
