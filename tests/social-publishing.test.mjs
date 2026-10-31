import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { providers, configuredPlatforms, getProvider, isImageUrl, isVideoUrl } from '../src/lib/social/providers.ts'
import { publishPost, buildText, textLength } from '../src/lib/social/publish-post.ts'
import { createState, encodeState, verifyState, newPkce } from '../src/lib/social/oauth-state.ts'

const NOW = new Date('2026-11-01T10:00:00Z')
const env = {
  LINKEDIN_CLIENT_ID: 'li-id', LINKEDIN_CLIENT_SECRET: 'li-secret',
  X_CLIENT_ID: 'x-id', X_CLIENT_SECRET: 'x-secret',
  META_APP_ID: 'meta-id', META_APP_SECRET: 'meta-secret',
  TIKTOK_CLIENT_KEY: 'tt-key', TIKTOK_CLIENT_SECRET: 'tt-secret',
}

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

/** A fetch that answers from a list of [test, response] pairs and records every call. */
function fakeFetch(routes) {
  const calls = []
  const fn = async (input, init = {}) => {
    const url = String(input)
    const call = { url, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers ?? {})), body: init.body ? String(init.body) : '' }
    calls.push(call)
    for (const [match, respond] of routes) {
      if (match(call)) return typeof respond === 'function' ? respond(call) : respond.clone()
    }
    throw new Error(`unexpected request: ${call.method} ${url}`)
  }
  fn.calls = calls
  return fn
}
const deps = (fetchImpl) => ({ fetch: fetchImpl, sleep: async () => {}, now: () => NOW })
const has = (s) => (c) => c.url.includes(s)
const params = (body) => Object.fromEntries(new URLSearchParams(body))

test('platforms report whether their OAuth credentials are configured', () => {
  assert.deepEqual(Object.values(configuredPlatforms(env)).every(Boolean), true)
  const partial = configuredPlatforms({ LINKEDIN_CLIENT_ID: 'only-id', X_CLIENT_ID: 'x', X_CLIENT_SECRET: 's' })
  assert.equal(partial.linkedin, false, 'an id without a secret is not configured')
  assert.equal(partial.x, true)
  assert.equal(partial.meta, false)
  assert.equal(getProvider('myspace'), null)
})

test('LinkedIn: authorize URL, connect and publish match the documented API', async () => {
  const url = new URL(providers.linkedin.authorizeUrl(env, { state: 'abc', redirectUri: 'https://app.test/cb' }))
  assert.equal(url.origin + url.pathname, 'https://www.linkedin.com/oauth/v2/authorization')
  assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social')
  assert.equal(url.searchParams.get('state'), 'abc')

  const f = fakeFetch([
    [has('oauth/v2/accessToken'), json({ access_token: 'li-token', expires_in: 5184000 })],
    [has('/v2/userinfo'), json({ sub: 'member-1', name: 'Ada Lovelace' })],
  ])
  const [account] = await providers.linkedin.connect(env, { code: 'the-code', redirectUri: 'https://app.test/cb' }, deps(f))
  assert.equal(account.accountId, 'member-1')
  assert.equal(account.tokens.accessToken, 'li-token')
  assert.equal(account.tokens.expiresAt.toISOString(), new Date(NOW.getTime() + 5184000 * 1000).toISOString())
  assert.deepEqual(params(f.calls[0].body), { grant_type: 'authorization_code', code: 'the-code', redirect_uri: 'https://app.test/cb', client_id: 'li-id', client_secret: 'li-secret' })
  assert.equal(f.calls[1].headers.authorization, 'Bearer li-token')

  const p = fakeFetch([[has('/v2/ugcPosts'), new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } })]])
  const out = await providers.linkedin.publish({ accountId: 'member-1', accessToken: 'li-token' }, { text: 'Hello', mediaUrls: [] }, deps(p), env)
  assert.equal(out.postId, 'urn:li:share:99')
  const call = p.calls[0]
  assert.equal(call.method, 'POST')
  assert.equal(call.headers['x-restli-protocol-version'], '2.0.0')
  assert.equal(call.headers.authorization, 'Bearer li-token')
  const body = JSON.parse(call.body)
  assert.equal(body.author, 'urn:li:person:member-1')
  assert.equal(body.lifecycleState, 'PUBLISHED')
  assert.equal(body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text, 'Hello')
  assert.equal(body.visibility['com.linkedin.ugc.MemberNetworkVisibility'], 'PUBLIC')
})

