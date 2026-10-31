import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MAX_CONTENT_CHARS,
  MAX_MESSAGES,
  MAX_TITLE_CHARS,
  deriveTitle,
  isMissingTableError,
  sanitizeMessages,
  sanitizeTitle,
} from '../src/lib/chat-history.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('sanitizeMessages rejects non-arrays and drops invalid entries', () => {
  assert.equal(sanitizeMessages('nope'), null)
  assert.equal(sanitizeMessages({}), null)
  const out = sanitizeMessages([
    null,
    42,
    { role: 'system', content: 'x' },
    { role: 'user', content: 123 },
    { role: 'user', content: '   ' },
    { role: 'user', id: 'a', content: 'hello' },
  ])
  assert.deepEqual(out, [{ id: 'a', role: 'user', content: 'hello' }])
})

test('sanitizeMessages caps lengths and count and keeps the latest messages', () => {
  const long = sanitizeMessages([{ role: 'user', id: 'a', content: 'x'.repeat(MAX_CONTENT_CHARS + 500) }])
  assert.equal(long[0].content.length, MAX_CONTENT_CHARS)

  const many = sanitizeMessages(
    Array.from({ length: MAX_MESSAGES + 25 }, (_, i) => ({ role: 'user', id: `m${i}`, content: `msg ${i}` })),
  )
  assert.equal(many.length, MAX_MESSAGES)
  assert.equal(many[many.length - 1].id, `m${MAX_MESSAGES + 24}`)
})

