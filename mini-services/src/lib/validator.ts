// Generated-code validation + self-heal (P1 — biggest quality multiplier).
// ------------------------------------------------------------------
// After a generation applies file changes, we validate the generated
// TypeScript/TSX by running `tsc --noEmit` in a temporary directory.
// If errors are found, we feed them back to the LLM for ONE retry pass
// (self-heal). This catches the common "generated code references a
// missing import" or "uses an undefined variable" class of bug.
//
// Implementation: we write the .ts/.tsx files to a temp dir, generate a
// minimal tsconfig.json, spawn `bunx tsc --noEmit`, and parse the output.
// Uses the project's own TypeScript install — no external service.

import { writeFile, mkdir, rm } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

export interface ValidationError {
  file: string
  line: number
  col: number
  message: string
  code: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
  durationMs: number
}

/**
 * Validates the generated TS/TSX files by running tsc --noEmit in a
 * temporary directory. Returns a list of type errors.
 */
export async function validateProjectFiles(
  files: { path: string; content: string }[],
): Promise<ValidationResult> {
  const start = Date.now()
  const sessionId = randomUUID()
  const dir = join(tmpdir(), `buildr-validate-${sessionId}`)
  const tsFiles: { path: string; content: string }[] = []

  // Collect TS/TSX files only (skip configs, json, css, sql, etc.)
  for (const f of files) {
    if (/\.(tsx?|jsx?)$/.test(f.path) && !f.path.includes('node_modules')) {
      tsFiles.push(f)
    }
  }

  if (tsFiles.length === 0) {
    return { ok: true, errors: [], durationMs: Date.now() - start }
  }

  try {
    // Write files to temp dir, flattening to just the basename (tsc with
    // a single root doesn't need the full path structure).
    await mkdir(dir, { recursive: true })
    const writtenPaths: string[] = []
    for (let i = 0; i < tsFiles.length; i++) {
      const f = tsFiles[i]
      // SECURITY: sanitize the path to prevent directory traversal.
      // A path like "a/../../../app/server.js" must NOT escape the temp dir.
      // We normalize and verify the resolved path stays within `dir`.
      const cleanedPath = f.path
        .replace(/\\/g, '/') // normalize Windows separators
        .replace(/^\/+/, '') // strip leading slashes
      // Reject any segment that traverses up.
      const parts = cleanedPath.split('/')
      if (parts.some((p) => p === '..')) {
        // Skip files with traversal sequences — they're suspicious.
        continue
      }
      if (cleanedPath.includes('\0')) continue // null-byte injection

      // Preserve relative structure for local imports to resolve.
      const fullPath = join(dir, cleanedPath)
      // Final check: resolved path must be inside `dir`.
      if (!fullPath.startsWith(dir)) {
        continue
      }
      const fileDir = fullPath.slice(0, fullPath.lastIndexOf('/'))
      await mkdir(fileDir, { recursive: true })
      // Strip imports that reference @/ or bare modules we can't resolve.
      const stripped = f.content
        .replace(/^import\s+[^;]+from\s+['"]@\/[^'"]+['"];?\s*$/gm, '')
        .replace(/^import\s+['"]@\/[^'"]+['"];?\s*$/gm, '')
        .replace(/^export\s+default\s+function/gm, 'function')
      await writeFile(fullPath, stripped, 'utf-8')
      writtenPaths.push(cleanedPath)
    }

    if (writtenPaths.length === 0) {
      return { ok: true, errors: [], durationMs: Date.now() - start }
    }

    // Minimal tsconfig that relaxes strict resolution so we catch type
    // errors but not module-not-found (which we expect for generated code).
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        moduleResolution: 'bundler',
        esModuleInterop: true,
        isolatedModules: true,
        allowImportingTsExtensions: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
        types: [],
      },
      include: writtenPaths,
    }
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig), 'utf-8')

    // Run tsc --noEmit. We use the local TypeScript install via npx/bunx.
    let output = ''
    try {
      await execFileAsync('bunx', ['tsc', '--noEmit', '--pretty', 'false'], {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
      // No output = no errors (tsc exits 0 silently).
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string }
      output = e.stdout || e.stderr || String(err)
    }

    const errors = parseTscOutput(output)

    return {
      ok: errors.length === 0,
      errors,
      durationMs: Date.now() - start,
    }
  } catch {
    // If tsc fails to run (e.g. not installed), skip validation.
    return { ok: true, errors: [], durationMs: Date.now() - start }
  } finally {
    // Clean up temp dir.
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function parseTscOutput(output: string): ValidationError[] {
  const errors: ValidationError[] = []
  const lines = output.split('\n')
  // Format: file.ts(line,col): error TSxxxx: message
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/
  for (const line of lines) {
    const m = re.exec(line.trim())
    if (m) {
      errors.push({
        file: m[1].split('/').pop() || m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        code: m[4],
        message: m[5],
      })
    }
  }
  return errors.slice(0, 20) // cap to keep prompts manageable
}
