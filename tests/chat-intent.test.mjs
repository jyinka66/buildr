import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyIntent } from '../src/lib/chat-intent.ts'

test('clear build commands', () => {
  for (const m of [
    'Add a login page with email and password',
    'please create a products list with search',
    'Can you add dark mode?',
    'change the header color to blue',
    'fix the broken signup button',
    'now make the cards bigger',
  ]) assert.equal(classifyIntent(m), 'build', m)
})

test('clear questions and planning', () => {
  for (const m of [
    'How is this project structured?',
    'What should I add next?',
    'explain the auth flow',
    'Is this secure?',
    'Can you explain how routing works?',
    'Why does the preview show a blank page?',
  ]) assert.equal(classifyIntent(m), 'chat', m)
})

test('unclear goes to the AI', () => {
  assert.equal(classifyIntent('hello'), 'unsure')
  assert.equal(classifyIntent('  '), 'unsure')
  assert.equal(classifyIntent('an e-commerce dashboard for my shop'), 'unsure')
})
