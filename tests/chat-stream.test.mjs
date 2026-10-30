import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ThinkTagParser } from '../src/lib/llm/think-parser.ts'
import { BUILD_MARKER, classifyReplyHead } from '../src/lib/llm/chat-prompts.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

function run(chunks) {
  const parser = new ThinkTagParser()
  const out = []
  for (const c of chunks) out.push(...parser.feed(c))
  out.push(...parser.flush())
  const join = (kind) => out.filter((p) => p.kind === kind).map((p) => p.text).join('')
  return { thinking: join('thinking'), text: join('text') }
}

test('think parser separates reasoning from the answer', () => {
  const r = run(['<think>plan the', ' steps</think>', '\n\nHere is the answer.'])
  assert.equal(r.thinking, 'plan the steps')
  assert.equal(r.text, 'Here is the answer.')
})

test('think parser handles tags split across chunks', () => {
  const r = run(['<th', 'ink>reason', 'ing</thi', 'nk>Answer'])
  assert.equal(r.thinking, 'reasoning')
  assert.equal(r.text, 'Answer')
})

test('think parser supports <thinking> tags', () => {
  const r = run(['<thinking>hmm</thinking>done'])
  assert.equal(r.thinking, 'hmm')
  assert.equal(r.text, 'done')
})

test('think parser passes plain answers through untouched', () => {
  const r = run(['Hello ', 'there, ', 'friend.'])
  assert.equal(r.thinking, '')
  assert.equal(r.text, 'Hello there, friend.')
})

test('think parser ignores think tags that do not open the response', () => {
  const code = 'Use <think> as a tag name: <think>x</think> is just text.'
  const r = run([code])
  assert.equal(r.thinking, '')
  assert.equal(r.text, code)
})

test('think parser does not swallow text that merely starts like a tag', () => {
  const r = run(['<th', 'ere is a table'])
  assert.equal(r.thinking, '')
  assert.equal(r.text, '<there is a table')
})

test('think parser releases unterminated reasoning when the stream ends', () => {
  const r = run(['<think>still thinking when cut off'])
  assert.equal(r.thinking, 'still thinking when cut off')
  assert.equal(r.text, '')
})

test('build marker detection waits, hands off, or chats correctly', () => {
  assert.equal(classifyReplyHead(''), 'wait')
  assert.equal(classifyReplyHead('  \n'), 'wait')
  assert.equal(classifyReplyHead('[['), 'wait')
  assert.equal(classifyReplyHead('[[BUILD'), 'wait')
  assert.equal(classifyReplyHead(BUILD_MARKER), 'build')
  assert.equal(classifyReplyHead('\n' + BUILD_MARKER + '\n'), 'build')
  assert.equal(classifyReplyHead('Sure, here is how'), 'chat')
  assert.equal(classifyReplyHead('[[something else]]'), 'chat')
  assert.equal(classifyReplyHead('[link](https://x.y)'), 'chat')
})

test('chat endpoints require authentication and meter usage', () => {
  const general = read('../src/app/api/chat/stream/route.ts')
  const project = read('../src/app/api/projects/[id]/chat-stream/route.ts')
  for (const route of [general, project]) {
    assert.ok(route.includes('await requireSessionUser()'), 'chat must require a session')
    assert.ok(route.includes("checkLimit(user.id, 'llm_tokens')"), 'chat must respect the plan token limit')
    assert.ok(route.includes('rateLimit('), 'chat must be rate limited')
  }
  assert.ok(project.includes('project.owner_id !== user.id'), 'project chat must verify ownership')
})

test('project chat never writes project files and the build route is not coupled to chat', () => {
  const project = read('../src/app/api/projects/[id]/chat-stream/route.ts')
  assert.ok(!project.includes("from('project_files').upsert"), 'chat must not upsert files')
  assert.ok(!project.includes("from('project_files').insert"), 'chat must not insert files')
  assert.ok(!project.includes("from('project_files').delete"), 'chat must not delete files')

  const build = read('../src/app/api/projects/[id]/generate-stream/route.ts')
  assert.ok(!build.includes('chat-sse') && !build.includes('chat-prompts'), 'build route must stay independent of chat')
  assert.ok(build.includes('You NEVER') === false, 'build route keeps its own prompt in code-generator')
})

test('reasoning and abort handling are opt-in so code generation requests are unchanged', () => {
  const router = read('../src/lib/llm/router.ts')
  assert.ok(router.includes('options.reasoning ? new ThinkTagParser() : null'), 'think parsing must be gated on options.reasoning')
  assert.ok(router.includes("options.reasoning &&\n            json.type === 'content_block_delta'"), 'Anthropic thinking events must be gated on options.reasoning')
  assert.ok(router.includes('if (options.signal?.aborted) return'), 'a user stop must not mark a provider degraded')
  const build = read('../src/app/api/projects/[id]/generate-stream/route.ts')
  assert.ok(!build.includes('reasoning'), 'build route must not enable reasoning')
})
