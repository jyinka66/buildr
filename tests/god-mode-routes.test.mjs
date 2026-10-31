import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const routes = {
  list: read('../src/app/api/god-mode/route.ts'),
  one: read('../src/app/api/god-mode/[id]/route.ts'),
  step: read('../src/app/api/god-mode/[id]/step/route.ts'),
  status: read('../src/app/api/god-mode/[id]/status/route.ts'),
  tick: read('../src/app/api/god-mode/tick/route.ts'),
}
const runner = read('../src/lib/god-mode/runner.ts')

test('every God Mode route except the cron tick requires a session', () => {
  for (const [name, src] of Object.entries(routes)) {
    if (name === 'tick') continue
    assert.match(src, /authenticate\(\)/, `${name} must authenticate`)
    assert.match(src, /instanceof NextResponse\) return user/, `${name} must return the 401`)
  }
})

test('goal queries are always scoped to the signed-in user', () => {
  // [id], step and status read/modify a goal by id: every goal query in them
  // must carry an owner constraint (as many owner filters as goal queries).
  for (const [name, src] of [['one', routes.one], ['step', routes.step], ['status', routes.status]]) {
    const queries = (src.match(/\.from\('god_mode_goals'\)/g) ?? []).length
    const owned = (src.match(/\.eq\('owner_id', (?:user\.id|ownerId)\)/g) ?? []).length
    assert.ok(queries > 0, name)
    assert.ok(owned >= queries, `${name}: ${queries} goal queries but only ${owned} owner filters`)
  }
  assert.match(routes.list, /\.eq\('owner_id', user\.id\)/)
  assert.match(routes.list, /owner_id: user\.id/)
  // The runner's reads and writes carry the owner too.
  assert.match(runner, /\.eq\('owner_id', ownerId\)/)
})

test('approving claims the plan atomically and charges quotas', () => {
  assert.match(routes.one, /\.eq\('status', 'planned'\)\s*\n?\s*\.select/)
  assert.match(routes.one, /checkLimit\(user\.id, 'godmode_goals'\)/)
  assert.match(routes.one, /checkLimit\(user\.id, 'projects'\)/)
  assert.match(routes.one, /reservationId: goalLimit\.reservationId/)
  assert.match(routes.one, /releaseUsageReservation/)
})

test('plan creation is only a plan: it never builds, and it is metered and rate limited', () => {
  assert.match(routes.list, /status: 'planned'/)
  assert.doesNotMatch(routes.list, /generateInitialProject|generateIncremental|from\('projects'\)/)
  assert.match(routes.list, /checkLimit\(user\.id, 'llm_tokens'\)/)
  assert.match(routes.list, /tooManyRequests\(/)
})

test('the runner takes a lease, saves with an optimistic check, and never touches cancelled goals', () => {
  assert.match(runner, /lease_until\.is\.null,lease_until\.lt\./)
  assert.match(runner, /\.eq\('status', 'running'\)/)
  assert.match(runner, /\.eq\('updated_at', current\.updated_at\)/)
  assert.match(runner, /\.neq\('status', 'cancelled'\)/)
  assert.match(runner, /releaseLease\(goalId\)/)
  assert.match(runner, /checkLimit\(ownerId, 'llm_tokens'\)/)
  assert.match(runner, /trackUsage\(ownerId, 'llm_tokens'/)
})

test('the runner only performs automatic tasks; deploy, images and manual work wait for a person', () => {
  const plan = read('../src/lib/god-mode/plan.ts')
  assert.match(plan, /USER_TOOLS[^=]*= new Set\(\['image-generator', 'deploy', 'manual'\]\)/)
  // The runner has no publishing code path at all.
  assert.doesNotMatch(runner, /api\/deploy|from\('deployments'\)|netlify|vercel/i)
  assert.match(runner, /next\.kind === 'needs_user'/)
})

test('the cron tick is off without a secret and compares it in constant time', () => {
  assert.match(routes.tick, /process\.env\.GOD_MODE_CRON_SECRET/)
  assert.match(routes.tick, /if \(!secret\) return NextResponse\.json\(\{ error: 'not_found' \}, \{ status: 404 \}\)/)
  assert.match(routes.tick, /timingSafeEqual/)
})

test('God Mode stays separate from the builder and uses the shared model router', () => {
  for (const src of [...Object.values(routes), runner]) {
    assert.doesNotMatch(src, /generate-stream|z-ai-web-dev-sdk/)
  }
  assert.match(runner, /from '@\/lib\/llm\/router'/)
  assert.match(runner, /generateIncremental/)
})

test('the migration adds the lease column', () => {
  const sql = read('../supabase/migrations/20261031010000_god_mode_runner.sql')
  assert.match(sql, /add column if not exists lease_until timestamptz/)
})

test('the page drives running goals and offers review, retry, skip and cancel', () => {
  const view = read('../src/components/builder/god-mode-view.tsx')
  assert.match(view, /godMode\.step\(runningId\)/)
  assert.match(view, /'complete' \| 'skip' \| 'retry'/)
  assert.match(view, /Cancel goal/)
  assert.match(view, /<PlanEditor/)
  const editor = read('../src/components/builder/god-mode-plan-editor.tsx')
  assert.match(editor, /godMode\.approve\(goalId\)/)
  assert.match(editor, /godMode\.updatePlan/)
})
