import test from 'node:test'
import assert from 'node:assert/strict'
import { isProviderReady, rankProviders } from '../src/lib/llm/routing-policy.ts'

const provider = (key, overrides = {}) => ({
  id: key,
  key,
  enabled: true,
  health: 'healthy',
  apiKey: key === 'zai' ? '(managed)' : 'configured-key',
  weight: 1,
  speciality: 'general',
  ...overrides,
})

test('router excludes disabled, offline, and unconfigured providers', () => {
  assert.equal(isProviderReady(provider('zai')), true)
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
