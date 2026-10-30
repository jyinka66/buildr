import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('Vercel config uses the pinned Bun lock and production build', async () => {
  const config = JSON.parse(await read('vercel.json'))
  assert.equal(config.framework, 'nextjs')
  assert.match(config.installCommand, /bun install --frozen-lockfile/)
  assert.match(config.buildCommand, /bun run build/)
})

test('production build creates a standalone server and static assets', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.match(pkg.scripts.build, /next build/)
  assert.match(pkg.scripts.build, /postbuild-standalone/)
  assert.match(pkg.scripts.start, /\.next\/standalone\/server\.js/)
  await access(new URL('scripts/postbuild-standalone.mjs', root))
})

test('Render blueprint includes web, API, sandbox and collaboration services', async () => {
  const config = await read('render.yaml')
  for (const service of ['buildr-web', 'buildr-api-runtime', 'buildr-sandbox-runner', 'buildr-collab']) {
    assert.ok(config.includes(`name: ${service}`), `missing ${service}`)
  }
  // Render resolves Dockerfile/context paths relative to each service's rootDir.
  assert.equal((config.match(/dockerfilePath: Dockerfile/g) || []).length, 3)
  assert.equal((config.match(/dockerContext: \./g) || []).length, 3)
  const sandboxService = config.match(/  - type: pserv\n([\s\S]*?)(?=\n  - type:|\s*$)/)?.[1]
  assert.ok(sandboxService, 'missing private sandbox-runner service')
  assert.ok(!sandboxService.includes('healthCheckPath:'), 'Render healthCheckPath is only supported for web services')
  assert.ok(config.includes('DOCKER_CLIENT_KEY_PEM'))
  assert.ok(config.includes('SANDBOX_RUNNER_TOKEN'))
})

test('Docker build contexts and sandbox entrypoint exist', async () => {
  const compose = await read('docker-compose.yml')
  const dockerfile = await read('mini-services/api-runtime/Dockerfile')
  assert.ok(compose.includes('PORT=3031'))
  assert.ok(dockerfile.includes('ENTRYPOINT ["/app/entrypoint.sh"]'))
  await access(new URL('mini-services/api-runtime/entrypoint.sh', root))
  await access(new URL('mini-services/api-runtime/sandbox-worker.ts', root))
})

test('GitHub Actions builds containers and publishes the sandbox worker', async () => {
  const workflow = await read('.github/workflows/production-build.yml')
  assert.ok(workflow.includes('bun run build'))
  assert.ok(workflow.includes('docker/build-push-action'))
  assert.ok(workflow.includes('publish-sandbox-worker'))
})
