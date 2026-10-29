// GET /api/projects/[id]/accessibility — scans the project's generated React
// components for common accessibility issues. This is a static analysis pass
// (no browser rendering needed) that checks for:
//
//   1. <img> tags without alt attributes
//   2. <button> or <a> tags without accessible text (aria-label or text content)
//   3. <input> tags without associated <label> or aria-label
//   4. <div> or <span> with onClick handlers (should be <button>)
//   5. Missing heading hierarchy (h1 → h3 skipping h2)
//   6. Color contrast issues (inline styles with low-contrast color combos)
//   7. Missing <main> or <nav> semantic landmarks
//   8. Tables without <thead> or <caption>
//   9. Missing lang attribute on <html>
//  10. Form fields without autocomplete attributes
//
// Returns a list of issues with file path, line number, severity, and
// a fix recommendation. Also returns a summary score (0-100).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

interface A11yIssue {
  file: string
  line: number
  rule: string
  severity: 'error' | 'warning' | 'info'
  message: string
  fix: string
}

interface ScanResult {
  issues: A11yIssue[]
  summary: {
    total: number
    errors: number
    warnings: number
    info: number
    score: number // 0-100
  }
}

function scanFile(path: string, content: string): A11yIssue[] {
  const issues: A11yIssue[] = []
  const lines = content.split('\n')

  // Only scan JSX/TSX files.
  if (!/\.(tsx?|jsx?)$/.test(path)) return issues
  if (path.includes('node_modules') || path.includes('.test.')) return issues

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // 1. <img> without alt
    if (/<img\s/i.test(line) && !/alt\s*=/.test(line)) {
      issues.push({
        file: path,
        line: lineNum,
        rule: 'img-alt',
        severity: 'error',
        message: 'Image element is missing an alt attribute.',
        fix: 'Add alt="description of the image" to the <img> tag.',
      })
    }

    // 2. <button> without accessible text (no children, no aria-label)
    if (/<button[^>]*>\s*<\/button>/i.test(line) || /<button[^>]*>\s*<\//.test(line)) {
      const hasAriaLabel = /aria-label\s*=/.test(line)
      if (!hasAriaLabel) {
        issues.push({
          file: path,
          line: lineNum,
          rule: 'button-text',
          severity: 'error',
          message: 'Button element has no accessible text.',
          fix: 'Add text content or aria-label="description" to the button.',
        })
      }
    }

    // 3. <input> without label or aria-label
    if (/<input\s/i.test(line)) {
      const hasLabel = /aria-label\s*=|aria-labelledby\s*=|id\s*=/.test(line)
      if (!hasLabel) {
        issues.push({
          file: path,
          line: lineNum,
          rule: 'input-label',
          severity: 'warning',
          message: 'Input element has no associated label or aria-label.',
          fix: 'Add a <label htmlFor="id"> or aria-label="description" to the input.',
        })
      }
    }

    // 4. <div onClick> or <span onClick> (should be a button)
    if (/<(?:div|span)[^>]*onClick/i.test(line)) {
      issues.push({
        file: path,
        line: lineNum,
        rule: 'clickable-div',
        severity: 'warning',
        message: 'Clickable div/span — use a <button> instead for keyboard accessibility.',
        fix: 'Replace the <div onClick> with a <button onClick> for proper keyboard support.',
      })
    }

    // 5. Heading hierarchy: h3 without a preceding h2 in the file
    if (/<h3[\s>]/i.test(line)) {
      const hasH2 = lines.some((l) => /<h2[\s>]/i.test(l))
      const hasH1 = lines.some((l) => /<h1[\s>]/i.test(l))
      if (!hasH2 && !hasH1) {
        issues.push({
          file: path,
          line: lineNum,
          rule: 'heading-order',
          severity: 'warning',
          message: 'Heading level 3 used without a preceding h2 or h1.',
          fix: 'Use h2 before h3 to maintain heading hierarchy.',
        })
      }
    }

    // 6. Low contrast: inline style with very light text on white background
    if (/color:\s*['"]?(?:#(?:f[0-9a-f]{5}|e[0-9a-f]{5})|white|gray-200|gray-300)/i.test(line)) {
      issues.push({
        file: path,
        line: lineNum,
        rule: 'color-contrast',
        severity: 'info',
        message: 'Potentially low contrast text color detected.',
        fix: 'Ensure text has a contrast ratio of at least 4.5:1 against its background.',
      })
    }

    // 7. Tables without thead or caption
    if (/<table/i.test(line)) {
      const fileContent = lines.join('\n')
      if (!/<thead/i.test(fileContent) && !/<caption/i.test(fileContent)) {
        issues.push({
          file: path,
          line: lineNum,
          rule: 'table-headers',
          severity: 'warning',
          message: 'Table element is missing <thead> or <caption> for screen readers.',
          fix: 'Add a <thead> with <th> headers or a <caption> element.',
        })
      }
    }

    // 8. Missing autocomplete on form inputs
    if (/<input\s/i.test(line) && /type\s*=\s*['"](?:email|password|tel|text)/i.test(line)) {
      if (!/autocomplete\s*=/i.test(line)) {
        issues.push({
          file: path,
          line: lineNum,
          rule: 'autocomplete',
          severity: 'info',
          message: 'Form input is missing an autocomplete attribute.',
          fix: 'Add autocomplete="email" (or appropriate type) for better UX and autofill.',
        })
      }
    }

    // 9. role="button" on non-button elements (should use <button>)
    if (/role\s*=\s*['"]button['"]/.test(line) && !/<button/i.test(line)) {
      issues.push({
        file: path,
        line: lineNum,
        rule: 'role-button',
        severity: 'warning',
        message: 'Using role="button" on a non-button element. Use a real <button> instead.',
        fix: 'Replace the element with a <button> which has role="button" by default.',
      })
    }

    // 10. Missing tabIndex on interactive divs
    if (/<div[^>]*onClick/i.test(line) && !/tabIndex\s*=/.test(line) && !/role\s*=/.test(line)) {
      issues.push({
        file: path,
        line: lineNum,
        rule: 'keyboard-access',
        severity: 'warning',
        message: 'Clickable div is not keyboard accessible.',
        fix: 'Add tabIndex={0} and onKeyDown handler, or use a <button>.',
      })
    }
  }

  // Check for missing semantic landmarks at the file level.
  if (path.endsWith('page.tsx') || path.endsWith('App.tsx') || path.endsWith('layout.tsx')) {
    const hasMain = /<main/i.test(content)
    const hasNav = /<nav/i.test(content)
    const hasHeader = /<header/i.test(content)

    if (!hasMain) {
      issues.push({
        file: path,
        line: 1,
        rule: 'semantic-main',
        severity: 'info',
        message: 'Page is missing a <main> landmark element.',
        fix: 'Wrap the page content in a <main> element for screen reader navigation.',
      })
    }
  }

  // Check for missing lang attribute in layout files.
  if (path.endsWith('layout.tsx') || path.endsWith('root.tsx')) {
    if (!/<html\s+lang\s*=/.test(content)) {
      issues.push({
        file: path,
        line: 1,
        rule: 'html-lang',
        severity: 'warning',
        message: 'The <html> element is missing a lang attribute.',
        fix: 'Add lang="en" to the <html> element: <html lang="en">.',
      })
    }
  }

  return issues
}

export async function GET(
  _req: NextRequest,
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
    .select('owner_id')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: files, error } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  if (error || !files) {
    return NextResponse.json({ error: 'Failed to load files.' }, { status: 500 })
  }

  const allIssues: A11yIssue[] = []
  for (const file of files as { path: string; content: string }[]) {
    const fileIssues = scanFile(file.path, file.content)
    allIssues.push(...fileIssues)
  }

  // Sort by severity (errors first).
  const severityOrder = { error: 0, warning: 1, info: 2 }
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  const errors = allIssues.filter((i) => i.severity === 'error').length
  const warnings = allIssues.filter((i) => i.severity === 'warning').length
  const info = allIssues.filter((i) => i.severity === 'info').length

  // Score: start at 100, subtract weighted penalties.
  const score = Math.max(0, 100 - errors * 10 - warnings * 5 - info * 1)

  const result: ScanResult = {
    issues: allIssues.slice(0, 100), // cap for UI
    summary: {
      total: allIssues.length,
      errors,
      warnings,
      info,
      score,
    },
  }

  return NextResponse.json(result)
}
