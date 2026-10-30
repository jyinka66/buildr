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
  assert.ok(auth.includes('bcrypt.compare(password, user.password)'), 'login must verify the password hash')
  assert.ok(auth.includes('distributedRateLimit(`login:${email}`'), 'login must throttle repeated attempts for the same normalized account across instances')
  assert.ok(forgot.includes('distributedRateLimit('), 'password reset must use the shared limiter')
  assert.ok(generation.includes('distributedRateLimit('), 'generation must use the shared limiter')
  assert.ok(auth.includes('if (user.is_disabled) return null'), 'disabled accounts must not authenticate')
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
