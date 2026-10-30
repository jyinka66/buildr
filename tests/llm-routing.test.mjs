import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isProviderReady, rankProviders } from '../src/lib/llm/routing-policy.ts'

const provider = (key, overrides = {}) => ({
  id: key,
  key,
  enabled: true,
  health: 'healthy',
  apiKey: 'configured-key',
  weight: 1,
  speciality: 'general',
  ...overrides,
})

test('router excludes disabled, offline, and unconfigured providers', () => {
  assert.equal(isProviderReady(provider('zai')), true)
  assert.equal(isProviderReady(provider('zai', { apiKey: '(managed)' })), false)
  assert.equal(isProviderReady(provider('zai', { apiKey: '' })), false)
  assert.equal(isProviderReady(provider('openai', { apiKey: '' })), false)
  assert.equal(isProviderReady(provider('openai', { apiKey: '(managed)' })), false)
  assert.equal(isProviderReady(provider('openai', { enabled: false })), false)
  assert.equal(isProviderReady(provider('openai', { health: 'down' })), false)
})

test('router prefers explicit valid override, then task speciality, general, and weighted fallbacks', () => {
  const providers = [
    provider('zai', { speciality: 'code', weight: 10 }),
    provider('openai', { speciality: 'schema', weight: 8 }),
    provider('anthropic', { speciality: 'code', weight: 9 }),
    provider('google', { speciality: 'docs', weight: 7 }),
    provider('deepseek', { speciality: 'general', weight: 6 }),
    provider('ollama', { speciality: 'code', weight: 5, apiKey: '' }),
  ]
  assert.deepEqual(rankProviders(providers, 'code').map((p) => p.key), [
    'zai', 'anthropic', 'deepseek', 'openai', 'google',
  ])
  // Task speciality first, then the 'general' provider, then everything else by weight.
  assert.deepEqual(rankProviders(providers, 'docs').map((p) => p.key), [
    'google', 'deepseek', 'zai', 'anthropic', 'openai',
  ])
  assert.equal(rankProviders(providers, 'code', 'anthropic')[0].key, 'anthropic')
  assert.equal(rankProviders(providers, 'code', 'ollama')[0].key, 'zai')
})

test('router returns no candidates when every provider is unavailable', () => {
  assert.deepEqual(rankProviders([
    provider('openai', { apiKey: '' }),
    provider('zai', { enabled: false }),
  ], 'code'), [])
})

test('streaming generation never applies partial files after a provider error', () => {
  const route = readFileSync(new URL('../src/app/api/projects/[id]/generate-stream/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('if (streamFailure) throw new Error(streamFailure)'), 'stream failures must abort before file parsing and persistence')
})

test('normal and streaming completions share readiness-aware routing and native Anthropic streaming', () => {
  const router = readFileSync(new URL('../src/lib/llm/router.ts', import.meta.url), 'utf8')
  assert.ok(router.includes('rankProviders(providers, task, overrideKey)'), 'normal completion must use the shared candidate order')
  assert.ok(router.includes('rankProviders(await loadProviders(), task, overrideKey)'), 'streaming completion must use the same candidate order')
  assert.ok(router.includes("json.type === 'content_block_delta'"), 'Anthropic streaming must parse its native SSE events')
  assert.ok(router.includes("if (provider.key === 'anthropic')"), 'Anthropic must use its native messages API')
})

test('provider settings API requires authentication before returning configuration', () => {
  const route = readFileSync(new URL('../src/app/api/providers/route.ts', import.meta.url), 'utf8')
  assert.ok(route.includes('await requireSessionUser()'), 'provider metadata must not be public')
  assert.ok(route.includes('await requireAdmin()'), 'provider mutations must remain admin-only')
})
