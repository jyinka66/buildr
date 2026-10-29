// Brand logos for integrations, LLM providers, and platforms.
// All icons are inline SVG (no external dependencies, no image requests).
// Each icon accepts a className for sizing.

import type { SVGProps, ReactElement } from 'react'

type IconProps = SVGProps<SVGSVGElement>

// ── Payment providers ────────────────────────────────────────────

export function StripeIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.479 9.883c-1.626-.604-2.512-1.067-2.512-1.802 0-.622.511-.977 1.423-.977 1.667 0 3.379.642 4.558 1.22l.667-4.111c-.933-.444-2.841-1.244-5.245-1.244-1.782 0-3.268.444-4.29 1.291-1.067.885-1.624 2.18-1.624 3.764 0 2.842 1.733 4.044 4.824 5.134 1.927.682 2.572 1.169 2.572 1.927 0 .733-.622 1.155-1.756 1.155-1.4 0-3.7-.682-5.202-1.62l-.667 4.2c1.289.733 3.689 1.466 6.156 1.466 3.022 0 5.134-1.466 5.134-4.222 0-2.978-1.802-4.156-4.734-5.178z" fill="#635BFF"/>
    </svg>
  )
}

export function PaystackIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4h12v3H6V4zm0 5h12v3H6V9zm0 5h8v3H6v-3zm0 5h8v3H6v-3z" fill="#0BA4E0"/>
    </svg>
  )
}

export function RazorpayIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L7 14h4l-2 8 10-14h-4l2-6H12z" fill="#3395FF"/>
    </svg>
  )
}

// ── Auth providers ───────────────────────────────────────────────

export function NextAuthIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.236L18.764 8 12 11.764 5.236 8 12 4.236zM5 9.618l6 3.382v7.764l-6-3.382V9.618zm14 0v7.764l-6 3.382v-7.764l6-3.382z" fill="#1A1A1A"/>
    </svg>
  )
}

export function ClerkIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 4h12v16H6V4zm2 2v3h8V6H8zm0 5v2h8v-2H8zm0 4v3h6v-3H8z" fill="#6C47FF"/>
    </svg>
  )
}

// ── Database ─────────────────────────────────────────────────────

export function SupabaseIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.5 1.5L4 14h7l-1.5 8.5L20 10h-7l.5-8.5z" fill="#3ECF8E"/>
    </svg>
  )
}

// ── Communication ───────────────────────────────────────────────

export function ResendIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6h18v12H3V6zm2 1v.5L12 13l7-5.5V7H5zm14 1.5L12 14l-7-5.5V18h14V8.5z" fill="#000"/>
    </svg>
  )
}

export function SendGridIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" fill="#1A82E2"/>
    </svg>
  )
}

export function TwilioIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#F22F46"/>
      <circle cx="8.5" cy="8.5" r="2" fill="#fff"/>
      <circle cx="15.5" cy="8.5" r="2" fill="#fff"/>
      <circle cx="8.5" cy="15.5" r="2" fill="#fff"/>
      <circle cx="15.5" cy="15.5" r="2" fill="#fff"/>
    </svg>
  )
}

// ── Fintech & Identity ──────────────────────────────────────────

export function PlaidIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8h18v2H3V8zm0 3h18v2H3v-2zm0 3h18v2H3v-2z" fill="#000"/>
      <path d="M8 4h2v16H8V4zm6 0h2v16h-2V4z" fill="#000"/>
    </svg>
  )
}

export function OnfidoIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="8" r="4" fill="#3CC68A"/>
      <path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8H4z" fill="#3CC68A"/>
    </svg>
  )
}

// ── LLM Providers ───────────────────────────────────────────────

export function ZaiIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 20h20L12 2zm0 4.5L18.5 18h-13L12 6.5z" fill="#059669"/>
      <circle cx="12" cy="14" r="2" fill="#059669"/>
    </svg>
  )
}

export function OpenAIIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.408 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z" fill="#10A37F"/>
    </svg>
  )
}

export function AnthropicIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.2 4L3 20h3l.7-3h4.6l.7 3h3L11.4 4H7.2zm.8 10l1.7-6 1.7 6H8z" fill="#D97757"/>
      <path d="M17 4v16h-2V4h2z" fill="#D97757"/>
    </svg>
  )
}

export function GoogleAIIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" fill="url(#google-ai-grad)"/>
      <defs>
        <linearGradient id="google-ai-grad" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0%" stopColor="#4285F4"/>
          <stop offset="50%" stopColor="#9B72CB"/>
          <stop offset="100%" stopColor="#D96570"/>
        </linearGradient>
      </defs>
    </svg>
  )
}

export function DeepSeekIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5l-3-3 1.4-1.4L11 14.7l4.6-4.6 1.4 1.4-6 5z" fill="#4D6BFE"/>
    </svg>
  )
}

export function OllamaIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3C8 3 5 6 5 10v4c0 3 2 5 5 5h4c3 0 5-2 5-5v-4c0-4-3-7-7-7zm-3 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm6 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z" fill="#000"/>
    </svg>
  )
}

// ── Platform icons ─────────────────────────────────────────────

export function VercelIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4l8 14H4l8-14z" fill="#000"/>
    </svg>
  )
}

export function NetlifyIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 11v9h9l9-9V2h-9zm-2 14v-4h4v4h-4z" fill="#00C7B7"/>
    </svg>
  )
}

export function GithubBrandIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.37 1.23-3.21-.12-.3-.54-1.515.12-3.15 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.635.24 2.85.12 3.15.765.84 1.23 1.905 1.23 3.21 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

// ── Lookup maps ─────────────────────────────────────────────────

export const INTEGRATION_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  stripe: StripeIcon,
  paystack: PaystackIcon,
  razorpay: RazorpayIcon,
  nextauth: NextAuthIcon,
  clerk: ClerkIcon,
  supabase: SupabaseIcon,
  resend: ResendIcon,
  sendgrid: SendGridIcon,
  twilio: TwilioIcon,
  plaid: PlaidIcon,
  onfido: OnfidoIcon,
}

export const PROVIDER_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  zai: ZaiIcon,
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  google: GoogleAIIcon,
  deepseek: DeepSeekIcon,
  ollama: OllamaIcon,
}

export const PLATFORM_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  vercel: VercelIcon,
  netlify: NetlifyIcon,
  github: GithubBrandIcon,
  google: GoogleAIIcon, // reuse for OAuth
}
