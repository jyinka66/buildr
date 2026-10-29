// /api/operations/heal — 24/7 Operations: AI auto-heal.
// ------------------------------------------------------------------
//   GET  — list the user's HealActions (newest first)
//   POST — trigger a heal run for a project:
//            1. Pull recent MonitoringEvents + a manifest of the project files
//               (paths + sizes) so the model has context.
//            2. Ask ZAI to diagnose root cause + propose a fix.
//            3. Persist a HealAction with diagnosis + fixApplied.
//            4. Emit a notification (info on applied, error on failed).
//
// The route does NOT auto-apply file patches — that's a destructive action
// left to a separate "apply" endpoint. This route produces a diagnosis +
// recommended fix that the user (or an applying worker) can act on.

import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { trackUsage } from '@/lib/billing'
import type { ChatMessage } from '@/lib/llm/router'

interface HealBody {
  projectId?: string
  triggerEvent?: 'manual' | 'monitoring' | 'cron' | 'alert'
  note?: string
}

interface Diagnosis {
  rootCause?: string
  confidence?: number
  severity?: 'low' | 'medium' | 'high' | 'critical'
  evidence?: string[]
  recommendedFix?: {
    summary?: string
    steps?: string[]
    files?: { path: string; action: string; rationale: string }[]
    risks?: string[]
  }
  autoAppliable?: boolean
}

interface HealActionRow {
  id: string
  project_id: string
  trigger_event: string
  diagnosis: string
  fix_applied: string
  status: string
  summary: string
  before_state: string
  after_state: string
  created_at: string
  updated_at: string
}

interface ProjectRow {
  id: string
  name: string
  slug: string
  status: string
  deployment_url: string | null
  preview_url: string | null
  prompt: string
  stack: string
  styling: string
}

interface MonitoringEventRow {
  kind: string
  status: string
  message: string
  status_code: number | null
  response_ms: number | null
  url: string | null
  checked_at: string
}

interface ProjectFileRow {
  path: string
  language: string
  generated: boolean
}

function clampConfidence(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(Math.max(n, 0), 1)
}

function serialize(row: HealActionRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    triggerEvent: row.trigger_event,
    diagnosis: JSON.parse(row.diagnosis || '{}') as Record<string, unknown>,
    fixApplied: JSON.parse(row.fix_applied || '{}') as Record<string, unknown>,
    status: row.status,
    summary: row.summary,
    beforeState: JSON.parse(row.before_state || '{}') as Record<string, unknown>,
    afterState: JSON.parse(row.after_state || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------------------------------------------------------------------------
// GET — list heal actions.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') || undefined
  const limitRaw = Number(searchParams.get('limit') || '50')
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  let query: any = db.from('heal_actions').select('*').eq('owner_id', user.id)
  if (projectId) query = query.eq('project_id', projectId)

  const { data: rows, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ actions: ((rows as HealActionRow[] | null) ?? []).map(serialize) })
}