test('X: PKCE authorize URL, token exchange, refresh and tweet request shapes', async () => {
  const { verifier, challenge } = newPkce()
  const url = new URL(providers.x.authorizeUrl(env, { state: 's1', redirectUri: 'https://app.test/cb', codeChallenge: challenge }))
  assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), challenge)
  assert.equal(url.searchParams.get('scope'), 'tweet.read tweet.write users.read offline.access')

  const f = fakeFetch([
    [has('/2/oauth2/token'), json({ access_token: 'x-access', refresh_token: 'x-refresh', expires_in: 7200 })],
    [has('/2/users/me'), json({ data: { id: '42', name: 'Ada', username: 'ada' } })],
  ])
  const [account] = await providers.x.connect(env, { code: 'c', redirectUri: 'https://app.test/cb', codeVerifier: verifier }, deps(f))
  assert.equal(account.accountId, '42')
  assert.equal(account.handle, 'ada')
  assert.equal(account.tokens.refreshToken, 'x-refresh')
  assert.equal(f.calls[0].headers.authorization, `Basic ${Buffer.from('x-id:x-secret').toString('base64')}`)
  assert.equal(params(f.calls[0].body).code_verifier, verifier)

  const r = fakeFetch([[has('/2/oauth2/token'), json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200 })]])
  const tokens = await providers.x.refresh(env, 'x-refresh', deps(r))
  assert.equal(tokens.accessToken, 'new-access')
  assert.deepEqual(params(r.calls[0].body), { grant_type: 'refresh_token', refresh_token: 'x-refresh', client_id: 'x-id' })

  const p = fakeFetch([[has('/2/tweets'), json({ data: { id: '777' } }, { status: 201 })]])
  const out = await providers.x.publish({ accountId: '42', accessToken: 'x-access' }, { text: 'gm', mediaUrls: [] }, deps(p), env)
  assert.equal(out.postId, '777')
  assert.equal(out.url, 'https://x.com/i/web/status/777')
  assert.deepEqual(JSON.parse(p.calls[0].body), { text: 'gm' })
})

test('Facebook Pages: connect returns every Page with its own token; posts use feed or photos', async () => {
  const f = fakeFetch([
    [(c) => c.url.includes('oauth/access_token') && c.url.includes('code=c1'), json({ access_token: 'short' })],
    [(c) => c.url.includes('oauth/access_token') && c.url.includes('fb_exchange_token=short'), json({ access_token: 'long-user' })],
    [has('/me/accounts'), json({ data: [
      { id: 'p1', name: 'Shop', access_token: 'page-token-1' },
      { id: 'p2', name: 'Blog', access_token: 'page-token-2', instagram_business_account: { id: 'ig2', username: 'blog_ig' } },
      { id: 'p3', name: 'No token' },
    ] })],
  ])
  const accounts = await providers.meta.connect(env, { code: 'c1', redirectUri: 'https://app.test/cb' }, deps(f))
  assert.deepEqual(accounts.map((a) => [a.accountId, a.tokens.accessToken, a.tokens.expiresAt]), [['p1', 'page-token-1', null], ['p2', 'page-token-2', null]])
  assert.ok(f.calls.every((c) => c.url.startsWith('https://graph.facebook.com/v26.0/')), 'uses the documented Graph version')
  assert.equal(f.calls[2].headers.authorization, 'Bearer long-user')

  const text = fakeFetch([[has('/p1/feed'), json({ id: 'p1_100' })]])
  const out = await providers.meta.publish({ accountId: 'p1', accessToken: 'page-token-1' }, { text: 'Hi', mediaUrls: [] }, deps(text), env)
  assert.equal(out.postId, 'p1_100')
  assert.deepEqual(params(text.calls[0].body), { message: 'Hi', access_token: 'page-token-1' })

  const photo = fakeFetch([[has('/p1/photos'), json({ id: '555', post_id: 'p1_555' })]])
  const withImage = await providers.meta.publish({ accountId: 'p1', accessToken: 't' }, { text: 'Pic', mediaUrls: ['https://cdn.test/a.PNG?x=1'] }, deps(photo), env)
  assert.equal(withImage.postId, 'p1_555')
  assert.equal(params(photo.calls[0].body).url, 'https://cdn.test/a.PNG?x=1')

  await assert.rejects(providers.meta.publish({ accountId: 'p1', accessToken: 't' }, { text: 'v', mediaUrls: ['https://cdn.test/v.mp4'] }, deps(fakeFetch([])), env), /Video posts to Facebook are not supported/)
})

