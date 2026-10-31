// Social platform adapters: OAuth connect + publish for LinkedIn, X, Facebook Pages,
// Instagram and TikTok.
//
// Every adapter is plain fetch against the platform's HTTP API, with the fetch
// implementation injected, so the request shapes are unit tested without network or
// credentials. Endpoint and parameter names follow each platform's current developer
// documentation (checked October 2026): LinkedIn /v2/ugcPosts, X /2/tweets with OAuth 2.0
// PKCE, Meta Graph v26.0, TikTok Content Posting API v2.
//
// No alias imports here on purpose: this file must run under plain `node --test`.

export type PlatformKey = 'linkedin' | 'x' | 'meta' | 'instagram' | 'tiktok'
export const PLATFORM_KEYS: PlatformKey[] = ['linkedin', 'x', 'meta', 'instagram', 'tiktok']

export interface TokenSet {
  accessToken: string
  refreshToken?: string | null
  /** Absolute expiry, or null when the platform issues non-expiring tokens. */
  expiresAt?: Date | null
}

/** One connectable identity returned after OAuth (a profile, or one Page / IG account). */
export interface RemoteAccount {
  accountId: string
  accountName: string
  handle?: string | null
  /** Token to store for this account. Facebook/Instagram return a per-Page token. */
  tokens: TokenSet
  metadata?: Record<string, unknown>
}

export interface PostInput {
  /** Final text: caption plus hashtags, already joined by the caller. */
  text: string
  mediaUrls: string[]
}

export interface PublishTarget {
  accountId: string
  accessToken: string
  metadata?: Record<string, unknown>
}

export interface PublishResult {
  postId: string
  url?: string | null
}

export interface ProviderDeps {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => Date
}

export const defaultDeps: ProviderDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
}

export interface AuthorizeParams {
  state: string
  redirectUri: string
  codeChallenge?: string
}

export interface SocialProvider {
  key: PlatformKey
  label: string
  /** Whether this app's OAuth credentials are present in the environment. */
  configured(env: Record<string, string | undefined>): boolean
  usesPkce: boolean
  maxTextLength: number
  /** True when media can only be shared as links inside the text (LinkedIn, X). */
  mediaInText: boolean
  authorizeUrl(env: Record<string, string | undefined>, p: AuthorizeParams): string
  /** Exchange the callback code and return every account the user connected. */
  connect(
    env: Record<string, string | undefined>,
    input: { code: string; redirectUri: string; codeVerifier?: string },
    deps: ProviderDeps,
  ): Promise<RemoteAccount[]>
  refresh?(env: Record<string, string | undefined>, refreshToken: string, deps: ProviderDeps): Promise<TokenSet>
  publish(target: PublishTarget, post: PostInput, deps: ProviderDeps, env: Record<string, string | undefined>): Promise<PublishResult>
}

export class SocialApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'SocialApiError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?.*)?$/i
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?.*)?$/i
export const isImageUrl = (url: string) => IMAGE_EXT.test(url)
export const isVideoUrl = (url: string) => VIDEO_EXT.test(url)

function form(values: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== undefined) params.set(k, v)
  return params
}

function expiryFrom(deps: ProviderDeps, seconds: unknown): Date | null {
  const n = Number(seconds)
  return Number.isFinite(n) && n > 0 ? new Date(deps.now().getTime() + n * 1000) : null
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return { raw: text.slice(0, 300) }
  }
}

/** Pick the most useful human message out of the different error shapes platforms use. */
function describeError(body: Record<string, unknown>, fallback: string): string {
  const err = body.error
  if (typeof err === 'string') return String(body.error_description ?? body.error)
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    if (typeof e.code === 'string' && e.code !== 'ok') return `${e.code}${typeof e.message === 'string' ? `: ${e.message}` : ''}`
  }
  if (typeof body.message === 'string') return body.message
  if (typeof body.detail === 'string') return body.detail
  if (typeof body.title === 'string') return body.title
  return fallback
}

async function ok(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = await readJson(res)
  if (!res.ok) throw new SocialApiError(`${what} failed (${res.status}): ${describeError(body, 'no details returned')}`, res.status)
  return body
}

const required = (env: Record<string, string | undefined>, ...names: string[]) => names.every((n) => Boolean(env[n]?.trim()))

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

