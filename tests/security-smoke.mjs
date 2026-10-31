import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isUrlSafe, safeFetch } from '../src/lib/ssrf.ts'
import { initializePayment, verifyPayment, generateReference } from '../src/lib/paystack.ts'
import { rateLimit } from '../src/lib/rate-limit.ts'

test('SSRF checks reject loopback, link-local, private IPv6, credentials and non-HTTP schemes', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[2001:db8::1]/',
    'http://user:password@example.com/',
    'file:///etc/passwd',
    'not-a-url',
  ]) {
    const result = await isUrlSafe(url)
    assert.equal(result.ok, false, `${url} must be rejected`)
  }
  await assert.rejects(safeFetch('http://127.0.0.1/'), /SSRF blocked/)
})

test('SSRF transport pins outbound connections to validated public DNS answers', () => {
  const ssrfSource = readFileSync(new URL('../src/lib/ssrf.ts', import.meta.url), 'utf8')
  const pinnedSource = readFileSync(new URL('../src/lib/ssrf-pinned.ts', import.meta.url), 'utf8')
  assert.ok(ssrfSource.includes("import { fetchWithPinnedAddress } from './ssrf-pinned.ts'"), 'safeFetch must use the pinned transport')
  assert.ok(ssrfSource.includes('await fetchWithPinnedAddress(current,'), 'every redirect hop must use the pinned transport')
  assert.ok(ssrfSource.includes("isUrlSafe(current.toString(), { resolveDns: false })"), 'safeFetch must avoid a separate unabortable DNS lookup')
  assert.ok(ssrfSource.includes('retainTimeoutUntilBodyConsumed(response, cleanup)'), 'safeFetch timeout must cover the response body too')
  assert.ok(!ssrfSource.includes('await fetch(current,'), 'untrusted destinations must not use global fetch')
  assert.ok(pinnedSource.includes("lookup(hostname, { all: true, verbatim: true })"), 'transport must resolve all DNS answers')
  assert.ok(pinnedSource.includes('records.some((record) => isBlockedIp(record.address))'), 'transport must reject mixed public/private DNS answers')
  assert.ok(pinnedSource.includes('lookup: lookupPinned'), 'socket connection must use the checked address')
  assert.ok(pinnedSource.includes('agent: false'), 'requests must not reuse an unpinned pooled connection')
  assert.ok(pinnedSource.includes('servername: hostname'), 'HTTPS must validate the original hostname')
  assert.ok(pinnedSource.includes('const MAX_REQUEST_BODY_BYTES = 1_048_576'), 'outbound request bodies must have a strict memory bound')
  assert.ok(pinnedSource.includes('safe_fetch_request_body_too_large'), 'oversized outbound bodies must be rejected')
  assert.ok(pinnedSource.includes('readWithAbort(reader, signal)'), 'streaming request bodies must stop when the caller aborts')
  assert.ok(pinnedSource.includes('bodyToBuffer(init.body, signal)'), 'the request abort signal must reach body buffering')
})

test('quota and rate-limit enforcement use service-only atomic database RPCs', () => {
  const billing = readFileSync(new URL('../src/lib/billing.ts', import.meta.url), 'utf8')
  const limiter = readFileSync(new URL('../src/lib/distributed-rate-limit.ts', import.meta.url), 'utf8')
  assert.ok(billing.includes("db.rpc('reserve_usage'"), 'quota checks must reserve capacity atomically')
  assert.ok(billing.includes("db.rpc('commit_usage_reservation'"), 'actual usage must commit against a reservation')
  assert.ok(limiter.includes("db.rpc('consume_rate_limit'"), 'security-sensitive limits must be shared across instances')
  assert.ok(limiter.includes("createHash('sha256')"), 'raw identifiers must not be stored as rate-limit keys')
})

test('payment initialization and verification fail closed without Paystack credentials', async () => {
  const original = process.env.PAYSTACK_SECRET_KEY
  delete process.env.PAYSTACK_SECRET_KEY
  try {
    await assert.rejects(initializePayment({ email: 'client@example.com', amountKobo: 10000, reference: 'test-ref' }), /PAYSTACK_NOT_CONFIGURED/)
    await assert.rejects(verifyPayment('test-ref'), /PAYSTACK_NOT_CONFIGURED/)
  } finally {
    if (original === undefined) delete process.env.PAYSTACK_SECRET_KEY
    else process.env.PAYSTACK_SECRET_KEY = original
  }
})


