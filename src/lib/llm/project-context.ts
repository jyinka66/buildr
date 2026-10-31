// Picks which project files to show the model, with their real contents, within a size budget.
//
// Why: the builder and the project chat used to see only file names and sizes. The builder is told
// to return the FULL new content of any file it changes, so it had to rewrite files it had never
// read. Showing the relevant code lets it make edits that fit the existing app.
//
// Pure and dependency free so it runs under plain `node --test`.

export interface ContextFile {
  path: string
  content: string
}

export interface ContextOptions {
  /** Total characters of file content to include (about 4 characters per token). */
  maxTotalChars: number
  /** Files longer than this are listed but not shown in full. */
  maxFileChars: number
  /** Maximum number of files whose content is shown. */
  maxFiles: number
}

export interface ProjectContext {
  /** Files shown with their content, most relevant first. */
  shown: ContextFile[]
  /** Paths that exist but were not shown (too large, low relevance or over budget). */
  omitted: { path: string; chars: number; reason: 'too_large' | 'budget' | 'skipped' }[]
}

const SKIP_PATH = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|node_modules\/|\.next\/|dist\/|build\/|\.git\/)|\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|map|pdf|zip|mp4|mov)$/i

// Small files that explain how the app is wired. Shown first when they fit.
const KEY_FILES = [
  'package.json',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'app/layout.tsx',
  'app/page.tsx',
  'src/app/globals.css',
  'app/globals.css',
]

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'add', 'make', 'new', 'page', 'please',
  'can', 'you', 'now', 'use', 'create', 'change', 'update', 'fix', 'remove', 'want', 'need',
])

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP_WORDS.has(w))
}

export function scoreFile(file: ContextFile, request: string, requestWords: Set<string>): number {
  const path = file.path.toLowerCase()
  const lowerRequest = request.toLowerCase()
  let score = 0

  // The user named the file, or its base name, directly.
  if (lowerRequest.includes(path)) score += 100
  else {
    const base = path.split('/').pop() ?? path
    const stem = base.replace(/\.[a-z0-9]+$/, '')
    if (base.length > 3 && lowerRequest.includes(base)) score += 60
    else if (stem.length > 3 && requestWords.has(stem)) score += 25
  }

  // Words in the request that appear in the path ("login" -> src/app/login/page.tsx).
  for (const segment of words(path.replace(/[./_-]/g, ' '))) {
    if (requestWords.has(segment)) score += 12
  }

  // Words in the request that appear in the file body (cheap: first 4000 characters only).
  const head = file.content.slice(0, 4000).toLowerCase()
  let bodyHits = 0
  for (const w of requestWords) {
    if (w.length > 3 && head.includes(w)) bodyHits++
    if (bodyHits >= 5) break
  }
  score += bodyHits * 2

  const keyIndex = KEY_FILES.indexOf(file.path)
  if (keyIndex !== -1) score += 20 - keyIndex

  return score
}

export function selectProjectContext(files: ContextFile[], request: string, options: ContextOptions): ProjectContext {
  const requestWords = new Set(words(request))
  const omitted: ProjectContext['omitted'] = []
  const candidates: { file: ContextFile; score: number }[] = []

  for (const file of files) {
    if (SKIP_PATH.test(file.path) || typeof file.content !== 'string') {
      omitted.push({ path: file.path, chars: file.content?.length ?? 0, reason: 'skipped' })
      continue
    }
    if (file.content.length > options.maxFileChars) {
      omitted.push({ path: file.path, chars: file.content.length, reason: 'too_large' })
      continue
    }
    candidates.push({ file, score: scoreFile(file, request, requestWords) })
  }

  // Highest score first; ties keep path order so the result is stable.
  candidates.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))

  const shown: ContextFile[] = []
  let used = 0
  for (const { file } of candidates) {
    if (shown.length >= options.maxFiles || used + file.content.length > options.maxTotalChars) {
      omitted.push({ path: file.path, chars: file.content.length, reason: 'budget' })
      continue
    }
    shown.push(file)
    used += file.content.length
  }
  return { shown, omitted }
}

/** Renders the context as prompt text. Fences use ~~~ so code containing ``` cannot break out. */
export function formatProjectContext(context: ProjectContext): string {
  const parts: string[] = []
  for (const file of context.shown) {
    parts.push(`FILE: ${file.path}\n~~~\n${file.content.replace(/\s+$/, '')}\n~~~`)
  }
  const notShown = context.omitted.filter((o) => o.reason !== 'skipped')
  if (notShown.length) {
    const list = notShown
      .slice(0, 60)
      .map((o) => `- ${o.path} (${Math.max(1, Math.round(o.chars / 1024))}KB, ${o.reason === 'too_large' ? 'too large to show' : 'not shown'})`)
      .join('\n')
    parts.push(`FILES NOT SHOWN (they exist, but you cannot see their content):\n${list}`)
  }
  return parts.join('\n\n')
}

/**
 * User prompt for editing an existing project. Same output contract as before (a JSON array of
 * files), but the model now sees the current code of the relevant files.
 */
export function buildEditPrompt(files: ContextFile[], request: string): string {
  const list = files
    .slice(0, 40)
    .map((f) => `- ${f.path} (${Math.round(f.content.length / 1024)}KB)`)
    .join('\n')
  const code = formatProjectContext(selectProjectContext(files, request, BUILD_CONTEXT_LIMITS))
  return [
    'EXISTING PROJECT FILES:',
    list || '(none)',
    '',
    ...(code
      ? [
          'CURRENT CODE (the source of truth for the files shown; build on it, do not reinvent it):',
          code,
          '',
        ]
      : []),
    'USER REQUEST:',
    request,
    '',
    'Return ONLY a JSON array of files to create or update. ' +
      'For updates, return the FULL new content of the file and keep everything you are not changing. ' +
      'Do not return unchanged files. ' +
      'Make sure every import points to a file that exists or that you create. ' +
      'Prefer putting new code in new files over rewriting a file you cannot see.',
  ].join('\n')
}

export const BUILD_CONTEXT_LIMITS: ContextOptions = { maxTotalChars: 28_000, maxFileChars: 9_000, maxFiles: 14 }
export const CHAT_CONTEXT_LIMITS: ContextOptions = { maxTotalChars: 14_000, maxFileChars: 6_000, maxFiles: 8 }