const linkedin: SocialProvider = {
  key: 'linkedin',
  label: 'LinkedIn',
  usesPkce: false,
  maxTextLength: 3000,
  mediaInText: true,
  configured: (env) => required(env, 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'),
  authorizeUrl(env, { state, redirectUri }) {
    const q = form({
      response_type: 'code',
      client_id: env.LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'openid profile w_member_social',
    })
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`
  },
  async connect(env, { code, redirectUri }, deps) {
    const tokenRes = await deps.fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET }),
    })
    const token = await ok(tokenRes, 'LinkedIn token exchange')
    const accessToken = String(token.access_token ?? '')
    if (!accessToken) throw new SocialApiError('LinkedIn did not return an access token.')
    const meRes = await deps.fetch('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${accessToken}` } })
    const me = await ok(meRes, 'LinkedIn profile lookup')
    if (typeof me.sub !== 'string') throw new SocialApiError('LinkedIn did not return a member id.')
    return [{
      accountId: me.sub,
      accountName: String(me.name ?? 'LinkedIn member'),
      tokens: {
        accessToken,
        refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
        expiresAt: expiryFrom(deps, token.expires_in),
      },
      metadata: { avatarUrl: typeof me.picture === 'string' ? me.picture : undefined },
    }]
  },
  async publish(target, post, deps) {
    const res = await deps.fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.accessToken}`,
        'content-type': 'application/json',
        'x-restli-protocol-version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:person:${target.accountId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: post.text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })
    const body = await readJson(res)
    if (!res.ok) throw new SocialApiError(`LinkedIn post failed (${res.status}): ${describeError(body, 'no details returned')}`, res.status)
    const id = res.headers.get('x-restli-id') ?? (typeof body.id === 'string' ? body.id : '')
    if (!id) throw new SocialApiError('LinkedIn accepted the post but returned no post id.')
    return { postId: id, url: `https://www.linkedin.com/feed/update/${id}/` }
  },
}

// ---------------------------------------------------------------------------
// X
// ---------------------------------------------------------------------------

function xBasic(env: Record<string, string | undefined>): string {
  return `Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64')}`
}

function xTokens(body: Record<string, unknown>, deps: ProviderDeps): TokenSet {
  const accessToken = String(body.access_token ?? '')
  if (!accessToken) throw new SocialApiError('X did not return an access token.')
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: expiryFrom(deps, body.expires_in),
  }
}

const x: SocialProvider = {
  key: 'x',
  label: 'X',
  usesPkce: true,
  maxTextLength: 280,
  mediaInText: true,
  configured: (env) => required(env, 'X_CLIENT_ID', 'X_CLIENT_SECRET'),
  authorizeUrl(env, { state, redirectUri, codeChallenge }) {
    const q = form({
      response_type: 'code',
      client_id: env.X_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return `https://x.com/i/oauth2/authorize?${q}`
  },
  async connect(env, { code, redirectUri, codeVerifier }, deps) {
    const tokenRes = await deps.fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: xBasic(env) },
      body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: env.X_CLIENT_ID }),
    })
    const tokens = xTokens(await ok(tokenRes, 'X token exchange'), deps)
    const meRes = await deps.fetch('https://api.x.com/2/users/me', { headers: { authorization: `Bearer ${tokens.accessToken}` } })
    const me = (await ok(meRes, 'X profile lookup')).data as { id?: string; name?: string; username?: string } | undefined
    if (!me?.id) throw new SocialApiError('X did not return an account id.')
    return [{ accountId: me.id, accountName: me.name || me.username || 'X account', handle: me.username ?? null, tokens }]
  },
  async refresh(env, refreshToken, deps) {
    const res = await deps.fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: xBasic(env) },
      body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.X_CLIENT_ID }),
    })
    return xTokens(await ok(res, 'X token refresh'), deps)
  },
  async publish(target, post, deps) {
    const res = await deps.fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { authorization: `Bearer ${target.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: post.text }),
    })
    const body = await ok(res, 'X post')
    const id = (body.data as { id?: string } | undefined)?.id
    if (!id) throw new SocialApiError('X accepted the post but returned no post id.')
    return { postId: id, url: `https://x.com/i/web/status/${id}` }
  },
}

// ---------------------------------------------------------------------------
// Meta: Facebook Pages and Instagram share one Meta app and one Login flow
// ---------------------------------------------------------------------------

const graphVersion = (env: Record<string, string | undefined>) => env.META_GRAPH_VERSION?.trim() || 'v26.0'
const graph = (env: Record<string, string | undefined>, path: string) => `https://graph.facebook.com/${graphVersion(env)}/${path}`

interface MetaPage {
  id: string
  name?: string
  access_token?: string
  instagram_business_account?: { id: string; username?: string }
}

