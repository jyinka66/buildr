// GET /api/marketing/accounts/oauth/<platform>/callback
// The platform sends the user back here with ?code=...&state=.... The signed state cookie
// must match, then the code is exchanged and the resulting account(s) are stored with their
// tokens encrypted at rest.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { getSessionUser } from '@/lib/session'
import { defaultDeps, getProvider } from '@/lib/social/providers'
import { callbackUrl } from '@/lib/social/redirect'
import { OAUTH_COOKIE, verifyState } from '@/lib/social/oauth-state'

const DEV_SECRET = 'buildr-dev-secret-change-in-production'

function finish(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/', req.nextUrl.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = NextResponse.redirect(url)
  // The state is single use whatever the outcome.
  res.cookies.set(OAUTH_COOKIE, '', { path: '/api/marketing/accounts/oauth', maxAge: 0 })
  return res
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  const provider = getProvider(platform)
  if (!provider) return NextResponse.json({ error: 'unknown_platform' }, { status: 404 })

  const user = await getSessionUser()
  if (!user) return finish(req, { social_error: 'sign_in_required', platform })

  const query = req.nextUrl.searchParams
  if (query.get('error')) return finish(req, { social_error: 'denied', platform })

  const check = verifyState(req.cookies.get(OAUTH_COOKIE)?.value, process.env.NEXTAUTH_SECRET || DEV_SECRET, {
    platform,
    stateParam: query.get('state'),
    userId: user.id,
  })
  if (!check.ok) return finish(req, { social_error: 'invalid_state', platform })

  const code = query.get('code')
  if (!code) return finish(req, { social_error: 'failed', platform })

  try {
    const accounts = await provider.connect(
      process.env,
      { code, redirectUri: callbackUrl(process.env, req.nextUrl.origin, platform), codeVerifier: check.state.verifier || undefined },
      defaultDeps,
    )
    if (accounts.length === 0) return finish(req, { social_error: 'no_accounts', platform })

    const now = new Date().toISOString()
    const rows = accounts.map((a) => ({
      owner_id: user.id,
      platform,
      account_name: a.accountName,
      account_id: a.accountId,
      access_token: encrypt(a.tokens.accessToken),
      refresh_token: a.tokens.refreshToken ? encrypt(a.tokens.refreshToken) : null,
      token_expires: a.tokens.expiresAt ? a.tokens.expiresAt.toISOString() : null,
      is_connected: true,
      metadata: {
        ...(a.handle ? { handle: a.handle } : {}),
        ...(a.metadata ?? {}),
        connectedVia: 'oauth',
      },
      updated_at: now,
    }))
    const { error } = await db.from('social_accounts').upsert(rows, { onConflict: 'owner_id,platform,account_id' })
    if (error) throw new Error(`save_failed: ${error.message}`)
    return finish(req, { social: 'connected', platform, count: String(rows.length) })
  } catch (err) {
    // Provider error text can echo request details, so it stays in the server log only.
    console.error(`[Buildr] ${platform} connect failed:`, err instanceof Error ? err.message : err)
    return finish(req, { social_error: 'failed', platform })
  }
}
