// Multi-LLM Router Engine (Module 1)
// ------------------------------------------------------------------
// Architecture: a provider registry where each provider declares a
// `speciality` (code | schema | docs | general), a `weight` for load
// balancing, and a `health` status for failover. The router selects the
// best healthy provider for a given task; if that provider fails it
// falls over to the next-best.
//
// Providers use server-side API keys and HTTP APIs. Legacy Z.ai rows are
// deliberately excluded so the old built-in provider cannot intercept chat.

import { db } from '@/lib/db'
import type {
  ProviderConfig,
  ProviderKey,
  TaskKind,
} from '@/lib/types'
import { rankProviders } from '@/lib/llm/routing-policy'

// ---------------------------------------------------------------------------
// Built-in provider catalogue. These are the defaults seeded into the DB.
// ---------------------------------------------------------------------------

interface ProviderCatalogEntry {
  key: ProviderKey
  name: string
  model: string
  speciality: TaskKind
  weight: number
  description: string
  baseUrl?: string
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    key: 'groq',
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    speciality: 'code',
    weight: 10,
    description: 'OpenAI-compatible Groq inference API. Add your own API key.',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    model: 'openrouter/free',
    speciality: 'code',
    weight: 9,
    description: 'OpenAI-compatible multi-provider API. Add your own API key.',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    key: 'anthropic',
    name: 'Anthropic Claude',
    model: 'claude-sonnet-5',
    speciality: 'code',
    weight: 9,
    description:
      'Claude 3.5 Sonnet. Preferred for complex code generation and refactors.',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    model: 'gpt-6.1-sol',
    speciality: 'schema',
    weight: 8,
    description: 'GPT-4o. Strong for schema generation and structured output.',
  },
  {
    key: 'google',
    name: 'Google Gemini',
    model: 'gemini-3.8-flash',
    speciality: 'docs',
    weight: 7,
    description:
      'Gemini 1.5 Pro. Large context window ideal for documentation analysis.',
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    model: 'deepseek-flash',
    speciality: 'code',
    weight: 6,
    description: 'DeepSeek Coder. Cost-effective code generation.',
  },
  {
    key: 'ollama',
    name: 'Ollama (Self-hosted)',
    model: 'llama3.1',
    speciality: 'general',
    weight: 4,
    description: 'Local/self-hosted models via Ollama. Bring your own endpoint.',
    baseUrl: 'http://localhost:11434',
  },
]

interface LlmProviderRow {
  id: string
  key: string
  name: string
  model: string
  api_key: string
  base_url: string | null
  enabled: boolean
  weight: number
  speciality: string
  health: string
  last_checked: string | null
}

// ---------------------------------------------------------------------------
// Seed: ensure the registry has all catalogue providers.
// Idempotent + cached — only runs once per process unless invalidated.
// ---------------------------------------------------------------------------

let _seeded = false

export async function seedProviders(): Promise<void> {
  if (_seeded) return // already seeded this process — skip the per-row queries
  // Idempotent upsert so concurrent boot calls don't race on the unique
  // `key` constraint. We only sync catalogue metadata (name/model/
  // speciality/baseUrl) on update — user customizations (apiKey, enabled,
  // weight, health) are preserved.
  for (const entry of PROVIDER_CATALOG) {
    const { data: existing } = await db
      .from('llm_providers')
      .select('id, model')
      .eq('key', entry.key)
      .maybeSingle()

    if (existing) {
      const legacyDefaultModels: Partial<Record<ProviderKey, string>> = {
        anthropic: 'claude-3-5-sonnet-20241022',
        openai: 'gpt-4o',
        google: 'gemini-1.5-pro',
        deepseek: 'deepseek-coder',
      }
      const update: Record<string, string> = { name: entry.name }
      // Upgrade only known retired catalogue defaults. Never overwrite a model
      // explicitly chosen by an administrator.
      if (legacyDefaultModels[entry.key] === existing.model) update.model = entry.model
      await db
        .from('llm_providers')
        .update(update)
        .eq('key', entry.key)
    } else {
      await db.from('llm_providers').insert({
        key: entry.key,
        name: entry.name,
        model: entry.model,
        speciality: entry.speciality,
        weight: entry.weight,
        base_url: entry.baseUrl ?? null,
        api_key: entry.key === 'zai' ? '(managed)' : '',
        enabled: entry.key === 'zai',
      })
    }
  }
  _seeded = true
}

// Allow callers to force a re-seed (e.g. after a provider is updated).
export function invalidateProviderCache(): void {
  _seeded = false
}

// ---------------------------------------------------------------------------
// Load all providers, sorted by weight desc.
// ---------------------------------------------------------------------------

