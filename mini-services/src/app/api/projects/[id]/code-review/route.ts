// POST /api/projects/[id]/code-review — AI-powered code review of the
// project's source files. The LLM analyzes each file for:
//   - Bugs (null checks, race conditions, logic errors)
//   - Security issues (XSS, injection, hardcoded secrets)
//   - Performance problems (N+1 queries, unnecessary re-renders, memory leaks)
//   - Best practice violations (missing error handling, improper hooks)
//   - Type safety (any types, missing null checks)
//
// Returns a list of findings with file, line, severity, and fix suggestion.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { audit } from '@/lib/snapshot'

interface ReviewBody {
  providerKey?: string | null
}

interface Finding {
  file: string
  line: number
  severity: 'critical' | 'warning' | 'suggestion' | 'praise'
  category: 'bug' | 'security' | 'performance' | 'best-practice' | 'type-safety'
  message: string
  fix: string
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
  const rl = rateLimit(`code-review:${user.id}`, { limit: 5, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, name, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as ReviewBody

  // Fetch all source files (limit to 15 for prompt size).
  const { data: files } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  const codeFiles = (files ?? [])
    .filter((f: { path: string }) => /\.(tsx?|jsx?|svelte|astro)$/.test(f.path))
    .filter((f: { path: string }) => !f.path.includes('node_modules') && !f.path.includes('.test.') && !f.path.startsWith('public/'))
    .slice(0, 15)

  if (codeFiles.length === 0) {
    return NextResponse.json({ error: 'No code files to review.' }, { status: 400 })
  }

  const fileContents = codeFiles
    .map((f: { path: string; content: string }) => {
      const maxLen = 3000
      const content = f.content.length > maxLen ? f.content.slice(0, maxLen) + '\n// ... truncated ...' : f.content
      return `// FILE: ${f.path}\n${content}`
    })
    .join('\n\n---\n\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert code reviewer for ' + project.stack + ' applications.',
        'Review the following project files for bugs, security issues, performance problems,',
        'best practice violations, and type safety issues.',
        '',
        'Return ONLY a JSON array of findings:',
        '[{"file":"src/app/page.tsx","line":42,"severity":"critical","category":"bug","message":"...","fix":"..."}]',
        '',
        'Severity levels: "critical" (must fix), "warning" (should fix), "suggestion" (nice to have), "praise" (good practice).',
        'Categories: "bug", "security", "performance", "best-practice", "type-safety".',
        '',
        'Rules:',
        '- Be specific: cite the exact line number and issue.',
        '- Provide actionable fixes (code snippets where helpful).',
        '- Don\'t report stylistic preferences — focus on real issues.',
        '- If code looks good, add "praise" findings for what\'s well done.',
        '- Cap at 20 findings. Prioritize critical > warning > suggestion.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Stack: ${project.stack}`,
        '',
        'CODE FILES:',
        fileContents,
        '',
        'Review these files. Return ONLY the JSON array of findings.',
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.2,
      maxTokens: 6000,
    }, (body.providerKey as never) ?? null)

    // Parse findings.
    let findings: Finding[] = []
    try {
      const text = result.content
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
      const candidate = fence ? fence[1] : text
      const start = candidate.indexOf('[')
      const end = candidate.lastIndexOf(']')
      if (start !== -1 && end !== -1) {
        const arr = JSON.parse(candidate.slice(start, end + 1))
        if (Array.isArray(arr)) {
          findings = arr.filter((f: Record<string, unknown>) => f.file && f.message)
        }
      }
    } catch {
      findings = []
    }

    // Sort by severity.
    const severityOrder = { critical: 0, warning: 1, suggestion: 2, praise: 3 }
    findings.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))

    const summary = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      suggestion: findings.filter((f) => f.severity === 'suggestion').length,
      praise: findings.filter((f) => f.severity === 'praise').length,
    }

    await audit('code_review.run', { filesReviewed: codeFiles.length, findings: summary.total }, user.id, id)

    return NextResponse.json({
      ok: true,
      findings,
      summary,
      filesReviewed: codeFiles.length,
      provider: { name: result.provider.name, model: result.provider.model },
      tokens: result.tokens,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'review_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
