import test from 'node:test'
import assert from 'node:assert/strict'

const base = process.env.SANDBOX_TEST_URL
const token = process.env.SANDBOX_RUNNER_TOKEN
const enabled = Boolean(base && token && token.length >= 32)
const options = enabled ? {} : { skip: 'Set SANDBOX_TEST_URL and SANDBOX_RUNNER_TOKEN to run against a built Docker sandbox runner.' }

async function execute(source, method = 'GET') {
  const response = await fetch(`${base.replace(/\/$/, '')}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-buildr-sandbox-token': token },
    body: JSON.stringify({
      routePath: 'src/app/api/test/route.ts',
      files: { 'src/app/api/test/route.ts': source },
      method,
      url: 'http://preview.invalid/api/test',
      body: null,
      headers: [],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  return { http: response.status, json: await response.json() }
}

test('sandbox runner rejects unauthenticated execution requests', options, async () => {
  const response = await fetch(`${base.replace(/\/$/, '')}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(response.status, 401)
})

test('sandbox executes a route in an isolated container', options, async () => {
  const result = await execute('export async function GET() { return Response.json({ sandbox: true }) }')
  assert.equal(result.http, 200)
  assert.equal(result.json.status, 200, JSON.stringify(result.json))
  assert.deepEqual(JSON.parse(result.json.body), { sandbox: true }, JSON.stringify(result.json))
})

test('sandbox container has no outbound network', options, async () => {
  const source = `export async function GET() { let blocked = false; try { await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(700) }) } catch { blocked = true }; return Response.json({ blocked }) }`
  const result = await execute(source)
  assert.equal(result.http, 200)
  assert.equal(JSON.parse(result.json.body).blocked, true, JSON.stringify(result.json))
})

test('sandbox execution timeout is enforced and the worker is killed', options, async () => {
  const result = await execute('export async function GET() { while (true) {} }')
  assert.equal(result.http, 504, JSON.stringify(result.json))
  assert.equal(result.json.error, 'execution_timeout')
})
