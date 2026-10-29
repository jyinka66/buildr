/** Minimal authenticated orchestrator. Each invocation gets a new locked-down container. */
import { randomUUID, timingSafeEqual } from 'node:crypto'

const PORT = Number(process.env.SANDBOX_RUNNER_PORT || 3031)
const TOKEN = process.env.SANDBOX_RUNNER_TOKEN || ''
const IS_PROD = process.env.NODE_ENV === 'production'
const IMAGE = process.env.SANDBOX_IMAGE || 'buildr-sandbox:local'
const MAX_INPUT_BYTES = 5 * 1024 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const TIMEOUT_MS = 12_000
const MAX_CONCURRENT_EXECUTIONS = 4
let activeExecutions = 0
if (IS_PROD && TOKEN.length < 32) { console.error('SANDBOX_RUNNER_TOKEN must be at least 32 characters'); process.exit(1) }

function authorized(req: Request) {
  const got = Buffer.from(req.headers.get('x-buildr-sandbox-token') || '')
  const want = Buffer.from(TOKEN)
  return want.length >= 32 && got.length === want.length && timingSafeEqual(got, want)
}
async function readLimited(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error('sandbox_output_limit_exceeded')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(merged)
}
async function docker(args: string[], stdin?: string, timeout = 5_000) {
  const proc = Bun.spawn(['docker', ...args], { stdin: stdin === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' } })
  if (stdin !== undefined) { proc.stdin.write(stdin); proc.stdin.end() }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timed = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('docker_timeout')), timeout) })
    const stdoutPromise = readLimited(proc.stdout, MAX_OUTPUT_BYTES + 1)
    const stderrPromise = readLimited(proc.stderr, 64 * 1024)
    const done = (async () => ({ code: await proc.exited, stdout: await stdoutPromise, stderr: await stderrPromise }))()
    return await Promise.race([done, timed]).catch(async (error) => { proc.kill(); throw error })
  } finally { if (timer) clearTimeout(timer) }
}
const server = Bun.serve({ port: PORT, async fetch(req) {
  const url = new URL(req.url)
  if (url.pathname === '/__health') return Response.json({ ok: true })
  if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (req.method !== 'POST' || url.pathname !== '/execute') return Response.json({ error: 'not_found' }, { status: 404 })
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_INPUT_BYTES) return Response.json({ error: 'payload_too_large' }, { status: 413 })
  const raw = await req.text()
  if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) return Response.json({ error: 'payload_too_large' }, { status: 413 })
  let payload: unknown
  try { payload = JSON.parse(raw) } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }
  if (activeExecutions >= MAX_CONCURRENT_EXECUTIONS) return Response.json({ error: 'sandbox_busy' }, { status: 503, headers: { 'retry-after': '2' } })
  activeExecutions += 1
  const id = `buildr-sbx-${randomUUID()}`
  let completed = false
  try {
    // Private GHCR images are supported when registry credentials are provided.
    // Credentials are sent on stdin and never logged; public images need no login.
    if (process.env.SANDBOX_REGISTRY_USERNAME && process.env.SANDBOX_REGISTRY_TOKEN) {
      const login = await docker(['login', 'ghcr.io', '--username', process.env.SANDBOX_REGISTRY_USERNAME, '--password-stdin'], `${process.env.SANDBOX_REGISTRY_TOKEN}\n`, 8_000)
      if (login.code !== 0) throw new Error('sandbox_registry_auth_failed')
    }
    const result = await docker([
      'run', '--rm', '--name', id, '--pull=missing', '--network=none', '--read-only', '--user=1001:1001',
      '--memory=128m', '--memory-swap=128m', '--cpus=0.50', '--pids-limit=32', '--ipc=private',
      '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
      '--ulimit=nofile=64:64', '--ulimit=fsize=1048576:1048576', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m,uid=1001,gid=1001',
      '--env=NODE_ENV=production', IMAGE, 'bun', 'run', '/app/sandbox-worker.ts'
    ], JSON.stringify(payload), TIMEOUT_MS)
    completed = true
    if (result.code !== 0) return Response.json({ error: 'sandbox_failed', detail: 'Execution container failed.' }, { status: 502 })
    if (Buffer.byteLength(result.stdout) > MAX_OUTPUT_BYTES) return Response.json({ error: 'sandbox_output_too_large' }, { status: 502 })
    let output: any
    try { output = JSON.parse(result.stdout) } catch { return Response.json({ error: 'invalid_sandbox_response' }, { status: 502 }) }
    if (!Number.isInteger(output.status) || output.status < 100 || output.status > 599 || typeof output.body !== 'string' || !output.headers || typeof output.headers !== 'object') return Response.json({ error: 'invalid_sandbox_response' }, { status: 502 })
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(output.headers)) {
      if (/^(connection|transfer-encoding|content-length|set-cookie)$/i.test(k) || typeof v !== 'string' || v.length > 8192) continue
      headers[k] = v
    }
    return Response.json({ status: output.status, body: output.body, headers }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    // Kill any still-running container before returning; never leave timed-out code behind.
    try { await docker(['kill', id], undefined, 2_000) } catch {}
    try { await docker(['rm', '-f', id], undefined, 2_000) } catch {}
    const timeout = error instanceof Error && error.message === 'docker_timeout'
    const outputLimit = error instanceof Error && error.message === 'sandbox_output_limit_exceeded'
    return Response.json({ error: timeout ? 'execution_timeout' : outputLimit ? 'sandbox_output_too_large' : 'sandbox_unavailable' }, { status: timeout ? 504 : outputLimit ? 502 : 503 })
  } finally {
    if (!completed) { try { await docker(['rm', '-f', id], undefined, 2_000) } catch {} }
    activeExecutions = Math.max(0, activeExecutions - 1)
  }
} })
console.log(`Buildr sandbox orchestrator listening on ${PORT}`)
export { server }