async function metaConnect(
  env: Record<string, string | undefined>,
  input: { code: string; redirectUri: string },
  deps: ProviderDeps,
): Promise<MetaPage[]> {
  const shortRes = await deps.fetch(`${graph(env, 'oauth/access_token')}?${form({ client_id: env.META_APP_ID, redirect_uri: input.redirectUri, client_secret: env.META_APP_SECRET, code: input.code })}`)
  const short = await ok(shortRes, 'Meta token exchange')
  const shortToken = String(short.access_token ?? '')
  if (!shortToken) throw new SocialApiError('Meta did not return an access token.')
  // A long-lived user token makes the Page tokens below non-expiring.
  const longRes = await deps.fetch(`${graph(env, 'oauth/access_token')}?${form({ grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: shortToken })}`)
  const long = await ok(longRes, 'Meta long-lived token exchange')
  const userToken = String(long.access_token ?? shortToken)
  const pagesRes = await deps.fetch(`${graph(env, 'me/accounts')}?${form({ fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100' })}`, {
    headers: { authorization: `Bearer ${userToken}` },
  })
  const pages = (await ok(pagesRes, 'Meta Pages lookup')).data
  return Array.isArray(pages) ? (pages as MetaPage[]).filter((p) => p.id && p.access_token) : []
}

const metaCredentials = (env: Record<string, string | undefined>) => required(env, 'META_APP_ID', 'META_APP_SECRET')

function metaAuthorize(scope: string) {
  return (env: Record<string, string | undefined>, { state, redirectUri }: AuthorizeParams) =>
    `https://www.facebook.com/${graphVersion(env)}/dialog/oauth?${form({ client_id: env.META_APP_ID, redirect_uri: redirectUri, state, response_type: 'code', scope })}`
}

async function graphPost(res: Response, what: string): Promise<Record<string, unknown>> {
  return ok(res, what)
}

const meta: SocialProvider = {
  key: 'meta',
  label: 'Facebook Pages',
  usesPkce: false,
  maxTextLength: 63206,
  mediaInText: false,
  configured: metaCredentials,
  authorizeUrl: metaAuthorize('pages_show_list,pages_manage_posts,pages_read_engagement'),
  async connect(env, input, deps) {
    const pages = await metaConnect(env, input, deps)
    return pages.map((page) => ({
      accountId: page.id,
      accountName: page.name || `Facebook Page ${page.id}`,
      tokens: { accessToken: page.access_token as string, refreshToken: null, expiresAt: null },
    }))
  },
  async publish(target, post, deps, env) {
    const image = post.mediaUrls.find(isImageUrl)
    if (post.mediaUrls.some(isVideoUrl) && !image) throw new SocialApiError('Video posts to Facebook are not supported yet. Attach an image or remove the video.')
    const path = image ? `${target.accountId}/photos` : `${target.accountId}/feed`
    const body = image
      ? form({ url: image, caption: post.text, access_token: target.accessToken })
      : form({ message: post.text, access_token: target.accessToken })
    const res = await deps.fetch(graph(env, path), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const json = await graphPost(res, 'Facebook post')
    const id = String(json.post_id ?? json.id ?? '')
    if (!id) throw new SocialApiError('Facebook accepted the post but returned no post id.')
    return { postId: id, url: `https://www.facebook.com/${id}` }
  },
}

const instagram: SocialProvider = {
  key: 'instagram',
  label: 'Instagram',
  usesPkce: false,
  maxTextLength: 2200,
  mediaInText: false,
  configured: metaCredentials,
  authorizeUrl: metaAuthorize('instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'),
  async connect(env, input, deps) {
    const pages = await metaConnect(env, input, deps)
    return pages
      .filter((page) => page.instagram_business_account?.id)
      .map((page) => ({
        accountId: page.instagram_business_account!.id,
        accountName: page.instagram_business_account!.username || page.name || 'Instagram account',
        handle: page.instagram_business_account!.username ?? null,
        // The Instagram API is called with the linked Page's token.
        tokens: { accessToken: page.access_token as string, refreshToken: null, expiresAt: null },
        metadata: { pageId: page.id },
      }))
  },
  async publish(target, post, deps, env) {
    const image = post.mediaUrls.find(isImageUrl)
    if (!image) {
      throw new SocialApiError(post.mediaUrls.some(isVideoUrl)
        ? 'Video posts to Instagram are not supported yet. Attach a JPEG or PNG image URL.'
        : 'Instagram posts need an image. Attach a public JPEG or PNG image URL.')
    }
    const createRes = await deps.fetch(graph(env, `${target.accountId}/media`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ image_url: image, caption: post.text, access_token: target.accessToken }),
    })
    const creationId = String((await graphPost(createRes, 'Instagram media upload')).id ?? '')
    if (!creationId) throw new SocialApiError('Instagram did not return a media container id.')

    // Instagram prepares the container asynchronously; publishing too early fails.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const statusRes = await deps.fetch(`${graph(env, creationId)}?${form({ fields: 'status_code', access_token: target.accessToken })}`)
      const status = String((await ok(statusRes, 'Instagram media status')).status_code ?? '')
      if (status === 'FINISHED') break
      if (status === 'ERROR' || status === 'EXPIRED') throw new SocialApiError(`Instagram could not process the image (${status}). Check that the URL is public and a JPEG or PNG.`)
      if (attempt === 5) throw new SocialApiError('Instagram is still processing the image. It will be retried if you reschedule the post.')
      await deps.sleep(1500)
    }

    const publishRes = await deps.fetch(graph(env, `${target.accountId}/media_publish`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ creation_id: creationId, access_token: target.accessToken }),
    })
    const id = String((await graphPost(publishRes, 'Instagram publish')).id ?? '')
    if (!id) throw new SocialApiError('Instagram accepted the post but returned no post id.')
    return { postId: id, url: null }
  },
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

