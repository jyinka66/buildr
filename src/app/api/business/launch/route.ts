// POST /api/business/launch — the AI Co-Founder orchestrator.
// ------------------------------------------------------------------
// Takes a business idea and generates a complete company:
//   1. Business Plan: name, mission, vision, value prop, target audience,
//      competitors, business model, brand colors, pricing plans.
//   2. Website: a complete multi-page Next.js project (home, about, pricing,
//      contact) with the brand plan baked in.
//   3. Legal Docs: terms, privacy, cookies, refund policy.
//   4. Logo: AI-generated via image generation.
//
// This is the "60-second company" — from idea to deployed website.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { slugify } from '@/lib/helpers'
import { guessLanguage } from '@/lib/llm/code-generator'
import { buildScaffold } from '@/lib/generator/templates'
import { checkLimit, trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

async function uniqueBusinessSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data: existing } = await db.from('businesses').select('id').eq('slug', candidate).maybeSingle()
    if (!existing) return candidate
    candidate = `${base}-${i++}`
  }
}

async function uniqueProjectSlug(base: string): Promise<string> {
  let candidate = base
  let i = 1
  for (;;) {
    const { data: existing } = await db.from('projects').select('id').eq('slug', candidate).maybeSingle()
    if (!existing) return candidate
    candidate = `${base}-${i++}`
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

  const body = await req.json()
  const idea = body.idea?.trim()

  if (!idea || idea.length < 10) {
    return NextResponse.json(
      { error: 'Please describe your business idea in at least a sentence.' },
      { status: 400 },
    )
  }

  // Billing: check business limit.
  const limit = await checkLimit(user.id, 'businesses')
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', message: `Business launch limit reached (${limit.limit}). Upgrade your plan.` },
      { status: 402 },
    )
  }

  const zai = await ZAI.create()

  // ── Step 1: Generate the business plan via LLM ──────────────────
  const planMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert business strategist and startup advisor.',
        'Given a business idea, generate a complete business plan as JSON.',
        '',
        'Return ONLY a JSON object with this structure:',
        '{',
        '  "companyName": string — a catchy, brandable company name',
        '  "tagline": string — a short tagline (max 10 words)',
        '  "mission": string — the mission statement (1-2 sentences)',
        '  "vision": string — the vision statement (1-2 sentences)',
        '  "valueProposition": string — what makes this unique (2-3 sentences)',
        '  "targetAudience": string — who this is for (2-3 sentences)',
        '  "competitors": [{ "name": string, "strength": string, "weakness": string }]',
        '  "businessModel": {',
        '    "revenueStreams": [string],',
        '    "pricingStrategy": string,',
        '    "keyPartners": [string],',
        '    "channels": [string]',
        '  },',
        '  "brandColors": {',
        '    "primary": "#hex",',
        '    "secondary": "#hex",',
        '    "background": "#hex",',
        '    "text": "#hex"',
        '  },',
        '  "brandFonts": {',
        '    "heading": string,',
        '    "body": string',
        '  },',
        '  "features": [string] — 5-8 key features',
        '  "pricingPlans": [{ "name": string, "price": number, "period": string, "features": [string] }]',
        '}',
        '',
        'Rules:',
        '- All values must be real and specific to the business idea.',
        '- The company name must be brandable (not generic like "MyApp").',
        '- Colors should reflect the brand personality (NOT generic blue/indigo).',
        '- Pricing plans should be realistic for the industry (3 tiers).',
        '- Return ONLY the JSON object. No markdown, no explanation.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Business idea: ${idea}\n\nGenerate the complete business plan as JSON.`,
    },
  ]

  const planCompletion = await zai.chat.completions.create({
    messages: planMessages.map((m) =>
      m.role === 'system'
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: m.content },
    ),
    thinking: { type: 'disabled' },
  })

  let plan: Record<string, unknown>
  try {
    const raw = planCompletion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('No JSON found in LLM response')
    }
    plan = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate a business plan. Please try again.' },
      { status: 500 },
    )
  }

  const companyName = String(plan.companyName || 'Buildr Startup')
  const companySlug = await uniqueBusinessSlug(slugify(companyName))

  // ── Step 2: Create the business record ──────────────────────────
  const { data: business } = await db.from('businesses').insert({
    owner_id: user.id,
    name: companyName,
    slug: companySlug,
    description: String(plan.tagline || idea.slice(0, 200)),
    idea,
    mission: String(plan.mission || ''),
    vision: String(plan.vision || ''),
    value_prop: String(plan.valueProposition || ''),
    target_audience: String(plan.targetAudience || ''),
    competitors: JSON.stringify(plan.competitors || []),
    business_model: JSON.stringify(plan.businessModel || {}),
    brand_colors: JSON.stringify(plan.brandColors || {}),
    brand_fonts: JSON.stringify(plan.brandFonts || {}),
    pricing_plans: JSON.stringify(plan.pricingPlans || []),
    status: 'generating',
  }).select('*').single()

  // ── Step 3: Create a Buildr project for the website ─────────────
  const { data: project } = await db.from('projects').insert({
    name: companyName,
    slug: await uniqueProjectSlug(slugify(companyName)),
    description: String(plan.tagline || ''),
    prompt: `Business website for ${companyName}: ${idea}`,
    stack: 'nextjs',
    styling: 'tailwind',
    integrations: JSON.stringify(['stripe', 'nextauth', 'resend']),
    db_config: JSON.stringify({ engine: 'sqlite', orm: 'prisma' }),
    status: 'draft',
    owner_id: user.id,
  }).select('*').single()

  // Link project to business
  await db.from('businesses').update({ project_id: project!.id }).eq('id', business!.id)

  // ── Step 4: Generate the website files via LLM ──────────────────
  const brandColors = (plan.brandColors as Record<string, string>) || {}
  const features = (plan.features as string[]) || []
  const pricingPlans = (plan.pricingPlans as Record<string, unknown>[]) || []

  const websiteMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are Buildr, an enterprise-grade code generator.',
        'Generate a complete multi-page Next.js website for a business.',
        'Return ONLY a JSON array of files.',
        '',
        `Company: ${companyName}`,
        `Tagline: ${plan.tagline || ''}`,
        `Mission: ${plan.mission || ''}`,
        `Colors: ${JSON.stringify(brandColors)}`,
        `Features: ${JSON.stringify(features)}`,
        `Pricing: ${JSON.stringify(pricingPlans)}`,
        '',
        'Rules:',
        '- Generate src/app/page.tsx (home), src/app/about/page.tsx, src/app/pricing/page.tsx, src/app/contact/page.tsx',
        '- Each page must be complete, real, and styled with Tailwind',
        '- Use the brand colors (primary, secondary, background, text) inline',
        '- Home page: hero section, features grid, CTA, social proof',
        '- About page: mission, vision, story',
        '- Pricing page: pricing cards based on the pricing plans',
        '- Contact page: contact form (name, email, message)',
        '- Also generate src/app/layout.tsx with proper metadata',
        '- Also generate src/app/globals.css with the brand colors as CSS variables',
        '- Real, runnable code. No placeholders.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Generate the complete website for ${companyName}. Return ONLY the JSON array of files.`,
    },
  ]

  const websiteCompletion = await zai.chat.completions.create({
    messages: websiteMessages.map((m) =>
      m.role === 'system'
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: m.content },
    ),
    thinking: { type: 'disabled' },
  })

  // Parse the website files
  let websiteFiles: { path: string; content: string; language: string }[] = []
  try {
    const raw = websiteCompletion.choices[0]?.message?.content ?? ''
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fence ? fence[1] : raw
    const start = candidate.indexOf('[')
    const end = candidate.lastIndexOf(']')
    if (start !== -1 && end !== -1) {
      const arr = JSON.parse(candidate.slice(start, end + 1))
      if (Array.isArray(arr)) {
        websiteFiles = arr
          .filter((f: Record<string, unknown>) => typeof f === 'object' && f !== null)
          .map((f: Record<string, unknown>) => ({
            path: String(f.path ?? ''),
            content: String(f.content ?? ''),
            language: String(f.language ?? guessLanguage(String(f.path ?? ''))),
          }))
          .filter((f: { path: string; content: string }) => f.path && f.content)
      }
    }
  } catch {
    websiteFiles = []
  }

  // Also generate the scaffold (package.json, configs, etc.)
  const scaffold = buildScaffold({
    name: companyName,
    stack: 'nextjs',
    styling: 'tailwind',
    dbConfig: { engine: 'sqlite', orm: 'prisma' },
    prompt: idea,
    integrations: ['stripe', 'nextauth', 'resend'],
  })

  // Merge scaffold + LLM files (LLM wins on path conflicts)
  const merged = new Map<string, { path: string; content: string; language: string }>()
  for (const f of scaffold) merged.set(f.path, f)
  for (const f of websiteFiles) merged.set(f.path, f)

  const allFiles = Array.from(merged.values())

  // ── Step 5: Save all files to the project ────────────────────────
  if (allFiles.length > 0) {
    await db.from('project_files').insert(allFiles.map((f) => ({
      project_id: project!.id,
      path: f.path,
      content: f.content,
      language: f.language,
      generated: true,
    })))
  }

  // ── Step 6: Generate legal documents ─────────────────────────────
  const legalMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a legal document generator. Generate legal documents for a business website.',
        'Return ONLY a JSON array of files.',
        '',
        'Generate:',
        '1. src/app/terms/page.tsx — Terms of Service',
        '2. src/app/privacy/page.tsx — Privacy Policy',
        '3. src/app/cookies/page.tsx — Cookie Policy',
        '4. src/app/refund/page.tsx — Refund Policy',
        '',
        'Each page must be a complete Next.js page with styled legal text.',
        `Use the company name: ${companyName}.`,
        'Real legal language. No placeholders.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Company: ${companyName}\nDescription: ${idea}\n\nGenerate legal documents as a JSON array of files.`,
    },
  ]

  const legalCompletion = await zai.chat.completions.create({
    messages: legalMessages.map((m) =>
      m.role === 'system'
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: m.content },
    ),
    thinking: { type: 'disabled' },
  })

  let legalFiles: { path: string; content: string; language: string }[] = []
  try {
    const raw = legalCompletion.choices[0]?.message?.content ?? ''
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fence ? fence[1] : raw
    const start = candidate.indexOf('[')
    const end = candidate.lastIndexOf(']')
    if (start !== -1 && end !== -1) {
      const arr = JSON.parse(candidate.slice(start, end + 1))
      if (Array.isArray(arr)) {
        legalFiles = arr
          .filter((f: Record<string, unknown>) => typeof f === 'object' && f !== null)
          .map((f: Record<string, unknown>) => ({
            path: String(f.path ?? ''),
            content: String(f.content ?? ''),
            language: 'tsx',
          }))
          .filter((f: { path: string; content: string }) => f.path && f.content)
      }
    }
  } catch {
    legalFiles = []
  }

  if (legalFiles.length > 0) {
    await db.from('project_files').insert(legalFiles.map((f) => ({
      project_id: project!.id,
      path: f.path,
      content: f.content,
      language: f.language,
      generated: true,
    })))
  }

  // ── Step 7: Generate a logo via image generation ───────────────
  let logoPath: string | null = null
  try {
    const logoPrompt = `Minimalist logo for ${companyName}, a company that ${idea.slice(0, 100)}. Clean vector style, simple geometric shapes, centered, white background, using colors ${brandColors.primary || '#059669'} and ${brandColors.secondary || '#0d9488'}.`
    const imgResponse = await zai.images.generations.create({
      prompt: logoPrompt,
      size: '1024x1024',
    })
    const logoBase64 = imgResponse.data?.[0]?.base64
    if (logoBase64) {
      logoPath = 'public/generated/logo.png'
      await db.from('project_files').insert({
        project_id: project!.id,
        path: logoPath,
        content: `data:image/png;base64,${logoBase64}`,
        language: 'png',
        generated: true,
      })
    }
  } catch {
    // Logo generation is best-effort
  }

  // ── Step 8: Update business status ──────────────────────────────
  await db.from('businesses').update({ status: 'ready' }).eq('id', business!.id)
  await db.from('projects').update({ status: 'preview-ready' }).eq('id', project!.id)

  // Track usage.
  await trackUsage(user.id, 'businesses', 1, { businessId: business!.id, projectId: project!.id })
  await trackUsage(user.id, 'projects', 1, { projectId: project!.id, via: 'business-launch' })

  return NextResponse.json({
    ok: true,
    business: {
      id: business!.id,
      name: companyName,
      slug: companySlug,
      tagline: plan.tagline,
      mission: plan.mission,
      vision: plan.vision,
      valueProposition: plan.valueProposition,
      targetAudience: plan.targetAudience,
      competitors: plan.competitors,
      businessModel: plan.businessModel,
      brandColors: plan.brandColors,
      brandFonts: plan.brandFonts,
      features: plan.features,
      pricingPlans: plan.pricingPlans,
    },
    projectId: project.id,
    fileCount: allFiles.length + legalFiles.length + (logoPath ? 1 : 0),
    logoPath,
    message: `${companyName} is ready! You have a complete website with ${allFiles.length + legalFiles.length} files, a brand kit, and legal documents. Deploy it with one click.`,
  }, { status: 201 })
}
