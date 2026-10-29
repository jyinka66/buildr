// Security headers middleware.
// ------------------------------------------------------------------
// Applies standard security headers to all responses.
//
// NOTE: X-Frame-Options is NOT set because the preview panel embeds
// the app in an iframe from a different subdomain (*.space-z.ai).
// Instead, we use Content-Security-Policy: frame-ancestors which is
// more flexible and allows the preview panel's origin.
//
// In production, restrict frame-ancestors to your known preview origins.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const isProduction = process.env.NODE_ENV === 'production'

export function proxy(_req: NextRequest) {
  const res = NextResponse.next()
  const headers = res.headers

  headers.set('x-content-type-options', 'nosniff')
  // Do NOT set X-Frame-Options: SAMEORIGIN — it blocks the preview panel
  // which embeds the app from a different subdomain.
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('x-dns-prefetch-control', 'off')
  headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  )

  // Allow the app to be embedded in iframes:
  // - Dev: any origin (for the preview panel)
  // - Production: restrict to known origins via ALLOWED_FRAME_ANCESTORS env var
  if (isProduction) {
    const configured = (process.env.ALLOWED_FRAME_ANCESTORS || "'self'").trim()
    const ancestors = configured.split(/\s+/)
    const validAncestor = (value: string) => value === "'self'" || value === "'none'" || /^https:\/\/(?:\*\.)?[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(value)
    const allowed = ancestors.length > 0 && ancestors.every(validAncestor) ? ancestors.join(' ') : "'self'"
    headers.set('content-security-policy', `frame-ancestors ${allowed}`)
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload')
  } else {
    // Dev: allow any origin to embed (preview panel uses different subdomains)
    headers.set('content-security-policy', "frame-ancestors *")
  }

  return res
}

export const config = {
  // Apply to all routes except static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.svg|logo.svg|robots.txt).*)',
  ],
}