test('Paystack mode requires an explicit matching test or live secret-key prefix', async () => {
  const previous = {
    key: process.env.PAYSTACK_SECRET_KEY,
    mode: process.env.PAYSTACK_MODE,
    nodeEnv: process.env.NODE_ENV,
  }
  const restore = (name, value) => value === undefined ? delete process.env[name] : process.env[name] = value
  try {
    process.env.NODE_ENV = 'production'
    process.env.PAYSTACK_MODE = 'test'
    process.env.PAYSTACK_SECRET_KEY = 'sk_live_not-a-real-key'
    await assert.rejects(
      initializePayment({ email: 'client@example.com', amountKobo: 10000, reference: 'mode-test-ref' }),
      /PAYSTACK_TEST_KEY_REQUIRED/,
    )
    process.env.PAYSTACK_MODE = 'live'
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_not-a-real-key'
    await assert.rejects(
      initializePayment({ email: 'client@example.com', amountKobo: 10000, reference: 'mode-live-ref' }),
      /PAYSTACK_LIVE_KEY_REQUIRED/,
    )
    process.env.PAYSTACK_MODE = 'sandbox'
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_not-a-real-key'
    await assert.rejects(
      initializePayment({ email: 'client@example.com', amountKobo: 10000, reference: 'mode-invalid-ref' }),
      /PAYSTACK_MODE_INVALID/,
    )
  } finally {
    restore('PAYSTACK_SECRET_KEY', previous.key)
    restore('PAYSTACK_MODE', previous.mode)
    restore('NODE_ENV', previous.nodeEnv)
  }
})

test('registration and credentials login retain password and account-state safeguards', () => {
  const register = readFileSync(new URL('../src/app/api/auth/register/route.ts', import.meta.url), 'utf8')
  const auth = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8')
  const forgot = readFileSync(new URL('../src/app/api/auth/forgot-password/route.ts', import.meta.url), 'utf8')
  const generation = readFileSync(new URL('../src/app/api/projects/[id]/generate/route.ts', import.meta.url), 'utf8')
  assert.ok(register.includes('bcrypt.hash(password, 10)'), 'registration must hash passwords')
  assert.ok(register.includes('Buffer.byteLength(password, \'utf8\') > 72'), 'registration must cap bcrypt password bytes')
  assert.ok(register.includes('distributedRateLimit('), 'registration must use the shared database-backed limiter')
  assert.ok(register.includes('.select(\'id, email, name\')'), 'registration response must not return password or private user fields')
  assert.ok(auth.includes('bcrypt.compare(password, user?.password || DUMMY_HASH)'), 'login must verify the password hash, with a dummy compare for unknown accounts')
  assert.ok(auth.includes('`login:${email}`') && auth.includes('`login:${email}:${clientIp}`'), 'login must throttle repeated attempts per account (and per account+IP) across instances')
  assert.ok(forgot.includes('distributedRateLimit('), 'password reset must use the shared limiter')
  assert.ok(generation.includes('distributedRateLimit('), 'generation must use the shared limiter')
  assert.ok(auth.includes('if (user.is_disabled) throw new Error(AUTH_ERRORS.accountDisabled)'), 'disabled accounts must not authenticate')
  assert.ok(auth.indexOf('bcrypt.compare(password') < auth.indexOf('AUTH_ERRORS.accountDisabled)'), 'account state must only be reported after the password is verified')
  assert.ok(auth.indexOf('bcrypt.compare(password') < auth.indexOf('AUTH_ERRORS.emailNotVerified)'), 'verification state must only be reported after the password is verified')
  assert.ok(auth.includes('if (user.totp_enabled)'), 'login must preserve optional two-factor verification')
})

test('payment references are unique and contain no unsafe job ID characters', () => {
  const first = generateReference('job/123')
  const second = generateReference('job/123')
  assert.notEqual(first, second)
  assert.match(first, /^buildr-job123-[0-9a-f-]{36}$/)
})


test('outgoing webhooks validate public destinations and re-check redirects during delivery', () => {
  const webhookRoute = readFileSync(new URL('../src/app/api/webhooks/route.ts', import.meta.url), 'utf8')
  const webhookDelivery = readFileSync(new URL('../src/lib/webhook.ts', import.meta.url), 'utf8')
  assert.ok(webhookRoute.includes('isUrlSafe(parsedUrl.toString())'), 'webhook creation must reject private or unresolved destinations')
  assert.ok(webhookRoute.includes("parsedUrl.protocol !== 'https:'"), 'production webhooks must use HTTPS')
  assert.ok(webhookDelivery.includes('safeFetch(url,'), 'delivery must validate every redirect target, not use raw fetch')
})

