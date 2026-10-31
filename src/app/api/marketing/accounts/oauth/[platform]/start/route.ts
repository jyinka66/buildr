// GET /api/marketing/accounts/oauth/<platform>/start
// Begins the real OAuth connect flow for a social platform: stores a signed state cookie and
// redirects the browser to the platform's consent screen.

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { getProvider } from '@/lib/social/providers'
import { callbackUrl } from '@/lib/social/redirect'
import { createState, encodeState, newPkce, OAUTH_COOKIE, OAUTH_TTL_SECONDS } from '@/lib/social/oauth-state'

const DEV_SECRET = 'buildr-dev-secret-change-in-production'

function back(req: NextRequest, error: string, platform?: string) {
  const url = new URL('/', req.nextUrl.origin)
  url.searchParams.set('social_error', error)
  if (platform) url.searchParams.set('platform', platform)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  const provider = getProvider(platform)
  if (!provider) return NextResponse.json({ error: 'unknown_platform' }, { status: 404 })

  const user = await getSessionUser()
  if (!user) return back(req, 'sign_in_required', platform)
  if (!provider.configured(process.env)) return back(req, 'not_configured', platform)

  const pkce = provider.usesPkce ? newPkce() : null
  const state = createState({ platform, userId: user.id, verifier: pkce?.verifier })
  const secret = process.env.NEXTAUTH_SECRET || DEV_SECRET
  const url = provider.authorizeUrl(process.env, {
    state: state.nonce,
    redirectUri: callbackUrl(process.env, req.nextUrl.origin, platform),
    codeChallenge: pkce?.challenge,
  })

  const res = NextResponse.redirect(url)
  res.cookies.set(OAUTH_COOKIE, encodeState(state, secret), {
    httpOnly: true,
    sameSite: 'lax', // the platform redirects back with a top-level GET, which lax allows
    secure: process.env.NODE_ENV === 'production',
    path: '/api/marketing/accounts/oauth',
    maxAge: OAUTH_TTL_SECONDS,
  })
  return res
}
