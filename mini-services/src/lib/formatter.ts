// Code formatter — runs Prettier on generated source files before they're
// saved to the database. This ensures all generated code is professionally
// formatted (consistent indentation, line width, trailing commas, etc.)
// regardless of how the LLM formats its output.
//
// Supports: TypeScript, TSX, JavaScript, JSX, JSON, CSS, HTML, Markdown,
// YAML, GraphQL, SQL (best-effort). Files with unknown extensions are
// returned as-is.

import { format as prettierFormat, type Options } from 'prettier'

// Cache loaded parser configs per file type to avoid repeated async loads.
const parserCache = new Map<string, string | null>()

function getParser(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const lang = ext

  // Check cache.
  if (parserCache.has(lang)) return parserCache.get(lang)! || null

  let parser: string | null = null
  switch (lang) {
    case 'ts': case 'tsx':
      parser = 'typescript'
      break
    case 'js': case 'jsx': case 'mjs': case 'cjs':
      parser = 'babel'
      break
    case 'json':
      parser = 'json'
      break
    case 'css': case 'scss':
      parser = 'css'
      break
    case 'html': case 'htm': case 'astro':
      parser = 'html'
      break
    case 'md': case 'mdx':
      parser = 'markdown'
      break
    case 'yml': case 'yaml':
      parser = 'yaml'
      break
    case 'graphql': case 'gql':
      parser = 'graphql'
      break
    case 'sql':
      parser = 'sql' // Prettier 3.x supports SQL
      break
    default:
      parser = null
  }

  parserCache.set(lang, parser)
  return parser
}

/**
 * Formats a single file's content with Prettier.
 * Returns the original content if formatting fails (never throws).
 */
export async function formatFile(
  filePath: string,
  content: string,
): Promise<string> {
  const parser = getParser(filePath)
  if (!parser) return content // unsupported file type — return as-is

  try {
    const options: Options = {
      parser,
      semi: false, // match the modern Next.js convention
      singleQuote: true,
      trailingComma: 'es5',
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      bracketSpacing: true,
      arrowParens: 'always',
      endOfLine: 'lf',
    }

    const formatted = await prettierFormat(content, options)
    return formatted
  } catch {
    // If Prettier fails (syntax error, etc.), return the original content.
    // Don't let formatting break the generation pipeline.
    return content
  }
}

/**
 * Formats multiple files in parallel.
 * Returns a map of path → formatted content.
 */
export async function formatFiles(
  files: { path: string; content: string; language?: string }[],
): Promise<{ path: string; content: string; language: string }[]> {
  const results = await Promise.all(
    files.map(async (f) => ({
      path: f.path,
      content: await formatFile(f.path, f.content),
      language: f.language || guessLanguageFromPath(f.path),
    })),
  )
  return results
}

function guessLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tsx': return 'tsx'
    case 'ts': return 'ts'
    case 'jsx': return 'jsx'
    case 'js': case 'mjs': case 'cjs': return 'js'
    case 'json': return 'json'
    case 'css': return 'css'
    case 'html': case 'htm': return 'html'
    case 'md': case 'mdx': return 'md'
    case 'sql': return 'sql'
    case 'yml': case 'yaml': return 'yml'
    case 'prisma': return 'prisma'
    default: return 'text'
  }
}
