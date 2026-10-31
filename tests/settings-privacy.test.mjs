import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publicErrorMessage, GENERIC_AI_ERROR } from '../src/lib/llm/public-error.ts'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('regular users never see provider or model names in errors', () => {
  for (const raw of [
    'Groq stream error 429: {"error":"rate limit"}',
    'OpenRouter error 502: bad gateway',
    'Anthropic stream error 400',
    'No AI provider is configured. Add a provider API key in Settings → LLM Providers.',
    'Provider "Google Gemini" has no API key configured.',
    'DeepSeek returned an empty stream.',
  ]) {
    assert.equal(publicErrorMessage(raw, false), GENERIC_AI_ERROR, raw)
  }
})

test('admins see the full error', () => {
  const raw = 'Groq stream error 429: {"error":"rate limit"}'
  assert.equal(publicErrorMessage(raw, true), raw)
})

test('non-provider errors pass through for everyone', () => {
  for (const raw of ['usage_commit_failed', 'rate_limited', 'stream_failed']) {
    assert.equal(publicErrorMessage(raw, false), raw)
  }
})

test('provider list route returns nothing to non-admins', () => {
  const src = read('src/app/api/providers/route.ts')
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('interface UpdateBody'))
  assert.match(get, /isUserAdmin\(user\.id\)/)
  assert.match(get, /providers: \[\]/)
  // The admin check must come before any provider is loaded.
  assert.ok(get.indexOf('isUserAdmin') < get.indexOf('loadProviders'))
})

test('stream routes only expose the provider to admins', () => {
  for (const route of [
    'src/app/api/chat/stream/route.ts',
    'src/app/api/projects/[id]/chat-stream/route.ts',
  ]) {
    assert.match(read(route), /exposeProvider: await isUserAdmin\(user\.id\)/, route)
  }
  const gen = read('src/app/api/projects/[id]/generate-stream/route.ts')
  assert.match(gen, /provider: exposeProvider \? providerInfo : null/)
  assert.match(read('src/lib/llm/chat-sse.ts'), /provider: p\.exposeProvider \? providerInfo : null/)
})

test('settings page renders provider controls for admins only', () => {
  const src = read('src/components/builder/settings-view.tsx')
  const body = src.slice(src.indexOf('export function SettingsView'))
  assert.match(body, /isAdmin \? \(/)
  assert.ok(body.indexOf('isAdmin ? (') < body.indexOf('<ProviderCard'))
  assert.match(body, /if \(isAdmin && providers\.length === 0\)/)
})

test('password and account deletion are rate limited and need the current password', () => {
  const pw = read('src/app/api/account/password/route.ts')
  assert.match(pw, /distributedRateLimit\(`pwchange:/)
  assert.match(pw, /bcrypt\.compare\(currentPassword/)
  assert.match(pw, /totp_enabled/)
  const del = read('src/app/api/account/delete/route.ts')
  assert.match(del, /distributedRateLimit\(`acctdelete:/)
})
