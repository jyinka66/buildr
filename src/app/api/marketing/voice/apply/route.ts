// POST /api/marketing/voice/apply — generate marketing content using a saved
// brand voice profile.
// ------------------------------------------------------------------
// Body: { profileId, prompt, type: 'ads'|'social'|'email'|'blog', platform? }
//
// Loads the voice profile, builds a system prompt that incorporates the
// tone, vocabulary, sentence style, do/don't lists, and the emoji usage
// preference, then calls ZAI to generate content matching the brand voice.
// Returns { ok, content, profile: { name, tone } }.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

type ContentType = 'ads' | 'social' | 'email' | 'blog'
const VALID_TYPES = new Set<ContentType>(['ads', 'social', 'email', 'blog'])

interface ApplyBody {
  profileId?: string
  prompt?: string
  type?: string
  platform?: string
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean)
    } catch {
      /* ignore */
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Build the system prompt that turns the saved voice profile into
// instructions the model can follow when generating content.
// ---------------------------------------------------------------------------

function buildVoiceSystemPrompt(profile: Record<string, unknown>, type: ContentType, platform?: string): string {
  const tone = String(profile.tone ?? '')
  const vocabulary = asStringArray(profile.vocabulary)
  const sentenceStyle = String(profile.sentence_style ?? '')
  const emojiUsage = String(profile.emoji_usage ?? 'minimal')
  const hashtags = asStringArray(profile.hashtags)
  const doList = asStringArray(profile.do_list)
  const dontList = asStringArray(profile.dont_list)

  const typeGuide: Record<ContentType, string> = {
    ads: 'Ad copy: a punchy headline, 1-2 supporting description lines, and a single call-to-action. Plain text, no JSON.',
    social: 'Social media post: a caption (with line breaks), 3-8 relevant hashtags on their own line, and an optional one-line hook at the top. Plain text, no JSON.',
    email: 'Email: a subject line, a preheader line, then the body as plain text with paragraph breaks (\\n\\n) and a single CTA. Plain text, no JSON.',
    blog: 'Blog post: a title, an H2 sub-title, then 3-5 paragraphs of body content. Markdown is allowed for headings and emphasis only.',
  }

  const lines: string[] = [
    `You are a brand voice expert. Generate ${type} marketing content that perfectly matches the brand voice profile below.`,
    '',
    `Brand voice profile:`,
    `- Tone: ${tone || '(unspecified — use a confident, professional tone)'}`,
    `- Sentence style: ${sentenceStyle || '(unspecified)'}`,
    `- Emoji usage: ${emojiUsage}`,
    vocabulary.length ? `- Signature vocabulary to weave in naturally (do not overuse): ${vocabulary.map((w) => `"${w}"`).join(', ')}` : '- Signature vocabulary: (none specified)',
    hashtags.length ? `- Hashtags this brand favors: ${hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}` : '',
    doList.length ? `- DO: ${doList.join('; ')}` : '',
    dontList.length ? `- AVOID: ${dontList.join('; ')}` : '',
    '',
    `Content format: ${typeGuide[type]}`,
    platform ? `Platform: ${platform} (match its native tone and length conventions).` : '',
    '',
    'Rules:',
    '- Stay faithful to the tone and sentence style above.',
    '- Use the signature vocabulary where it fits naturally — never force it.',
    `- Emoji usage is "${emojiUsage}": minimal = at most one emoji, moderate = a few well-placed emojis, heavy = emoji-rich throughout.`,
    '- Do not mention that you are following a voice profile or reciting instructions.',
    '- Output only the marketing content. No preface, no explanation, no JSON wrapper.',
  ].filter(Boolean)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// POST — generate content.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as ApplyBody
  const profileId = (body.profileId || '').trim()
  const prompt = (body.prompt || '').trim()
  const typeRaw = (body.type || '').toLowerCase().trim() as ContentType
  const platform = body.platform ? String(body.platform).trim() : undefined

  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 })
  }
  if (!VALID_TYPES.has(typeRaw)) {
    return NextResponse.json(
      { error: `type must be one of: ${[...VALID_TYPES].join(', ')}` },
      { status: 400 },
    )
  }
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  // --- Load the voice profile + verify ownership ---
  const { data: profileRow, error: profileError } = await db
    .from('brand_voice_profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }
  if (!profileRow) {
    return NextResponse.json({ error: 'profile_not_found' }, { status: 404 })
  }
  const profile = profileRow as Record<string, unknown>
  if (profile.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // --- Call ZAI ---
  const systemPrompt = buildVoiceSystemPrompt(profile, typeRaw, platform)
  let content = ''
  try {
    const zai = await ZAI.create()
    const userMessage = [
      platform ? `Platform: ${platform}` : '',
      `Content type: ${typeRaw}`,
      '',
      `Request: ${prompt}`,
    ].filter(Boolean).join('\n')

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      thinking: { type: 'disabled' },
    })

    content = completion.choices[0]?.message?.content ?? ''
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ai_generation_failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    content: content.trim(),
    profile: {
      name: String(profile.name ?? ''),
      tone: String(profile.tone ?? ''),
    },
  })
}