export async function loadProviders(): Promise<ProviderConfig[]> {
  await seedProviders()
  const { data: rows, error } = await db
    .from('llm_providers')
    .select('*')
    .order('weight', { ascending: false })
    .order('name', { ascending: true })

  if (error || !rows) return []
  // Ignore legacy Z.ai rows, including the old managed-key configuration.
  return (rows as LlmProviderRow[]).filter((r) => r.key !== 'zai').map((r) => ({
    id: r.id,
    key: r.key as ProviderKey,
    name: r.name,
    model: r.model,
    apiKey: r.api_key,
    baseUrl: r.base_url,
    enabled: r.enabled,
    weight: r.weight,
    speciality: r.speciality as TaskKind,
    health: r.health as 'healthy' | 'degraded' | 'down',
    lastChecked: r.last_checked,
  }))
}

// ---------------------------------------------------------------------------
// Router: select the best provider for a task.
// Honours an explicit override, then speciality match, then weight.
// Only enabled, healthy, and credentialed providers are eligible.
// ---------------------------------------------------------------------------

export async function selectProvider(
  task: TaskKind,
  overrideKey?: ProviderKey | null,
): Promise<ProviderConfig> {
  const providers = await loadProviders()
  const ranked = rankProviders(providers, task, overrideKey)
  if (!ranked.length) {
    throw new Error('No AI provider is configured. Add a provider API key in Settings → LLM Providers.')
  }
  return ranked[0]
}

// ---------------------------------------------------------------------------
// Health ping — marks a provider healthy/degraded after a call.
// ---------------------------------------------------------------------------

export async function markProviderHealth(
  providerId: string,
  health: 'healthy' | 'degraded' | 'down',
): Promise<void> {
  await db
    .from('llm_providers')
    .update({ health, last_checked: new Date().toISOString() })
    .eq('id', providerId)
}

// ---------------------------------------------------------------------------
// Completion interface — every provider runner conforms to this signature.
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionOptions {
  temperature?: number
  maxTokens?: number
  // If true, the router will fall over to the next provider on failure.
  failover?: boolean
}

export interface CompletionResult {
  content: string
  provider: ProviderConfig
  tokens: number
  durationMs: number
}

// ---------------------------------------------------------------------------
// Generic OpenAI-compatible runner for Groq, OpenRouter, OpenAI, DeepSeek, Ollama and Gemini
// (Gemini's OpenAI-compat endpoint). Anthropic uses a different schema but we
// route it through its native messages API. This keeps the architecture
// honest: real HTTP routing works when keys are supplied.
// ---------------------------------------------------------------------------

// Default timeout for all LLM HTTP calls (30s). Prevents a slow provider
// from hanging the generation indefinitely.
const LLM_TIMEOUT_MS = 30_000

