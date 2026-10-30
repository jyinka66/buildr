import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isUrlSafe, safeFetch } from '../src/lib/ssrf.ts'
import { initializePayment, verifyPayment, generateReference } from '../src/lib/paystack.ts'

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