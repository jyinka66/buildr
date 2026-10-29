// POST /api/projects/[id]/email-template — generates a transactional email
// HTML template using the LLM. The user specifies the email type (welcome,
// password reset, order confirmation, notification, etc.) and a description.
// The LLM generates a responsive HTML email template that works with Resend,
// SendGrid, or any transactional email provider.
//
// The generated template is saved as:
//   src/emails/{type}.html — the HTML template
//   src/lib/email-templates.ts — a helper that exports the templates as
//   functions (so they can be imported and used with the Resend integration)
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { guessLanguage } from '@/lib/llm/code-generator'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface EmailTemplateBody {
  type: 'welcome' | 'password-reset' | 'order-confirmation' | 'notification' | 'newsletter' | 'custom'
  description?: string
  providerKey?: string | null
}

const TEMPLATE_PROMPTS: Record<string, string> = {
  welcome: 'A welcome email for a new user who just signed up. Include a call-to-action button to get started, a brief product description, and support contact info.',
  'password-reset': 'A password reset email with a reset link button. Include clear instructions and a note that the link expires in 1 hour.',
  'order-confirmation': 'An order confirmation email showing the order number, items, total, and shipping address. Include a track-order button.',
  notification: 'A notification email about a new activity (e.g. new message, new follower, mention). Include a link to view the activity.',
  newsletter: 'A newsletter email with a featured article, a secondary story, and a unsubscribe link. Professional and clean.',
  custom: 'A custom transactional email. See the user description for details.',
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
  const rl = rateLimit(`email-template:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, name')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as EmailTemplateBody
  const type = body.type || 'welcome'
  const description = body.description || TEMPLATE_PROMPTS[type] || TEMPLATE_PROMPTS.welcome

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an expert email template designer for transactional emails.',
        'Generate a responsive HTML email template that works across all email clients (Gmail, Outlook, Apple Mail).',
        'Use inline CSS (email clients strip <style> tags). Use table-based layout for maximum compatibility.',
        'The email should be 600px wide, mobile-responsive, and use the project\'s emerald accent color (#059669).',
        'Include a header with the project name, a body with the content, and a footer with unsubscribe + contact info.',
        '',
        'Return ONLY the HTML. No explanation, no markdown fences.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Email type: ${type}`,
        `Description: ${description}`,
        '',
        'Generate the HTML email template now.',
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.3,
      maxTokens: 4000,
    }, (body.providerKey as never) ?? null)

    // Extract HTML from the response (may be wrapped in fences).
    let html = result.content
    const fenceMatch = html.match(/```(?:html)?\s*([\s\S]*?)```/i)
    if (fenceMatch) {
      html = fenceMatch[1].trim()
    }
    // Ensure it starts with <!doctype or <html
    const htmlStart = html.indexOf('<!doctype') !== -1 ? html.indexOf('<!doctype') : html.indexOf('<html')
    if (htmlStart > 0) html = html.slice(htmlStart)

    const templatePath = `src/emails/${type}.html`
    const helperPath = `src/lib/email-templates.ts`

    // Save the HTML template.
    const { data: existingTemplate } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', id)
      .eq('path', templatePath)
      .maybeSingle()

    if (existingTemplate) {
      await db
        .from('project_files')
        .update({ content: html, updated_at: new Date().toISOString() })
        .eq('project_id', id)
        .eq('path', templatePath)
    } else {
      await db.from('project_files').insert({
        project_id: id,
        path: templatePath,
        content: html,
        language: 'html',
        generated: true,
      })
    }

    // Generate + save the helper module that exports templates as functions.
    const helperContent = `// Email templates — generated by Buildr.
// Use with the Resend integration (src/lib/email.ts) to send transactional emails.
//
// Example usage:
//   import { renderWelcomeEmail } from "@/lib/email-templates";
//   import { sendEmail } from "@/lib/email";
//   await sendEmail({ to: user.email, subject: "Welcome!", html: renderWelcomeEmail({ name: user.name }) });

interface WelcomeEmailProps {
  name: string;
  actionUrl?: string;
}

export function render${type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, '')}Email(props: Record<string, unknown>): string {
  // The template is a static HTML file — for dynamic content, replace
  // placeholder tokens in the HTML before sending.
  // In production, use a template engine like React Email or MJML.
  return ${JSON.stringify(html)};
}
`
    const { data: existingHelper } = await db
      .from('project_files')
      .select('id')
      .eq('project_id', id)
      .eq('path', helperPath)
      .maybeSingle()

    if (existingHelper) {
      await db
        .from('project_files')
        .update({ content: helperContent, updated_at: new Date().toISOString() })
        .eq('project_id', id)
        .eq('path', helperPath)
    } else {
      await db.from('project_files').insert({
        project_id: id,
        path: helperPath,
        content: helperContent,
        language: 'ts',
        generated: true,
      })
    }

    await audit('email.template_generate', { type, path: templatePath }, user.id, id)

    return NextResponse.json({
      ok: true,
      templatePath,
      helperPath,
      html,
      type,
      provider: { name: result.provider.name, model: result.provider.model },
      tokens: result.tokens,
      durationMs: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'template_generation_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
