// GET /api/shared/[slug] — public, unauthenticated read-only access to a
// shared project's metadata + files + preview HTML. Used by the "shared
// project" view accessible via /?shared={slug}.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildInteractivePreview } from '@/lib/generator/preview-runtime'
import type { StackKey } from '@/lib/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const { data: project, error } = await db
    .from('projects')
    .select('id, name, slug, description, stack, styling, share_slug, is_public')
    .eq('share_slug', slug)
    .eq('is_public', true)
    .maybeSingle()

  if (error || !project || !project.is_public) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const wantsPreview = url.searchParams.get('preview') === 'true'

  // If preview=true, return the live preview HTML.
  //
  // SECURITY: serve with a strict Content-Security-Policy that blocks
  // all XHR/fetch (connect-src 'none'). This prevents generated code from
  // calling our API endpoints with the visitor's cookies — which would
  // be a stored-XSS vector. Scripts can still run (needed for React/
  // Babel/Tailwind CDN), but they cannot make network requests to the
  // app's origin. The preview is meant for visual rendering only.
  if (wantsPreview) {
    const { data: files } = await db
      .from('project_files')
      .select('path, content, language')
      .eq('project_id', project.id)
    const bundle = buildInteractivePreview(
      project.name,
      project.id,
      project.stack as StackKey,
      files ?? [],
    )
    return new NextResponse(bundle.html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // Block all fetch/XHR/WebSocket from the generated code.
        // Allow scripts from CDNs (esm.sh, unpkg, tailwindcss).
        // Allow inline scripts + eval (Babel transpilation).
        // frame-ancestors * so it can be embedded in iframes.
        'content-security-policy': [
          "default-src 'self'",
          "script-src 'unsafe-inline' 'unsafe-eval' https://esm.sh https://unpkg.com https://cdn.tailwindcss.com",
          "style-src 'unsafe-inline' https://cdn.tailwindcss.com",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'none'",
          "frame-ancestors *",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; '),
        // Extra defense: X-Content-Type-Options prevents MIME sniffing.
        'x-content-type-options': 'nosniff',
      },
    })
  }

  // Otherwise return the project metadata + file list (without content).
  const { data: files } = await db
    .from('project_files')
    .select('path, language, generated')
    .eq('project_id', project.id)
    .order('path', { ascending: true })

  return NextResponse.json({
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      stack: project.stack,
      styling: project.styling,
    },
    files: (files ?? []).map((f: { path: string; language: string; generated: boolean }) => ({
      path: f.path,
      language: f.language,
      generated: f.generated,
    })),
    previewUrl: `/api/shared/${slug}?preview=true`,
  })
}