test('sanitizeMessages keeps reasoning and assigns ids when missing or oversized', () => {
  const out = sanitizeMessages([
    { role: 'assistant', content: 'answer', thinking: 'because', thinkingMs: 1234.6 },
    { role: 'assistant', content: '', thinking: 'only reasoning', id: 'y'.repeat(100) },
    { role: 'assistant', content: '', thinking: '   ' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].thinking, 'because')
  assert.equal(out[0].thinkingMs, 1235)
  assert.equal(out[0].id, 'm-0')
  assert.equal(out[1].id, 'm-1')
  assert.ok(!('thinkingMs' in out[1]))
})

test('sanitizeTitle collapses whitespace, caps length and rejects empties', () => {
  assert.equal(sanitizeTitle('  My   plan \n for app '), 'My plan for app')
  assert.equal(sanitizeTitle('a'.repeat(500)).length, MAX_TITLE_CHARS)
  assert.equal(sanitizeTitle('   '), null)
  assert.equal(sanitizeTitle(undefined), null)
  assert.equal(sanitizeTitle(7), null)
})

test('deriveTitle uses the first user message, truncated', () => {
  assert.equal(deriveTitle([]), 'New chat')
  assert.equal(deriveTitle([{ id: 'a', role: 'assistant', content: 'hi' }]), 'New chat')
  assert.equal(deriveTitle([{ id: 'a', role: 'user', content: 'Plan\n a   booking app' }]), 'Plan a booking app')
  const t = deriveTitle([{ id: 'a', role: 'user', content: 'word '.repeat(50) }])
  assert.ok(t.length <= 60 && t.endsWith('...'))
})

test('isMissingTableError recognises a missing ai_chats table only', () => {
  assert.equal(isMissingTableError(null), false)
  assert.equal(isMissingTableError({ code: '42P01' }), true)
  assert.equal(isMissingTableError({ code: 'PGRST205' }), true)
  assert.equal(isMissingTableError({ message: 'relation "public.ai_chats" does not exist' }), true)
  assert.equal(isMissingTableError({ code: '23505', message: 'duplicate key' }), false)
})

test('chat history routes require a session and scope every query to the user', () => {
  const list = read('../src/app/api/chats/route.ts')
  const one = read('../src/app/api/chats/[id]/route.ts')
  for (const src of [list, one]) {
    assert.match(src, /requireSessionUser/)
    assert.match(src, /status: 401/)
  }
  // Every table query in the [id] route matches on the id AND the session user.
  const idQueries = one.match(/\.from\('ai_chats'\)[\s\S]*?(?=\n\s*\n|\n  if|\n  const \{)/g) ?? []
  assert.ok(idQueries.length >= 4)
  for (const q of idQueries) {
    assert.match(q, /\.eq\('user_id', user\.id\)/)
  }
  // The list and create queries are scoped to the user too.
  assert.match(list, /\.eq\('user_id', user\.id\)/)
  assert.match(list, /user_id: user\.id/)
})

test('chat history is independent of project chat and the build route', () => {
  for (const rel of [
    '../src/app/api/chats/route.ts',
    '../src/app/api/chats/[id]/route.ts',
    '../src/lib/chats-client.ts',
  ]) {
    const src = read(rel)
    assert.doesNotMatch(src, /generate-stream|project_files|from\('projects'\)|generations/)
  }
  // Without the table the UI keeps working on browser storage.
  const view = read('../src/components/builder/ai-chat-view.tsx')
  assert.match(view, /setHistoryMode\('off'\)/)
  assert.match(view, /saveLocalMessages/)
})

test('the migration creates a user-scoped, locked-down ai_chats table', () => {
  const sql = read('../supabase/migrations/20261031000000_add_ai_chats.sql')
  assert.match(sql, /create table if not exists public\.ai_chats/)
  assert.match(sql, /user_id\s+text not null references public\.users\(id\) on delete cascade/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all privileges on table public\.ai_chats from anon, authenticated/)
})

test('buildProjectSeed names the project from the first question and carries the plan', async () => {
  const { buildProjectSeed, PROJECT_PROMPT_MAX_CHARS } = await import('../src/lib/chat-history.ts')
  const empty = buildProjectSeed([])
  assert.deepEqual(empty, { name: 'My app', prompt: '' })

  const seed = buildProjectSeed([
    { id: '1', role: 'user', content: 'Plan a booking app\nfor tailors in Lagos with payments' },
    { id: '2', role: 'assistant', content: 'Pages: home, booking, admin.', thinking: 'secret reasoning' },
  ])
  assert.ok(seed.name.length <= 40)
  assert.match(seed.name, /^Plan a booking app/)
  assert.match(seed.prompt, /^Build the app we planned/)
  assert.match(seed.prompt, /User: Plan a booking app/)
  assert.match(seed.prompt, /Assistant: Pages: home, booking, admin\./)
  assert.doesNotMatch(seed.prompt, /secret reasoning/)
})

test('buildProjectSeed keeps the most recent messages within the prompt budget', async () => {
  const { buildProjectSeed, PROJECT_PROMPT_MAX_CHARS } = await import('../src/lib/chat-history.ts')
  const msgs = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    role: i % 2 ? 'assistant' : 'user',
    content: `turn ${i} ` + 'x'.repeat(2000),
  }))
  const { prompt } = buildProjectSeed(msgs)
  assert.ok(prompt.length <= PROJECT_PROMPT_MAX_CHARS)
  assert.match(prompt, /turn 11 /)
  assert.doesNotMatch(prompt, /turn 0 /)
})

test('Build this app reuses the New project dialog and leaves the builder untouched', () => {
  const view = read('../src/components/builder/ai-chat-view.tsx')
  assert.match(view, /<NewProjectDialog/)
  assert.match(view, /buildProjectSeed/)
  assert.doesNotMatch(view, /generate-stream|createProject\(/)
  // The dialog's new props are optional, so the dashboard's use is unchanged.
  const dialog = read('../src/components/builder/new-project-dialog.tsx')
  assert.match(dialog, /initialName\?: string/)
  assert.match(dialog, /initialPrompt\?: string/)
  assert.match(dialog, /initialName = ''/)
})

test('groupByRecency buckets chats like a sidebar', async () => {
  const { groupByRecency } = await import('../src/lib/chat-history.ts')
  const now = new Date('2026-10-31T15:00:00').getTime()
  const iso = (d) => new Date(now - d * 24 * 3600 * 1000).toISOString()
  const groups = groupByRecency(
    [{ updatedAt: iso(0.01) }, { updatedAt: iso(1) }, { updatedAt: iso(4) }, { updatedAt: iso(30) }, { updatedAt: 'bad' }],
    now,
  )
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', 'Previous 7 days', 'Older'])
  assert.equal(groups[3].items.length, 2)
})
