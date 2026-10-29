// POST /api/projects/[id]/seo — generates SEO assets for the project:
//   1. Enhanced metadata in layout.tsx (title, description, OpenGraph, Twitter)
//   2. sitemap.xml (Next.js App Router convention: app/sitemap.ts)
//   3. robots.txt (app/robots.ts)
//   4. JSON-LD structured data (app/structured-data.tsx)
//   5. manifest.json (app/manifest.ts)
//
// All files are generated based on the project's name, description, and stack.
// The user can optionally provide a domain for absolute URLs.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { guessLanguage } from '@/lib/llm/code-generator'
import { audit } from '@/lib/snapshot'

interface SeoBody {
  domain?: string
  title?: string
  description?: string
  ogImage?: string
  twitterHandle?: string
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
  const { data: project } = await db
    .from('projects')
    .select('owner_id, name, prompt, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as SeoBody
  const domain = body.domain?.trim().replace(/\/$/, '') || 'https://example.com'
  const title = body.title?.trim() || project.name
  const description = body.description?.trim() || project.prompt.slice(0, 160) || `${project.name} — built with Buildr`
  const ogImage = body.ogImage?.trim() || `${domain}/api/og`
  const twitterHandle = body.twitterHandle?.trim().replace(/^@/, '') || 'buildr'

  const filesToSave: { path: string; content: string; language: string }[] = []

  // 1. sitemap.ts (Next.js App Router convention)
  filesToSave.push({
    path: 'src/app/sitemap.ts',
    language: 'ts',
    content: `import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = '${domain}'
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: \`\${baseUrl}/about\`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: \`\${baseUrl}/contact\`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]
}
`,
  })

  // 2. robots.ts (Next.js App Router convention)
  filesToSave.push({
    path: 'src/app/robots.ts',
    language: 'ts',
    content: `import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/'],
    },
    sitemap: '${domain}/sitemap.xml',
  }
}
`,
  })

  // 3. manifest.ts (PWA manifest)
  filesToSave.push({
    path: 'src/app/manifest.ts',
    language: 'ts',
    content: `import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '${title}',
    short_name: '${title.slice(0, 12)}',
    description: '${description}',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#059669',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
`,
  })

  // 4. opengraph-image.tsx (dynamic OG image)
  filesToSave.push({
    path: 'src/app/opengraph-image.tsx',
    language: 'tsx',
    content: `import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = '${title}'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function OGImage() {
  return new ImageResponse(
    (
      <div style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
        fontFamily: 'system-ui',
      }}>
        <h1 style={{
          fontSize: 72,
          fontWeight: 700,
          color: 'white',
          marginBottom: 20,
        }}>${title}</h1>
        <p style={{
          fontSize: 28,
          color: 'rgba(255,255,255,0.8)',
          maxWidth: 800,
          textAlign: 'center',
        }}>${description}</p>
      </div>
    ),
    size
  )
}
`,
  })

  // 5. JSON-LD structured data component
  filesToSave.push({
    path: 'src/components/StructuredData.tsx',
    language: 'tsx',
    content: `// JSON-LD structured data for SEO. Insert this in your layout's <head>.
export function StructuredData() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: '${title}',
    description: '${description}',
    url: '${domain}',
    applicationCategory: 'WebApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    publisher: {
      '@type': 'Organization',
      name: '${title}',
      url: '${domain}',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
`,
  })

  // 6. Enhanced metadata snippet (for the user to merge into their layout.tsx)
  const metadataSnippet = `// Add this to your src/app/layout.tsx:
export const metadata: Metadata = {
  title: {
    default: '${title}',
    template: '%s | ${title}',
  },
  description: '${description}',
  metadataBase: new URL('${domain}'),
  keywords: ['${title.toLowerCase()}', 'web app', 'nextjs'],
  authors: [{ name: '${title}' }],
  openGraph: {
    title: '${title}',
    description: '${description}',
    url: '${domain}',
    siteName: '${title}',
    images: [{ url: '${ogImage}', width: 1200, height: 630 }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '${title}',
    description: '${description}',
    images: ['${ogImage}'],
    creator: '@${twitterHandle}',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  verification: {
    google: 'your-google-site-verification-code',
  },
}`

  // Save all files (upsert).
  const savedFiles: { path: string }[] = []
  for (const file of filesToSave) {
    const { data: existing } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', id)
      .eq('path', file.path)
      .maybeSingle()

    if (existing) {
      await db
        .from('project_files')
        .update({ content: file.content, language: file.language, updated_at: new Date().toISOString() })
        .eq('project_id', id)
        .eq('path', file.path)
    } else {
      await db.from('project_files').insert({
        project_id: id,
        path: file.path,
        content: file.content,
        language: file.language,
        generated: true,
      })
    }
    savedFiles.push({ path: file.path })
  }

  await audit('seo.generate', { filesGenerated: savedFiles.length, domain }, user.id, id)

  return NextResponse.json({
    ok: true,
    filesSaved: savedFiles,
    metadataSnippet,
    domain,
  })
}