test('webhook delivery reads only a bounded response snippet', () => {
  const source = readFileSync(new URL('../src/lib/webhook.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('readBoundedResponse(res)'), 'response bodies must not be buffered without a limit')
  assert.ok(source.includes('reader.cancel()'), 'oversized responses should be cancelled')
})


test('production database access fails closed instead of using the in-memory demo store', () => {
  const source = readFileSync(new URL('../src/lib/supabase-server.ts', import.meta.url), 'utf8')
  assert.ok(source.includes("process.env.NODE_ENV === 'production'"))
  assert.ok(source.includes('throw new SupabaseNotConfiguredError()'))
})


test('token bucket retry time matches the next available token', () => {
  const originalNow = Date.now
  let now = 1_800_000_000_000
  Date.now = () => now
  const key = `rate-limit-test-${Math.random()}`
  try {
    assert.equal(rateLimit(key, { limit: 2, windowMs: 1000 }).ok, true)
    assert.equal(rateLimit(key, { limit: 2, windowMs: 1000 }).ok, true)
    const blocked = rateLimit(key, { limit: 2, windowMs: 1000 })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.resetMs, 500)
    now += blocked.resetMs
    assert.equal(rateLimit(key, { limit: 2, windowMs: 1000 }).ok, true)
  } finally {
    Date.now = originalNow
  }
})


test('public project visibility is owner-controlled and opt-in in the dashboard', () => {
  const shareRoute = readFileSync(new URL('../src/app/api/projects/[id]/share/route.ts', import.meta.url), 'utf8')
  const projectList = readFileSync(new URL('../src/app/api/projects/route.ts', import.meta.url), 'utf8')
  const apiClient = readFileSync(new URL('../src/lib/api-client.ts', import.meta.url), 'utf8')
  const dashboard = readFileSync(new URL('../src/components/builder/dashboard-view.tsx', import.meta.url), 'utf8')
  const publicRoute = readFileSync(new URL('../src/app/api/shared/[slug]/route.ts', import.meta.url), 'utf8')
  assert.ok(shareRoute.includes('project.owner_id !== user.id'), 'only project owners may change sharing')
  assert.ok(shareRoute.includes('.eq(\'owner_id\', user.id)'), 'update must be scoped to the authenticated owner')
  assert.ok(shareRoute.includes('randomBytes(16)'), 'public share links must use a high-entropy unguessable slug')
  assert.ok(shareRoute.includes('typeof body.enable !== \'boolean\''), 'public sharing must require an explicit boolean opt-in or opt-out')
  assert.ok(projectList.includes('isPublic: r.is_public === true'), 'owner project list must expose sharing state')
  assert.ok(apiClient.includes('setProjectPublic'), 'frontend must call the owner-protected sharing endpoint')
  assert.ok(dashboard.includes('Enable public link') && dashboard.includes('Disable public link'), 'dashboard must expose an explicit visibility toggle')
  assert.ok(publicRoute.includes(".eq('is_public', true)"), 'public endpoint must only serve projects currently opted into sharing')
})


test('browser previews isolate generated code from network and Buildr APIs', () => {
  const runtime = readFileSync(new URL('../src/lib/generator/preview-runtime.ts', import.meta.url), 'utf8')
  const exporter = readFileSync(new URL('../src/lib/generator/exporter.ts', import.meta.url), 'utf8')
  assert.ok(runtime.includes('Network access is disabled in Buildr preview'), 'preview fetch must not reach external services')
  assert.ok(runtime.includes("error: 'preview_only'"), 'relative API calls should return a preview mock')
  assert.ok(!runtime.includes('XTransformPort=3030'), 'preview must not forward generated API requests to the sidecar')
  assert.ok(exporter.includes("connect-src 'none'"), 'preview CSP must block network connections')
  assert.ok(exporter.includes("form-action 'none'"), 'preview CSP must block form submissions')
  assert.ok(exporter.includes("frame-src 'none'"), 'preview CSP must block nested frames')
  assert.ok(exporter.includes('hardenPreviewHtml(html)'), 'static and fallback previews must receive the policy')
  assert.ok(exporter.includes('hardenPreviewHtml(result.html)'), 'interactive previews must receive the policy')
})

test('sign-in reports precise errors, supports OAuth safely, and keeps the 2FA step retryable', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const auth = read('../src/lib/auth.ts')
  const check = read('../src/app/api/auth/2fa/check/route.ts')
  const enable = read('../src/app/api/auth/2fa/enable/route.ts')
  const resend = read('../src/app/api/auth/resend-verification/route.ts')
  const reset = read('../src/app/api/auth/reset-password/route.ts')
  const store = read('../src/lib/store.ts')
  const client = read('../src/lib/api-client.ts')
  const page = read('../src/app/page.tsx')

  // OAuth: providers only when configured, verified emails only, and an unverified local row is neutralised.
  assert.ok(auth.includes('GoogleProvider(') && auth.includes('GitHubProvider('), 'Google and GitHub providers must be registered')
  assert.ok(auth.includes('process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET'), 'Google must only be enabled when configured')
  assert.ok(auth.includes('process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET'), 'GitHub must only be enabled when configured')
  assert.ok(auth.includes("(profile as { email_verified?: boolean } | undefined)?.email_verified !== true"), 'Google sign-in must require a verified email')
  assert.ok(auth.includes('e.primary && e.verified'), 'GitHub sign-in must only trust a verified primary email')
  assert.ok(auth.includes('existing.is_disabled') && auth.includes('password: unusable'), 'OAuth must refuse disabled users and reset the password of unverified rows')
  assert.ok(auth.includes("account.provider !== 'credentials'") && auth.includes("from('users').select('id, email')"), 'OAuth sessions must carry the Buildr user id, not the provider id')

  // Login limiter must not let one IP lock the owner out, and must still cap distributed guessing.
  assert.ok(auth.includes('limit: 100') && auth.includes('ipKnown ?'), 'per-account lockout must be scoped by IP with a looser global ceiling')
  assert.ok(auth.includes('throw new Error(AUTH_ERRORS.rateLimited)'), 'rate limiting must be reported, not look like a wrong password')

  // Pre-login check mirrors the real login (shared limiter, trusted IP, dummy compare, state after password).
  assert.ok(check.includes('distributedRateLimit(') && check.includes('trustedClientIp('), '2fa/check must use the shared limiter and trusted client IP')
  assert.ok(!check.includes("headers.get('x-forwarded-for')"), '2fa/check must not trust a raw forwarded header')
  assert.ok(check.includes('user?.password || DUMMY_HASH'), '2fa/check must not throw on a missing password hash')
  assert.ok(check.indexOf('bcrypt.compare') < check.indexOf('email_not_verified'), '2fa/check must verify the password before reporting verification state')

  // 2FA management cannot be used to swap the secret of an account that already has 2FA.
  assert.ok(enable.includes('current?.totp_enabled') && enable.includes('status: 409'), '2fa/enable must refuse when 2FA is already on')
  for (const route of ['verify', 'disable']) {
    assert.ok(read(`../src/app/api/auth/2fa/${route}/route.ts`).includes('distributedRateLimit('), `2fa/${route} must throttle code guessing`)
  }

  // Resend verification never reveals whether an account exists and is rate limited per address.
  assert.ok(resend.includes('const GENERIC') && resend.includes('resend-email:'), 'resend must give a uniform answer and limit per address')
  assert.ok(resend.includes("type: 'signup'"), 'resend must use the Supabase signup confirmation email')
  assert.ok(reset.includes('distributedRateLimit(') && !reset.includes("headers.get('x-forwarded-for')"), 'password reset must use the shared limiter and trusted client IP')

  // Client wiring.
  assert.ok(client.includes("nextAuthSignIn(provider, { callbackUrl })"), 'OAuth must start with next-auth POST + CSRF, not a plain GET redirect')
  assert.ok(!client.includes('/api/auth/signin/${provider}'), 'the broken GET redirect to /api/auth/signin/<provider> must be gone')
  const completeTwoFactor = store.slice(store.indexOf('async completeTwoFactor'), store.indexOf('cancelTwoFactor() {'))
  assert.ok(!completeTwoFactor.includes("twoFactorRequired: false, twoFactorEmail: '', twoFactorPassword: '' })\n    }"), 'a wrong 2FA code must not reset the dialog')
  assert.ok(completeTwoFactor.includes('Stay on the code step'), 'a wrong 2FA code must keep the code step open')
  assert.ok(page.includes('/^[a-f0-9]{64}$/i.test(reset)') && page.includes('window.history.replaceState'), 'reset tokens must be validated and removed from the address bar')
})

test('support ticket creation rolls the ticket back when its messages cannot be saved', () => {
  const route = readFileSync(new URL('../src/app/api/support/tickets/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('const { error: messagesError } = await db.from(\'support_messages\').insert(['), 'the message insert result must be checked')
  const rollback = route.slice(route.indexOf('if (messagesError)'), route.indexOf('Step 3'))
  assert.ok(rollback.includes("from('support_tickets').delete().eq('id', ticket.id)"), 'a ticket without messages must be removed')
  assert.ok(rollback.includes('status: 500'), 'the caller must be told the ticket was not created')
})
