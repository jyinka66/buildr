// POST /api/projects/[id]/generate-image — generates an AI image using
// z-ai-web-dev-sdk and saves it as a project file (base64 data URL) so it
// appears in the file explorer, preview, and ZIP export.
//
// The image is stored as a .png file in the project's `public/generated/`
// directory. The content is the base64 data URL so it can be referenced
// directly in <img src="data:image/png;base64,..."> or in CSS backgrounds.
//
// This closes the biggest visual-quality gap: generated apps go from bare
// skeletons to real-looking products with hero images, logos, and icons.
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

const SUPPORTED_SIZES = [
  '1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440',
]

interface GenerateBody {
  prompt: string
  size?: string
  filename?: string
  category?: 'hero' | 'logo' | 'icon' | 'illustration' | 'background' | 'product' | 'og-image'
}

// Build an enhanced prompt with quality + style modifiers based on category.
function enhancePrompt(prompt: string, category?: string): string {
  const base = prompt.trim()
  const quality = 'high quality, detailed, professional'
  switch (category) {
    case 'hero':
      return `${base}, modern web design hero image, ${quality}, suitable for website landing page`
    case 'logo':
      return `${base}, minimalist logo design, clean vector style, simple geometric shapes, centered, white background, ${quality}`
    case 'icon':
      return `${base}, flat icon design, clean, simple, minimal, ${quality}`
    case 'illustration':
      return `${base}, digital illustration, modern flat design style, ${quality}`
    case 'background':
      return `${base}, subtle background pattern, soft colors, ${quality}, suitable as website background`
    case 'product':
      return `${base}, professional product photography, studio lighting, white background, ${quality}`
    case 'og-image':
      return `${base}, social media card, bold, eye-catching, ${quality}`
    default:
      return `${base}, ${quality}`
  }
}

// Map category to default size.
function defaultSizeForCategory(category?: string): string {
  switch (category) {
    case 'hero': return '1440x720'
    case 'logo': return '1024x1024'
    case 'icon': return '1024x1024'
    case 'background': return '1440x720'
    case 'product': return '1024x1024'
    case 'og-image': return '1344x768'
    default: return '1024x1024'
  }
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  // Rate limit: 10 image generations per 5 min per user.
  const rl = rateLimit(`img-gen:${user.id}`, { limit: 10, windowMs: 300_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const body = (await req.json()) as GenerateBody & { projectId: string }
  const { projectId, prompt, category, filename } = body
  let size = body.size || defaultSizeForCategory(category)

  if (!projectId || !prompt?.trim()) {
    return NextResponse.json({ error: 'projectId and prompt are required.' }, { status: 400 })
  }
  if (!SUPPORTED_SIZES.includes(size)) {
    size = defaultSizeForCategory(category)
  }

  // Verify ownership.
  const { data: project, error: pErr } = await db
    .from('projects')
    .select('owner_id, name')
    .eq('id', projectId)
    .maybeSingle()
  if (pErr || !project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Generate the image.
  try {
    const zai = await ZAI.create()
    const enhancedPrompt = enhancePrompt(prompt, category)

    const response = await zai.images.generations.create({
      prompt: enhancedPrompt,
      size: size as '1024x1024',
    })

    const imageBase64 = response.data?.[0]?.base64
    if (!imageBase64) {
      throw new Error('Image generation returned no data.')
    }

    // Build the file path. Images go in public/generated/.
    const slug = filename?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || `image-${Date.now()}`
    const filePath = `public/generated/${slug}.png`

    // Store as a base64 data URL so it can be used directly in img src.
    const dataUrl = `data:image/png;base64,${imageBase64}`

    // Check if a file at this path already exists (upsert).
    const { data: existing } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', projectId)
      .eq('path', filePath)
      .maybeSingle()

    if (existing) {
      await db
        .from('project_files')
        .update({ content: dataUrl, updated_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('path', filePath)
    } else {
      await db.from('project_files').insert({
        project_id: projectId,
        path: filePath,
        content: dataUrl,
        language: 'png',
        generated: true,
      })
    }

    await audit(
      'image.generate',
      { prompt: enhancedPrompt.slice(0, 200), size, path: filePath, category },
      user.id,
      projectId,
    )

    return NextResponse.json({
      ok: true,
      path: filePath,
      dataUrl,
      size,
      prompt: enhancedPrompt,
      category: category || 'general',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'image_generation_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
