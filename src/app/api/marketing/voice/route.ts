// GET  /api/marketing/voice          — list brand voice profiles for the user.
// POST /api/marketing/voice          — analyze sample text + create a profile.
// ------------------------------------------------------------------
// POST body: { name, sampleText, projectId? }
//   1. Calls ZAI to analyze the sample text and extract a voice profile.
//   2. Inserts into `brand_voice_profiles` table.
//   3. Returns { ok, profile }.
//
// The z-ai SDK delivers system prompts as `role: 'assistant'` (not 'system')
// per the SDK convention. Tolerant JSON parsing handles responses wrapped in
// markdown code fences or trailing prose.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

// ---------------------------------------------------------------------------
// Voice profile shape returned to the client (camelCase, front-end friendly).
// ---------------------------------------------------------------------------

export interface VoiceProfileView {
  id: string
  name: string
  tone: string
  vocabulary: string[]
  sentenceStyle: string
  emojiUsage: 'minimal' | 'moderate' | 'heavy' | string
  hashtags: string[]
  doList: string[]
  dontList: string[]
  sampleText: string
  isActive: boolean
  projectId: string | null
  createdAt: string
  updatedAt: string
}

// Map a raw DB row (snake_case) → VoiceProfileView (camelCase).
// Tolerant of both string-encoded JSONB (real Supabase sometimes returns
// arrays/objects as strings) and already-parsed objects/arrays.
function toView(row: Record<string, unknown>): VoiceProfileView {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    tone: String(row.tone ?? ''),
    vocabulary: asStringArray(row.vocabulary),
    sentenceStyle: String(row.sentence_style ?? ''),
    emojiUsage: String(row.emoji_usage ?? 'minimal'),
    hashtags: asStringArray(row.hashtags),
    doList: asStringArray(row.do_list),
    dontList: asStringArray(row.dont_list),
    sampleText: String(row.sample_text ?? ''),
    isActive: Boolean(row.is_active ?? false),
    projectId: (row.project_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
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
// System prompt — instructs the model to analyze + return strict JSON.
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM_PROMPT = `You are a brand voice analyst. Analyze the following sample text and extract the brand's voice profile.

Return ONLY a JSON object with these fields:
{
  "tone": "string — e.g. 'professional yet warm', 'playful and energetic'",
  "vocabulary": ["array of signature words/phrases the brand uses"],
  "sentenceStyle": "string — e.g. 'short punchy sentences', 'long flowing paragraphs'",
  "emojiUsage": "minimal | moderate | heavy",
  "hashtags": ["array of hashtags the brand commonly uses"],
  "doList": ["array of things the brand DOES"],
  "dontList": ["array of things the brand AVOIDS"]
}

Return ONLY the JSON. No explanation.`

// Tolerant JSON extractor — pulls the first {...} block from a model response
// that may be wrapped in ```json fences or surrounded by stray prose.
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

interface AnalyzeBody {
  name?: string
  sampleText?: string
  projectId?: string
}

// ---------------------------------------------------------------------------
// GET — list all voice profiles owned by the authenticated user.
// ---------------------------------------------------------------------------

export async function GET() {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const { data, error } = await db
    .from('brand_voice_profiles')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const profiles = (data || []).map((row: Record<string, unknown>) => toView(row))
  return NextResponse.json({ profiles })
}

// ---------------------------------------------------------------------------
// POST — analyze sample text + create a profile.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) return unauthorized()
    throw err
  }

  const body = (await req.json().catch(() => ({}))) as AnalyzeBody
  const name = (body.name || '').trim()
  const sampleText = (body.sampleText || '').trim()
  const projectId = body.projectId ? String(body.projectId) : null

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!sampleText) {
    return NextResponse.json({ error: 'sampleText is required' }, { status: 400 })
  }
  if (sampleText.length < 50) {
    return NextResponse.json(
      { error: 'Please provide at least 50 characters of sample text so the analysis is meaningful.' },
      { status: 400 },
    )
  }

  // --- Call ZAI to analyze the sample text. ---
  let analysis: Record<string, unknown> = {}
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: sampleText },
      ],
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = extractJsonObject(raw)
    if (!parsed) {
      return NextResponse.json(
        { error: 'AI did not return valid JSON. Try again with more sample text.' },
        { status: 502 },
      )
    }
    analysis = parsed
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ai_analysis_failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const tone = String(analysis.tone ?? '')
  const vocabulary = asStringArray(analysis.vocabulary)
  const sentenceStyle = String(analysis.sentenceStyle ?? '')
  const emojiUsage = String(analysis.emojiUsage ?? 'minimal')
  const hashtags = asStringArray(analysis.hashtags)
  const doList = asStringArray(analysis.doList)
  const dontList = asStringArray(analysis.dontList)

  // If this is the user's first profile, default it to active.
  const { count } = await db
    .from('brand_voice_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)
  const isFirst = !count || count === 0

  const { data, error } = await db
    .from('brand_voice_profiles')
    .insert({
      owner_id: user.id,
      project_id: projectId,
      name,
      sample_text: sampleText,
      tone,
      vocabulary,
      sentence_style: sentenceStyle,
      emoji_usage: emojiUsage,
      hashtags,
      do_list: doList,
      dont_list: dontList,
      is_active: isFirst,
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, profile: toView(data as Record<string, unknown>) }, { status: 201 })
}
