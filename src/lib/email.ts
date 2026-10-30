// Email service — uses Resend for transactional email. In development only,
// email content may be logged for local testing. Production fails closed.

interface SendEmailInput {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, error: 'RESEND_API_KEY is not configured' }
    }
    // Local-only fallback: allow developers to inspect the verification link.
    console.log(`\n📧 [EMAIL] To: ${to}\n   Subject: ${subject}\n   ${html.replace(/<[^>]+/g, '').slice(0, 500)}\n`)
    return { ok: true }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Buildr <noreply@buildr.dev>',
        to: [to],
        subject,
        html,
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      return { ok: false, error: `Resend error ${res.status}: ${txt}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'email_failed' }
  }
}

// Escape HTML to prevent injection in email templates.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Validate URL to prevent href injection.
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#'
    return url
  } catch {
    return '#'
  }
}

export function emailVerificationHtml(name: string, verifyUrl: string): string {
  const safeName = escapeHtml(name || 'there')
  const safeLink = safeUrl(verifyUrl)
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
      <h1 style="color: #059669;">Verify your email</h1>
      <p>Hi ${safeName},</p>
      <p>Welcome to Buildr! Click the button below to verify your email address:</p>
      <a href="${safeLink}" style="display: inline-block; background: #059669; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; margin: 1rem 0;">
        Verify email
      </a>
      <p style="color: #6b7280; font-size: 0.875rem;">
        Or paste this link into your browser:<br>
        <a href="${safeLink}">${escapeHtml(safeLink)}</a>
      </p>
      <p style="color: #6b7280; font-size: 0.75rem;">If you didn't create an account, you can safely ignore this email.</p>
    </div>
  `
}

export function passwordResetHtml(name: string, resetUrl: string): string {
  const safeName = escapeHtml(name || 'there')
  const safeLink = safeUrl(resetUrl)
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem;">
      <h1 style="color: #059669;">Reset your password</h1>
      <p>Hi ${safeName},</p>
      <p>We received a request to reset your Buildr password. Click the button below to choose a new one:</p>
      <a href="${safeLink}" style="display: inline-block; background: #059669; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; margin: 1rem 0;">
        Reset password
      </a>
      <p style="color: #6b7280; font-size: 0.875rem;">
        Or paste this link into your browser:<br>
        <a href="${safeLink}">${escapeHtml(safeLink)}</a>
      </p>
      <p style="color: #6b7280; font-size: 0.75rem;">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
    </div>
  `
}
