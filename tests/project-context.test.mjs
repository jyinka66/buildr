import test from 'node:test'
import assert from 'node:assert/strict'
import { selectProjectContext, formatProjectContext, BUILD_CONTEXT_LIMITS } from '../src/lib/llm/project-context.ts'

const file = (path, content = 'x'.repeat(200)) => ({ path, content })
const LIMITS = { maxTotalChars: 1000, maxFileChars: 400, maxFiles: 3 }

test('a file the user names outranks everything else', () => {
  const files = [file('src/app/page.tsx'), file('src/components/Navbar.tsx'), file('src/lib/db.ts')]
  const ctx = selectProjectContext(files, 'the Navbar.tsx links are broken', LIMITS)
  assert.equal(ctx.shown[0].path, 'src/components/Navbar.tsx')
})

test('words in the request match path segments', () => {
  const files = [file('src/app/pricing/page.tsx'), file('src/app/about/page.tsx'), file('src/app/contact/page.tsx')]
  const ctx = selectProjectContext(files, 'redesign the pricing section', { ...LIMITS, maxFiles: 1 })
  assert.deepEqual(ctx.shown.map((f) => f.path), ['src/app/pricing/page.tsx'])
})

test('large files are listed as omitted, never truncated', () => {
  const big = file('src/app/big.tsx', 'y'.repeat(401))
  const ctx = selectProjectContext([big, file('src/app/small.tsx')], 'change big', LIMITS)
  assert.ok(!ctx.shown.some((f) => f.path === 'src/app/big.tsx'))
  assert.deepEqual(ctx.omitted.find((o) => o.path === 'src/app/big.tsx')?.reason, 'too_large')
  for (const f of ctx.shown) assert.ok(f.content.length <= LIMITS.maxFileChars)
})

test('respects the total budget and file count', () => {
  const files = Array.from({ length: 10 }, (_, i) => file(`src/f${i}.ts`, 'z'.repeat(300)))
  const ctx = selectProjectContext(files, 'anything', LIMITS)
  assert.ok(ctx.shown.length <= LIMITS.maxFiles)
  assert.ok(ctx.shown.reduce((n, f) => n + f.content.length, 0) <= LIMITS.maxTotalChars)
  assert.equal(ctx.shown.length + ctx.omitted.length, files.length)
})

test('lockfiles, images and build output are skipped', () => {
  const files = [file('package-lock.json'), file('public/logo.png'), file('.next/x.js'), file('src/app/page.tsx')]
  const ctx = selectProjectContext(files, 'hello', LIMITS)
  assert.deepEqual(ctx.shown.map((f) => f.path), ['src/app/page.tsx'])
})

test('key files are preferred when the request gives no hint', () => {
  const files = [file('src/lib/zzz.ts'), file('package.json'), file('src/app/page.tsx')]
  const ctx = selectProjectContext(files, 'make it nicer', { ...LIMITS, maxFiles: 2 })
  assert.deepEqual(new Set(ctx.shown.map((f) => f.path)), new Set(['package.json', 'src/app/page.tsx']))
})

test('selection is stable and never mutates the input', () => {
  const files = [file('b.ts'), file('a.ts')]
  const copy = JSON.stringify(files)
  const one = selectProjectContext(files, 'zzz', LIMITS)
  const two = selectProjectContext(files, 'zzz', LIMITS)
  assert.deepEqual(one, two)
  assert.equal(JSON.stringify(files), copy)
})

test('format keeps code fences safe and lists what was not shown', () => {
  const tricky = file('src/a.md', 'text with ``` inside')
  const big = file('src/big.ts', 'q'.repeat(500))
  const text = formatProjectContext(selectProjectContext([tricky, big], 'a', LIMITS))
  assert.match(text, /FILE: src\/a\.md\n~~~\ntext with ``` inside\n~~~/)
  assert.match(text, /FILES NOT SHOWN/)
  assert.match(text, /src\/big\.ts/)
})

test('empty project gives empty context', () => {
  const ctx = selectProjectContext([], 'hi', BUILD_CONTEXT_LIMITS)
  assert.equal(formatProjectContext(ctx), '')
})

import { buildEditPrompt } from '../src/lib/llm/project-context.ts'
import { buildChatSystemPrompt } from '../src/lib/llm/chat-prompts.ts'

test('edit prompt shows real code and keeps the JSON-array contract', () => {
  const prompt = buildEditPrompt([{ path: 'src/app/page.tsx', content: 'export default function Page() { return <h1>Hi</h1> }' }], 'change the heading')
  assert.match(prompt, /CURRENT CODE/)
  assert.match(prompt, /<h1>Hi<\/h1>/)
  assert.match(prompt, /Return ONLY a JSON array of files/)
  assert.match(prompt, /FULL new content/)
})

test('edit prompt for an empty project still works', () => {
  const prompt = buildEditPrompt([], 'build a todo app')
  assert.match(prompt, /\(none\)/)
  assert.ok(!prompt.includes('CURRENT CODE'))
})

test('project chat prompt includes the code only when provided', () => {
  const base = { name: 'App', stack: 'next', styling: 'tailwind', files: ['src/app/page.tsx'] }
  assert.ok(!buildChatSystemPrompt(base, true).includes('Current code'))
  const withCode = buildChatSystemPrompt({ ...base, code: 'FILE: src/app/page.tsx\n~~~\nhello\n~~~' }, true)
  assert.match(withCode, /Current code of the most relevant files/)
  assert.match(withCode, /hello/)
  assert.match(withCode, /\[\[BUILD\]\]/)
})