test('Instagram: only Pages with a linked account connect; publishing waits for the media container', async () => {
  const f = fakeFetch([
    [has('oauth/access_token'), json({ access_token: 'tok' })],
    [has('/me/accounts'), json({ data: [
      { id: 'p1', name: 'Shop', access_token: 'pt1' },
      { id: 'p2', name: 'Blog', access_token: 'pt2', instagram_business_account: { id: 'ig2', username: 'blog_ig' } },
    ] })],
  ])
  const accounts = await providers.instagram.connect(env, { code: 'c', redirectUri: 'r' }, deps(f))
  assert.equal(accounts.length, 1)
  assert.deepEqual([accounts[0].accountId, accounts[0].handle, accounts[0].tokens.accessToken, accounts[0].metadata.pageId], ['ig2', 'blog_ig', 'pt2', 'p2'])

  let polls = 0
  let sleeps = 0
  const p = fakeFetch([
    [(c) => c.url.endsWith('/ig2/media'), json({ id: 'container-1' })],
    [has('/container-1'), () => json({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' })],
    [has('/ig2/media_publish'), json({ id: 'ig-post-1' })],
  ])
  const out = await providers.instagram.publish({ accountId: 'ig2', accessToken: 'pt2' }, { text: 'Caption', mediaUrls: ['https://cdn.test/a.jpg'] }, { ...deps(p), sleep: async () => { sleeps += 1 } }, env)
  assert.equal(out.postId, 'ig-post-1')
  assert.equal(polls, 3)
  assert.equal(sleeps, 2)
  assert.deepEqual(params(p.calls[0].body), { image_url: 'https://cdn.test/a.jpg', caption: 'Caption', access_token: 'pt2' })
  assert.equal(params(p.calls.at(-1).body).creation_id, 'container-1')

  await assert.rejects(providers.instagram.publish({ accountId: 'ig2', accessToken: 't' }, { text: 'x', mediaUrls: [] }, deps(fakeFetch([])), env), /need an image/)
})

test('TikTok: uses the creator privacy options and requires a video', async () => {
  const url = new URL(providers.tiktok.authorizeUrl(env, { state: 's', redirectUri: 'https://app.test/cb' }))
  assert.equal(url.searchParams.get('client_key'), 'tt-key')
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish')

  const f = fakeFetch([
    [has('/v2/oauth/token/'), json({ access_token: 'tt-token', refresh_token: 'tt-refresh', expires_in: 86400, open_id: 'open-1' })],
    [has('/v2/user/info/'), json({ data: { user: { open_id: 'open-1', display_name: 'Ada' } } })],
  ])
  const [account] = await providers.tiktok.connect(env, { code: 'c', redirectUri: 'r' }, deps(f))
  assert.deepEqual([account.accountId, account.accountName], ['open-1', 'Ada'])
  assert.equal(params(f.calls[0].body).client_key, 'tt-key')

  // Unaudited apps are only offered SELF_ONLY, so that is what must be sent.
  const p = fakeFetch([
    [has('/creator_info/query/'), json({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } })],
    [has('/video/init/'), json({ data: { publish_id: 'v_pub~1' }, error: { code: 'ok' } })],
  ])
  const out = await providers.tiktok.publish({ accountId: 'open-1', accessToken: 'tt-token' }, { text: 'My video', mediaUrls: ['https://cdn.test/clip.mp4'] }, deps(p), env)
  assert.equal(out.postId, 'v_pub~1')
  assert.deepEqual(JSON.parse(p.calls[1].body), {
    post_info: { title: 'My video', privacy_level: 'SELF_ONLY' },
    source_info: { source: 'PULL_FROM_URL', video_url: 'https://cdn.test/clip.mp4' },
  })

  const audited = fakeFetch([
    [has('/creator_info/query/'), json({ data: { privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'] } })],
    [has('/video/init/'), json({ data: { publish_id: 'x' }, error: { code: 'ok' } })],
  ])
  await providers.tiktok.publish({ accountId: 'o', accessToken: 't' }, { text: 'a', mediaUrls: ['https://cdn.test/c.mov'] }, deps(audited), env)
  assert.equal(JSON.parse(audited.calls[1].body).post_info.privacy_level, 'PUBLIC_TO_EVERYONE')

  const rejected = fakeFetch([
    [has('/creator_info/query/'), json({ data: { privacy_level_options: ['SELF_ONLY'] } })],
    [has('/video/init/'), json({ error: { code: 'url_ownership_unverified', message: 'verify your domain' } }, { status: 403 })],
  ])
  await assert.rejects(providers.tiktok.publish({ accountId: 'o', accessToken: 't' }, { text: 'a', mediaUrls: ['https://cdn.test/c.mp4'] }, deps(rejected), env), /verify your domain/)
  await assert.rejects(providers.tiktok.publish({ accountId: 'o', accessToken: 't' }, { text: 'a', mediaUrls: [] }, deps(fakeFetch([])), env), /need a video/)
})

test('platform API errors surface a readable message', async () => {
  const f = fakeFetch([[has('/2/tweets'), json({ title: 'Forbidden', detail: 'You are not permitted to create a Tweet' }, { status: 403 })]])
  await assert.rejects(providers.x.publish({ accountId: '1', accessToken: 't' }, { text: 'x', mediaUrls: [] }, deps(f), env), /X post failed \(403\): You are not permitted to create a Tweet/)
  const g = fakeFetch([[has('/feed'), json({ error: { message: 'Error validating access token' } }, { status: 400 })]])
  await assert.rejects(providers.meta.publish({ accountId: 'p', accessToken: 't' }, { text: 'x', mediaUrls: [] }, deps(g), env), /Error validating access token/)
})

test('media helpers recognise image and video links', () => {
  assert.equal(isImageUrl('https://a.test/x.jpeg?w=1'), true)
  assert.equal(isImageUrl('https://a.test/x.mp4'), false)
  assert.equal(isVideoUrl('https://a.test/x.MOV'), true)
})

// ---------------------------------------------------------------------------
// publishPost
// ---------------------------------------------------------------------------

const account = (platform, accountId, extra = {}) => ({ id: `row-${accountId}`, platform, accountId, accountName: `${platform}-${accountId}`, accessToken: 'tok', refreshToken: null, tokenExpires: null, ...extra })
const basePost = (over = {}) => ({ content: 'Launch day', hashtags: ['buildr', '#ship'], mediaUrls: [], platforms: ['x'], previous: {}, ...over })

function ctxFor(accounts, f, over = {}) {
  const progress = []
  const tokens = []
  return {
    progress, tokens,
    ctx: { accounts, env, deps: deps(f), onProgress: async (r) => { progress.push(JSON.parse(JSON.stringify(r))) }, onTokens: async (a, t) => { tokens.push([a.id, t.accessToken]) }, ...over },
  }
}

test('publishPost builds text with hashtags and appends media links for text-only platforms', () => {
  assert.equal(buildText({ content: ' Hi ', hashtags: ['a', '#b', ' '] }, providers.x, []), 'Hi\n\n#a #b')
  assert.equal(buildText({ content: 'Hi', hashtags: [] }, providers.x, ['https://m.test/1.jpg']), 'Hi\n\nhttps://m.test/1.jpg')
  assert.equal(buildText({ content: 'Hi', hashtags: [] }, providers.meta, ['https://m.test/1.jpg']), 'Hi', 'platforms that attach media natively do not repeat the link')
  assert.equal(textLength(`a ${'https://example.com/' + 'x'.repeat(100)}`, 'x'), 2 + 23, 'X counts links as 23 characters')
})

test('publishPost posts to every account and reports posted', async () => {
  const f = fakeFetch([[has('/2/tweets'), json({ data: { id: 't1' } })]])
  const { ctx, progress } = ctxFor([account('x', '1'), account('x', '2')], f)
  const out = await publishPost(basePost(), ctx)
  assert.equal(out.status, 'posted')
  assert.equal(out.results.x.ok, true)
  assert.deepEqual(Object.keys(out.results.x.accounts), ['1', '2'])
  assert.equal(JSON.parse(f.calls[0].body).text, 'Launch day\n\n#buildr #ship')
  assert.equal(progress.length, 2, 'progress is saved after every account')
})

test('publishPost reports failures per platform and retries only the failed account', async () => {
  let attempt = 0
  const f = fakeFetch([[has('/2/tweets'), (c) => (c.headers.authorization === 'Bearer bad' ? json({ detail: 'nope' }, { status: 500 }) : json({ data: { id: `t${++attempt}` } }))]])
  const accounts = [account('x', '1'), account('x', '2', { accessToken: 'bad' })]
  const first = await publishPost(basePost(), ctxFor(accounts, f).ctx)
  assert.equal(first.status, 'failed')
  assert.equal(first.results.x.accounts['1'].ok, true)
  assert.equal(first.results.x.accounts['2'].ok, false)
  assert.match(first.results.x.accounts['2'].error, /nope/)
  const callsAfterFirst = f.calls.length

  // Reschedule with the fixed token: account 1 must NOT be posted a second time.
  accounts[1].accessToken = 'good'
  const second = await publishPost(basePost({ previous: first.results }), ctxFor(accounts, f).ctx)
  assert.equal(second.status, 'posted')
  assert.equal(f.calls.length - callsAfterFirst, 1, 'only the failed account is retried')
  assert.equal(second.results.x.accounts['1'].postId, first.results.x.accounts['1'].postId)
})

test('publishPost explains missing accounts, long text and unknown platforms without calling any API', async () => {
  const f = fakeFetch([])
  const none = await publishPost(basePost({ platforms: ['linkedin'] }), ctxFor([], f).ctx)
  assert.equal(none.status, 'failed')
  assert.match(none.results.linkedin.error, /No account is linked for LinkedIn/)

  const long = await publishPost(basePost({ content: 'a'.repeat(300), hashtags: [] }), ctxFor([account('x', '1')], f).ctx)
  assert.match(long.results.x.error, /300 characters, but X allows 280/)

  const unknown = await publishPost(basePost({ platforms: ['myspace'] }), ctxFor([], f).ctx)
  assert.match(unknown.results.myspace.error, /Unknown platform/)
  assert.equal(f.calls.length, 0)

  const empty = await publishPost(basePost({ platforms: [] }), ctxFor([], f).ctx)
  assert.equal(empty.status, 'failed', 'a post with no platforms is never reported as posted')
})

test('publishPost refreshes an expiring token and stores it, or asks to reconnect', async () => {
  const soon = new Date(NOW.getTime() + 60 * 1000)
  const f = fakeFetch([
    [has('/2/oauth2/token'), json({ access_token: 'fresh', refresh_token: 'fresh-r', expires_in: 7200 })],
    [has('/2/tweets'), (c) => json({ data: { id: c.headers.authorization === 'Bearer fresh' ? 'ok-1' : 'wrong-token' } })],
  ])
  const refreshable = account('x', '1', { accessToken: 'old', refreshToken: 'old-r', tokenExpires: soon })
  const a = ctxFor([refreshable], f)
  const out = await publishPost(basePost(), a.ctx)
  assert.equal(out.status, 'posted')
  assert.equal(out.results.x.accounts['1'].postId, 'ok-1')
  assert.deepEqual(a.tokens, [['row-1', 'fresh']])

  const expired = account('x', '2', { tokenExpires: soon })
  const b = await publishPost(basePost(), ctxFor([expired], fakeFetch([])).ctx)
  assert.equal(b.status, 'failed')
  assert.match(b.results.x.accounts['2'].error, /connection has expired\. Reconnect the account/)
})

test('a platform failing does not stop the others, and the post is failed overall', async () => {
  const f = fakeFetch([
    [has('/2/tweets'), json({ data: { id: 't' } })],
    [has('/v2/ugcPosts'), json({ message: 'Invalid access token' }, { status: 401 })],
  ])
  const out = await publishPost(basePost({ platforms: ['linkedin', 'x'], content: 'Both' }), ctxFor([account('linkedin', 'm1'), account('x', '1')], f).ctx)
  assert.equal(out.status, 'failed')
  assert.equal(out.results.x.ok, true)
  assert.equal(out.results.linkedin.ok, false)
  assert.match(out.results.linkedin.accounts.m1.error, /reconnect the account/)
})

// ---------------------------------------------------------------------------
// OAuth state
// ---------------------------------------------------------------------------

test('OAuth state accepts only an untampered, unexpired callback from the same user and platform', () => {
  const secret = 'test-secret-test-secret-test-secret-123'
  const state = createState({ platform: 'x', userId: 'u1', verifier: 'ver' }, NOW.getTime())
  const cookie = encodeState(state, secret)
  const expected = { platform: 'x', stateParam: state.nonce, userId: 'u1' }

  const good = verifyState(cookie, secret, expected, NOW.getTime())
  assert.equal(good.ok, true)
  assert.equal(good.state.verifier, 'ver')

  assert.equal(verifyState(undefined, secret, expected, NOW.getTime()).reason, 'missing')
  assert.equal(verifyState(cookie, 'another-secret-another-secret-12345', expected, NOW.getTime()).reason, 'invalid')
  const [payload] = cookie.split('.')
  assert.equal(verifyState(`${payload}.AAAA`, secret, expected, NOW.getTime()).reason, 'invalid')
  const forged = Buffer.from(JSON.stringify({ ...state, userId: 'attacker' })).toString('base64url')
  assert.equal(verifyState(`${forged}.${cookie.split('.')[1]}`, secret, expected, NOW.getTime()).reason, 'invalid', 'editing the payload breaks the signature')
  assert.equal(verifyState(cookie, secret, expected, NOW.getTime() + 11 * 60 * 1000).reason, 'expired')
  assert.equal(verifyState(cookie, secret, { ...expected, stateParam: 'forged' }, NOW.getTime()).reason, 'mismatch')
  assert.equal(verifyState(cookie, secret, { ...expected, userId: 'u2' }, NOW.getTime()).reason, 'mismatch', 'a different signed-in user cannot finish the flow')
  assert.equal(verifyState(cookie, secret, { ...expected, platform: 'linkedin' }, NOW.getTime()).reason, 'mismatch')
  assert.equal(verifyState(cookie, secret, { ...expected, stateParam: null }, NOW.getTime()).reason, 'mismatch')
})

// ---------------------------------------------------------------------------
// Wiring (source checks for the parts that need a live database)
// ---------------------------------------------------------------------------

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('the publish endpoint fails closed and compares the secret in constant time', () => {
  const route = read('../src/app/api/cron/publish-scheduled/route.ts')
  assert.ok(route.includes("return 'unconfigured'") && route.includes('status: 503'), 'no CRON_SECRET must mean no publishing')
  assert.ok(route.includes('timingSafeEqual') && route.includes("createHash('sha256')"), 'secret comparison must be constant time')
  assert.ok(route.indexOf('authorize(req)') < route.indexOf('runDuePosts()'), 'authorise before doing any work')
})

test('due posts are claimed atomically, never re-sent after a crash, and tokens stay encrypted', () => {
  const run = read('../src/lib/social/run-due.ts')
  const claim = run.slice(run.indexOf("update({ status: 'posting'"), run.indexOf('summary.claimed'))
  assert.ok(claim.includes(".eq('status', 'scheduled')"), 'the claim UPDATE must be conditional on the post still being scheduled')
  assert.ok(run.includes(".eq('status', 'posting')") && run.includes("status: 'failed'"), 'stuck posts are marked failed, not re-published')
  assert.ok(run.includes('decrypt(value)') && run.includes('encrypt(tokens.accessToken)'), 'tokens are decrypted only here and re-encrypted when refreshed')
  const callback = read('../src/app/api/marketing/accounts/oauth/[platform]/callback/route.ts')
  assert.ok(callback.includes('encrypt(a.tokens.accessToken)'), 'tokens are encrypted before they are stored')
  assert.ok(callback.indexOf('verifyState(') < callback.indexOf('provider.connect('), 'the state must be verified before the code is exchanged')
  const start = read('../src/app/api/marketing/accounts/oauth/[platform]/start/route.ts')
  assert.ok(start.includes('httpOnly: true') && start.includes("sameSite: 'lax'"), 'state cookie must be httpOnly')
})

test('account listings never return tokens', () => {
  const route = read('../src/app/api/marketing/accounts/route.ts')
  const start = route.indexOf('function toAccountView')
  const view = route.slice(start, route.indexOf('// GET', start))
  assert.ok(!/access_token\s*[,:]\s*row/.test(view) && !view.includes('refresh_token'), 'the account view must not expose tokens')
  assert.ok(view.includes('canPublish'), 'the view reports whether the account can publish')
})

test('the scheduler workflow and environment template cover the new settings', () => {
  const workflow = read('../.github/workflows/publish-scheduled-posts.yml')
  assert.ok(workflow.includes("cron: '*/5 * * * *'") && workflow.includes('workflow_dispatch'))
  assert.ok(workflow.includes('secrets.CRON_SECRET') && workflow.includes('secrets.APP_URL'))
  const example = read('../.env.example')
  for (const name of ['CRON_SECRET', 'LINKEDIN_CLIENT_ID', 'X_CLIENT_ID', 'META_APP_ID', 'TIKTOK_CLIENT_KEY']) {
    assert.ok(example.includes(`${name}=`), `${name} must be documented in .env.example`)
  }
})
