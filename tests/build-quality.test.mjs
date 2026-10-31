import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePlan, batchPlanFiles, checkProject, shipReadyFiles, mergeEnvExample,
  detectEnvVars, summarizeExports, isSafeRelativePath, describeBuildResult,
} from '../src/lib/llm/build-quality.ts'

const planJson = JSON.stringify({
  summary: 'A task app.', features: ['Add tasks'],
  pages: [{ route: '/', purpose: 'List' }],
  dataModel: [{ name: 'Task', fields: ['id', 'title'] }],
  files: [
    { path: 'src/lib/types.ts', purpose: 'types' },
    { path: '../evil.ts', purpose: 'bad' },
    { path: '/abs.ts', purpose: 'bad' },
    { path: 'src/lib/types.ts', purpose: 'dup' },
    { path: 'src/app/page.tsx', purpose: 'home' },
  ],
  envVars: ['DATABASE_URL', 'bad name'],
})

test('parsePlan keeps safe unique paths and valid env vars', () => {
  const plan = parsePlan('Here you go:\n```json\n' + planJson + '\n```')
  assert.deepEqual(plan.files.map((f) => f.path), ['src/lib/types.ts', 'src/app/page.tsx'])
  assert.deepEqual(plan.envVars, ['DATABASE_URL'])
  assert.equal(plan.dataModel[0].name, 'Task')
})

test('parsePlan rejects junk', () => {
  assert.equal(parsePlan('no json'), null)
  assert.equal(parsePlan('{"files": []}'), null)
  assert.equal(parsePlan('{bad'), null)
})

test('safe path rules', () => {
  assert.ok(isSafeRelativePath('src/app/page.tsx'))
  assert.ok(!isSafeRelativePath('../x'))
  assert.ok(!isSafeRelativePath('a\\b'))
})

test('batching keeps order and caps batch count', () => {
  const files = Array.from({ length: 22 }, (_, i) => ({ path: `f${i}.ts`, purpose: '' }))
  const b = batchPlanFiles(files)
  assert.ok(b.length <= 4)
  assert.deepEqual(b.flat().map((f) => f.path), files.map((f) => f.path))
})

test('checkProject finds missing imports, packages, use client and default export', () => {
  const files = [
    { path: 'package.json', content: JSON.stringify({ dependencies: { react: '1', next: '1' } }) },
    { path: 'src/app/page.tsx', content: "import { Card } from '@/components/Card'\nimport x from 'left-pad'\nimport { useState } from 'react'\nexport function Page(){ const [a]=useState(0); return null }" },
    { path: 'src/lib/a.ts', content: "import { b } from './b'\nimport fs from 'node:fs'\nexport const a = b" },
  ]
  const msgs = checkProject(files, 'nextjs').map((i) => i.path + ': ' + i.message).join('\n')
  assert.match(msgs, /@\/components\/Card/)
  assert.match(msgs, /left-pad/)
  assert.match(msgs, /use client/)
  assert.match(msgs, /default export/)
  assert.match(msgs, /\.\/b/)
  assert.doesNotMatch(msgs, /node:fs/)
})

test('checkProject passes a clean project', () => {
  const files = [
    { path: 'package.json', content: JSON.stringify({ dependencies: { react: '1' } }) },
    { path: 'src/lib/b.ts', content: 'export const b = 1' },
    { path: 'src/components/Card.tsx', content: "'use client'\nimport { useState } from 'react'\nexport function Card(){ useState(0); return null }" },
    { path: 'src/app/page.tsx', content: "import { Card } from '@/components/Card'\nimport { b } from '../lib/b'\nexport default function P(){ return <Card /> }" },
  ]
  assert.deepEqual(checkProject(files, 'nextjs'), [])
})

test('placeholders and bad json are flagged', () => {
  const issues = checkProject([
    { path: 'src/x.ts', content: '// ...rest\nexport const a = 1' },
    { path: 'data.json', content: '{bad' },
  ], 'nextjs')
  assert.equal(issues.length, 2)
})

test('env detection and merge', () => {
  const files = [{ path: 'src/a.ts', content: 'process.env.API_KEY; process.env.NODE_ENV; import.meta.env.VITE_URL' }]
  assert.deepEqual(detectEnvVars(files), ['API_KEY', 'VITE_URL'])
  const merged = mergeEnvExample('DATABASE_URL=""\n', ['API_KEY', 'DATABASE_URL'])
  assert.match(merged, /API_KEY=""/)
  assert.equal(merged.match(/DATABASE_URL/g).length, 1)
})

test('shipReadyFiles adds production extras without overwriting', () => {
  const plan = parsePlan(planJson)
  const files = [
    { path: 'src/app/error.tsx', content: 'custom' },
    { path: '.env.example', content: 'DATABASE_URL=""\n' },
    { path: 'src/a.ts', content: 'process.env.STRIPE_KEY' },
  ]
  const out = shipReadyFiles(files, { name: 'Tasks', stack: 'nextjs', plan, integrations: [] })
  const paths = out.map((f) => f.path)
  assert.ok(paths.includes('README.md'))
  assert.ok(paths.includes('src/app/not-found.tsx'))
  assert.ok(paths.includes('src/app/loading.tsx'))
  assert.ok(paths.includes('.github/workflows/ci.yml'))
  assert.ok(!paths.includes('src/app/error.tsx'))
  assert.match(out.find((f) => f.path === '.env.example').content, /STRIPE_KEY/)
  assert.match(out.find((f) => f.path === 'README.md').content, /Task/)
})

test('summaries and messages', () => {
  assert.match(summarizeExports([{ path: 'a.ts', content: 'export function go(){}\nexport default 1' }]), /function go/)
  const msg = describeBuildResult({ plan: parsePlan(planJson), writtenPaths: ['a.ts'], total: 9, fixedIssues: 2, remainingIssues: [{ path: 'a.ts', message: 'x' }], skippedPaths: ['b.ts'] })
  assert.match(msg, /fixed 2 problems/)
  assert.match(msg, /Needs a look/)
  assert.match(msg, /continue building/)
})
