import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runtime = readFileSync(new URL('../mini-services/api-runtime/index.ts', import.meta.url), 'utf8')
const runner = readFileSync(new URL('../mini-services/api-runtime/sandbox-runner.ts', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../mini-services/api-runtime/sandbox-worker.ts', import.meta.url), 'utf8')
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8')

test('production runtime routes generated source only to the isolated runner and fails closed when missing', () => {
  assert.match(runtime, /SANDBOX_RUNNER_URL/)
  assert.match(runtime, /SANDBOX_RUNNER_TOKEN/)
  assert.match(runtime, /sandbox_not_configured/)
  assert.match(runtime, /fetch\(`\$\{runnerUrl\}\/execute`/)
  assert.match(runtime, /if \(isProduction\) \{[\s\S]*?SANDBOX_RUNNER_URL/)
})

test('sandbox runner enforces disposable no-network container and resource restrictions', () => {
  for (const control of ['--rm', '--network=none', '--read-only', '--user=1001:1001', '--memory=128m', '--cpus=0.50', '--pids-limit=32', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--ulimit=nofile=64:64', 'TIMEOUT_MS']) {
    assert.ok(runner.includes(control), `missing sandbox control: ${control}`)
  }
  assert.match(runner, /docker\(\['kill', id\]/)
  assert.match(runner, /x-buildr-sandbox-token/)
  assert.doesNotMatch(runner, /req\.json\(\).*image|payload\.image|payload\.command/)
})

test('sandbox worker has no production credentials or permissive unknown-module fallback', () => {
  assert.match(worker, /External integrations are disabled in the sandbox/)
  assert.match(worker, /Module is not permitted in sandbox/)
  assert.doesNotMatch(worker, /SUPABASE_SERVICE_ROLE_KEY|PAYSTACK_SECRET_KEY|SIDECAR_AUTH_TOKEN/)
  assert.match(compose, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/)
  assert.match(compose, /sandbox-runner:/)
  // Docker socket is attached only to the orchestrator service, never api-runtime.
  const runtimeService = compose.split('  api-runtime:')[1].split('  # ── Disposable generated-code sandbox orchestrator')[0]
  assert.doesNotMatch(runtimeService, /docker\.sock/)
})