// ---------------------------------------------------------------------------
// POST — trigger a heal run.
// ---------------------------------------------------------------------------

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

  const body = (await req.json().catch(() => ({}))) as HealBody
  const projectId = body.projectId?.trim()
  const triggerEvent = ['manual', 'monitoring', 'cron', 'alert'].includes(body.triggerEvent || '')
    ? body.triggerEvent!
    : 'manual'

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  }

  const { data: projectRow, error: projectError } = await db
    .from('projects')
    .select('id, name, slug, status, deployment_url, preview_url, prompt, stack, styling')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .maybeSingle()

  if (projectError || !projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
  }
  const project = projectRow as ProjectRow

  // Gather recent monitoring events + a file manifest as before-state.
  const [eventsRes, filesRes] = await Promise.all([
    db.from('monitoring_events')
      .select('kind, status, message, status_code, response_ms, url, checked_at')
      .eq('owner_id', user.id)
      .eq('project_id', projectId)
      .order('checked_at', { ascending: false })
      .limit(20),
    db.from('project_files')
      .select('path, language, generated')
      .eq('project_id', projectId)
      .order('path', { ascending: true }),
  ])

  const recentEvents = (eventsRes.data as MonitoringEventRow[] | null) ?? []
  const files = (filesRes.data as ProjectFileRow[] | null) ?? []

  const beforeState = {
    projectStatus: project.status,
    deploymentUrl: project.deployment_url,
    previewUrl: project.preview_url,
    recentEvents: recentEvents.map((e) => ({
      kind: e.kind,
      status: e.status,
      message: e.message,
      statusCode: e.status_code,
      responseMs: e.response_ms,
      url: e.url,
      checkedAt: e.checked_at,
    })),
    fileCount: files.length,
    fileManifest: files.slice(0, 200).map((f) => ({ path: f.path, language: f.language, generated: f.generated })),
  }

  // Create the HealAction row immediately (status='analyzing').
  const { data: action, error: actionError } = await db
    .from('heal_actions')
    .insert({
      owner_id: user.id,
      project_id: project.id,
      trigger_event: triggerEvent,
      diagnosis: '{}',
      fix_applied: '{}',
      status: 'analyzing',
      before_state: JSON.stringify(beforeState),
      after_state: '{}',
      summary: '',
    })
    .select('*')
    .single()

  if (actionError || !action) {
    return NextResponse.json({ error: actionError?.message || 'heal_create_failed' }, { status: 500 })
  }

  // Run the ZAI diagnosis.
  let diagnosis: Diagnosis = {}
  let parseError: string | null = null

  try {
    const zai = await ZAI.create()

    const eventsBlock = recentEvents.length
      ? recentEvents
          .map((e, i) => `${i + 1}. [${e.kind}/${e.status}] ${e.message}${e.status_code ? ` (HTTP ${e.status_code})` : ''}${e.url ? ` — ${e.url}` : ''}`)
          .join('\n')
      : '(no recent monitoring events)'

    const filesBlock = files.length
      ? files.slice(0, 80).map((f) => `- ${f.path} [${f.language}]`).join('\n')
      : '(no project files)'

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You are a senior site reliability engineer and code reviewer.',
          'Diagnose the root cause of the issues reported in monitoring events for a deployed project.',
          'You also have the project file manifest as context.',
          '',
          'Return ONLY a JSON object with this exact shape:',
          '{',
          '  "rootCause": string — a 1-3 sentence explanation of the likely root cause',
          '  "confidence": number — 0.0 to 1.0',
          '  "severity": "low" | "medium" | "high" | "critical",',
          '  "evidence": [string] — bullet points supporting your diagnosis (reference events/files)',
          '  "recommendedFix": {',
          '    "summary": string — what to do in 1-2 sentences',
          '    "steps": [string] — ordered concrete steps (each step ≤ 1 sentence)',
          '    "files": [{ "path": string, "action": "edit"|"create"|"delete", "rationale": string }],',
          '    "risks": [string]',
          '  },',
          '  "autoAppliable": boolean — true if a fix can be auto-applied without human review',
          '}',
          '',
          'Rules:',
          '- Be specific. Reference file paths or event details when relevant.',
          '- If evidence is insufficient, set confidence < 0.5 and explain what you need.',
          '- Do not invent events or files — use only what is provided.',
          '- Return ONLY the JSON object. No markdown fences.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Project: ${project.name} (stack: ${project.stack}, status: ${project.status})`,
          `Deployment URL: ${project.deployment_url || '(none)'}`,
          `Preview URL: ${project.preview_url || '(none)'}`,
          body.note ? `Operator note: ${body.note}` : '',
          '',
          'Recent monitoring events:',
          eventsBlock,
          '',
          'Project file manifest (truncated):',
          filesBlock,
          '',
          'Diagnose the root cause and recommend a fix as JSON.',
        ].filter(Boolean).join('\n'),
      },
    ]

    const completion = await zai.chat.completions.create({
      messages: messages.map((m) =>
        m.role === 'system'
          ? { role: 'assistant' as const, content: m.content }
          : { role: 'user' as const, content: m.content },
      ),
      thinking: { type: 'disabled' },
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart !== -1 && jsonEnd !== -1) {
      diagnosis = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Diagnosis
    } else {
      parseError = 'no_json_in_response'
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'diagnosis_failed'
  }

  const confidence = clampConfidence(diagnosis.confidence)
  const severity = ['low', 'medium', 'high', 'critical'].includes(diagnosis.severity || '')
    ? diagnosis.severity!
    : 'medium'
  const autoAppliable = diagnosis.autoAppliable === true
  const rootCause = typeof diagnosis.rootCause === 'string' ? diagnosis.rootCause : ''
  const summary = [
    rootCause || 'Root cause could not be determined.',
    diagnosis.recommendedFix?.summary ? ` Fix: ${diagnosis.recommendedFix.summary}` : '',
    parseError ? ` (parse error: ${parseError})` : '',
  ].join('')

  const diagnosisPayload = {
    rootCause,
    confidence,
    severity,
    evidence: Array.isArray(diagnosis.evidence) ? diagnosis.evidence.map(String).filter(Boolean) : [],
    recommendedFix: diagnosis.recommendedFix || null,
    autoAppliable,
    parseError,
  }

  const fixPayload = {
    applied: false,
    proposedFix: diagnosis.recommendedFix || null,
  }

  const { data: updated, error: updateError } = await db
    .from('heal_actions')
    .update({
      status: parseError ? 'failed' : 'applied',
      diagnosis: JSON.stringify(diagnosisPayload),
      fix_applied: JSON.stringify(fixPayload),
      after_state: JSON.stringify({ diagnosisComplete: true, severity, autoAppliable }),
      summary,
    })
    .eq('id', action.id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message || 'heal_update_failed' }, { status: 500 })
  }

  // Notification.
  try {
    await db.from('notifications').insert({
      owner_id: user.id,
      source: 'heal',
      severity: severity === 'critical' ? 'error' : severity === 'high' ? 'warning' : 'info',
      title: `Heal action ${parseError ? 'failed' : 'completed'}: ${project.name}`,
      message: summary.slice(0, 280),
      link_type: 'project',
      link_id: project.id,
      metadata: JSON.stringify({ healActionId: action.id, severity, autoAppliable }),
    })
  } catch {
    /* non-fatal */
  }

  await trackUsage(user.id, 'llm_tokens', 1, { via: 'heal', healActionId: action.id, projectId: project.id })

  return NextResponse.json({
    ok: !parseError,
    action: serialize(updated as HealActionRow),
    message: parseError
      ? 'Heal diagnosis failed to parse — see action.summary.'
      : `Diagnosis complete (severity: ${severity}, confidence: ${confidence ?? 'n/a'}).`,
  })
}