async function runOpenAICompat(
  messages: ChatMessage[],
  options: CompletionOptions,
  provider: ProviderConfig,
): Promise<string> {
  const base =
    provider.baseUrl ||
    (provider.key === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : provider.key === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : provider.key === 'openai'
      ? 'https://api.openai.com/v1'
      : provider.key === 'deepseek'
        ? 'https://api.deepseek.com'
        : provider.key === 'google'
          ? 'https://generativelanguage.googleapis.com/v1beta/openai'
          : provider.key === 'anthropic'
            ? 'https://api.anthropic.com/v1'
            : 'http://localhost:11434/v1')

  if (provider.key === 'anthropic') {
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const conv = messages.filter((m) => m.role !== 'system')
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: options.maxTokens ?? 4096,
        system,
        messages: conv.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return Array.isArray(data.content)
      ? data.content.map((c: { text?: string }) => c.text ?? '').join('')
      : ''
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0.4,
      ...(provider.key === 'openai'
        ? { max_completion_tokens: options.maxTokens ?? 4096 }
        : { max_tokens: options.maxTokens ?? 4096 }),
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${provider.name} error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ---------------------------------------------------------------------------
// Run a completion through a single provider.
// ---------------------------------------------------------------------------

async function runWithProvider(
  messages: ChatMessage[],
  options: CompletionOptions,
  provider: ProviderConfig,
): Promise<string> {
  if (!provider.apiKey || provider.apiKey.trim() === '' || provider.apiKey === '(managed)') {
    throw new Error(
      `Provider "${provider.name}" has no API key configured. Add a server-side key in Render or configure it in Settings → LLM Providers.`,
    )
  }
  return runOpenAICompat(messages, options, provider)
}

// ---------------------------------------------------------------------------
// Public entry point. Selects a provider, runs the completion, fails over
// to the next eligible provider if failover is enabled (default).
// ---------------------------------------------------------------------------

export async function complete(
  messages: ChatMessage[],
  task: TaskKind = 'code',
  options: CompletionOptions = {},
  overrideKey?: ProviderKey | null,
): Promise<CompletionResult> {
  const providers = await loadProviders()
  const candidates = rankProviders(providers, task, overrideKey)
  if (!candidates.length) {
    throw new Error('No configured LLM providers available. Configure and enable a provider API key in Settings → LLM Providers.')
  }

  const failover = options.failover !== false
  let lastErr: unknown = null

  for (const provider of candidates) {
    const start = Date.now()
    try {
      const content = await runWithProvider(messages, options, provider)
      if (!content.trim()) throw new Error(`${provider.name} returned an empty completion.`)
      const tokens = Math.ceil(
        messages.reduce((n, m) => n + m.content.length, 0) / 4 +
          content.length / 4,
      )
      await markProviderHealth(provider.id, 'healthy')
      return {
        content,
        provider,
        tokens,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      lastErr = err
      await markProviderHealth(provider.id, 'degraded')
      if (!failover) break
    }
  }

  const message =
    lastErr instanceof Error
      ? lastErr.message
      : 'All configured LLM providers failed for this request.'
  throw new Error(message)
}

// ---------------------------------------------------------------------------
// STREAMING completion — yields tokens as they arrive from the LLM.
// Used by /api/projects/[id]/generate-stream for real-time chat UX.
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: 'token'; content: string }
  | { type: 'status'; message: string }
  | { type: 'done'; provider: ProviderConfig; tokens: number; durationMs: number; fullContent: string }
  | { type: 'error'; message: string }

// Stream from an OpenAI-compatible provider (fetch with stream:true).
async function* runOpenAICompatStream(
  messages: ChatMessage[],
  options: CompletionOptions,
  provider: ProviderConfig,
): AsyncGenerator<string> {
  const base =
    provider.baseUrl ||
    (provider.key === 'groq'
      ? 'https://api.groq.com/openai/v1'
      : provider.key === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : provider.key === 'openai'
      ? 'https://api.openai.com/v1'
      : provider.key === 'deepseek'
        ? 'https://api.deepseek.com'
        : provider.key === 'google'
          ? 'https://generativelanguage.googleapis.com/v1beta/openai'
          : provider.key === 'anthropic'
            ? 'https://api.anthropic.com/v1'
            : 'http://localhost:11434/v1')

  if (provider.key === 'anthropic') {
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const conversation = messages.filter((m) => m.role !== 'system')
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: options.maxTokens ?? 4096,
        system,
        messages: conversation.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => '')).slice(0, 500)
      throw new Error(`Anthropic stream error ${res.status}${detail ? `: ${detail}` : ''}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
            yield json.delta.text
          }
        } catch {
          // Ignore non-JSON keepalives and unrelated SSE frames.
        }
      }
    }
    return
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0.4,
      ...(provider.key === 'openai'
        ? { max_completion_tokens: options.maxTokens ?? 4096 }
        : { max_tokens: options.maxTokens ?? 4096 }),
      stream: true,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => '')).slice(0, 500)
    throw new Error(`${provider.name} stream error ${res.status}${detail ? `: ${detail}` : ''}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch {
          // Skip malformed lines.
        }
      }
    }
  }
}

// Public streaming entry point. Selects a provider, yields token events,
// then a 'done' event with the full content + provider metadata.
export async function* completeStream(
  messages: ChatMessage[],
  task: TaskKind = 'code',
  options: CompletionOptions = {},
  overrideKey?: ProviderKey | null,
): AsyncGenerator<StreamEvent> {
  const candidates = rankProviders(await loadProviders(), task, overrideKey)
  if (!candidates.length) {
    yield { type: 'error', message: 'No configured LLM providers available. Configure a provider API key or enable the built-in Z.ai provider.' }
    return
  }

  let lastErr: unknown = null
  const failover = options.failover !== false

  for (const provider of candidates) {
    const start = Date.now()
    let fullContent = ''
    try {
      const tokenStream = runOpenAICompatStream(messages, options, provider)

      for await (const token of tokenStream) {
        fullContent += token
        yield { type: 'token', content: token }
      }
      if (!fullContent.trim()) throw new Error(`${provider.name} returned an empty stream.`)

      await markProviderHealth(provider.id, 'healthy')
      const tokens = Math.ceil(
        messages.reduce((n, m) => n + m.content.length, 0) / 4 + fullContent.length / 4,
      )
      yield { type: 'done', provider, tokens, durationMs: Date.now() - start, fullContent }
      return
    } catch (err) {
      lastErr = err
      await markProviderHealth(provider.id, 'degraded')
      // Retrying after output has reached the client would duplicate or corrupt
      // generated files. Fail over only when the provider failed before its
      // first token; otherwise report the partial-stream failure clearly.
      if (fullContent.length > 0 || !failover) {
        yield {
          type: 'error',
          message: err instanceof Error ? err.message : 'stream_failed',
        }
        return
      }
    }
  }

  yield {
    type: 'error',
    message: lastErr instanceof Error ? lastErr.message : 'All configured LLM providers failed for this stream.',
  }
}