function tiktokTokens(body: Record<string, unknown>, deps: ProviderDeps): TokenSet {
  const accessToken = String(body.access_token ?? '')
  if (!accessToken) throw new SocialApiError(`TikTok did not return an access token${typeof body.error_description === 'string' ? `: ${body.error_description}` : '.'}`)
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: expiryFrom(deps, body.expires_in),
  }
}

const tiktok: SocialProvider = {
  key: 'tiktok',
  label: 'TikTok',
  usesPkce: false,
  maxTextLength: 2200,
  mediaInText: false,
  configured: (env) => required(env, 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'),
  authorizeUrl(env, { state, redirectUri }) {
    return `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: env.TIKTOK_CLIENT_KEY, scope: 'user.info.basic,video.publish', response_type: 'code', redirect_uri: redirectUri, state })}`
  },
  async connect(env, { code, redirectUri }, deps) {
    const tokenRes = await deps.fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
    })
    const tokenBody = await ok(tokenRes, 'TikTok token exchange')
    const tokens = tiktokTokens(tokenBody, deps)
    const meRes = await deps.fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', { headers: { authorization: `Bearer ${tokens.accessToken}` } })
    const user = ((await ok(meRes, 'TikTok profile lookup')).data as { user?: { open_id?: string; display_name?: string; avatar_url?: string } } | undefined)?.user
    const openId = user?.open_id || (typeof tokenBody.open_id === 'string' ? tokenBody.open_id : '')
    if (!openId) throw new SocialApiError('TikTok did not return an account id.')
    return [{ accountId: openId, accountName: user?.display_name || 'TikTok account', tokens, metadata: { avatarUrl: user?.avatar_url } }]
  },
  async refresh(env, refreshToken, deps) {
    const res = await deps.fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken }),
    })
    return tiktokTokens(await ok(res, 'TikTok token refresh'), deps)
  },
  async publish(target, post, deps) {
    const video = post.mediaUrls.find(isVideoUrl)
    if (!video) throw new SocialApiError('TikTok posts need a video. Attach a public MP4 or MOV URL on a domain verified in your TikTok app.')
    const auth = { authorization: `Bearer ${target.accessToken}`, 'content-type': 'application/json; charset=UTF-8' }

    // TikTok requires the privacy level to be one the creator is allowed to use. Apps that
    // have not passed TikTok's audit are limited to SELF_ONLY (private) posts.
    const infoRes = await deps.fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: auth, body: '{}' })
    const info = await ok(infoRes, 'TikTok creator lookup')
    const options = ((info.data as { privacy_level_options?: string[] } | undefined)?.privacy_level_options) ?? []
    const privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0]
    if (!privacy) throw new SocialApiError('TikTok did not offer any privacy level for this account.')

    const res = await deps.fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        post_info: { title: post.text, privacy_level: privacy },
        source_info: { source: 'PULL_FROM_URL', video_url: video },
      }),
    })
    const body = await readJson(res)
    const errCode = (body.error as { code?: string } | undefined)?.code
    if (!res.ok || (errCode && errCode !== 'ok')) {
      throw new SocialApiError(`TikTok post failed (${res.status}): ${describeError(body, errCode || 'no details returned')}`, res.status)
    }
    const publishId = (body.data as { publish_id?: string } | undefined)?.publish_id
    if (!publishId) throw new SocialApiError('TikTok accepted the post but returned no publish id.')
    return { postId: publishId, url: null }
  },
}

// ---------------------------------------------------------------------------

export const providers: Record<PlatformKey, SocialProvider> = { linkedin, x, meta, instagram, tiktok }

export function getProvider(key: string): SocialProvider | null {
  return (PLATFORM_KEYS as string[]).includes(key) ? providers[key as PlatformKey] : null
}

/** Which platforms have OAuth credentials configured in this environment. */
export function configuredPlatforms(env: Record<string, string | undefined>): Record<PlatformKey, boolean> {
  const out = {} as Record<PlatformKey, boolean>
  for (const key of PLATFORM_KEYS) out[key] = providers[key].configured(env)
  return out
}
