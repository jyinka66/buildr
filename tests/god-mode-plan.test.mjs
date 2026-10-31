import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ATTEMPTS,
  MAX_INSTRUCTION_CHARS,
  MAX_TASKS,
  applyPlanEdit,
  buildTaskInstruction,
  computeProgress,
  describeGoal,
  settleFailure,
  deriveGoalStatus,
  extractPlan,
  failTask,
  finishTask,
  normalizeTasks,
  pickNextStep,
  readJson,
  recoverStaleTasks,
  resolveTask,
  startTask,
  waitOnTask,
} from '../src/lib/god-mode/plan.ts'

const NOW = '2026-10-31T00:00:00.000Z'
const T = (id, tool, deps = [0], status = 'pending') => ({
  id, name: `task ${id}`, description: '', tool, dependencies: deps, estimatedMinutes: 5, status,
})

test('normalizeTasks always starts with the scaffold task and makes every task depend on it', () => {
  const out = normalizeTasks([{ id: 1, name: 'Pages', tool: 'code-generator' }, { id: 2, name: 'SEO', tool: 'seo', dependencies: [1] }])
  assert.equal(out[0].id, 0)
  assert.equal(out[0].tool, 'scaffold')
  assert.deepEqual(out[1].dependencies, [0])
  assert.deepEqual(out[2].dependencies, [0, 1])
  assert.ok(out.every((t) => t.status === 'pending'))
  assert.deepEqual(normalizeTasks('nope').map((t) => t.id), [0])
})

test('normalizeTasks drops forward, self and unknown dependencies so cycles cannot exist', () => {
  const out = normalizeTasks([
    { id: 1, name: 'A', tool: 'code-generator', dependencies: [2, 1, 99, 'x'] },
    { id: 2, name: 'B', tool: 'code-generator', dependencies: [1, 2] },
  ])
  assert.deepEqual(out[1].dependencies, [0])
  assert.deepEqual(out[2].dependencies, [0, 1])
})

test('normalizeTasks repairs ids, tools, text and sizes', () => {
  const out = normalizeTasks([
    { id: 5, name: 'First', tool: 'code-generator' },
    { id: 5, name: 'Duplicate id', tool: 'telepathy' },
    { id: 'abc', name: '  Spaced   out  ', description: 'd'.repeat(900), tool: 'scaffold', estimatedMinutes: 99999 },
    { name: '', tool: 'seo' },
    null,
  ])
  const ids = out.map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(out.length, 4)
  assert.equal(out[2].tool, 'manual')
  assert.equal(out[3].name, 'Spaced out')
  assert.equal(out[3].tool, 'code-generator')
  assert.equal(out[3].description.length, 400)
  assert.equal(out[3].estimatedMinutes, 240)
})

test('normalizeTasks caps the plan size', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `t${i}`, tool: 'code-generator' }))
  assert.equal(normalizeTasks(many).length, MAX_TASKS)
})

test('extractPlan reads JSON wrapped in prose and rejects empty plans', () => {
  const text = 'Here you go:\n```json\n{"summary":"A shop","tasks":[{"id":1,"name":"Catalog","tool":"code-generator"}],"deliverables":["site"],"successCriteria":["works"]}\n```'
  const plan = extractPlan(text)
  assert.equal(plan.summary, 'A shop')
  assert.equal(plan.tasks.length, 2)
  assert.deepEqual(plan.deliverables, ['site'])
  assert.equal(extractPlan('no json here'), null)
  assert.equal(extractPlan('{"summary":"x","tasks":[]}'), null)
  assert.equal(extractPlan('{bad json}'), null)
})

test('applyPlanEdit keeps the scaffold first and needs at least one real task', () => {
  assert.equal(applyPlanEdit([]), null)
  assert.equal(applyPlanEdit('x'), null)
  const out = applyPlanEdit([{ id: 3, name: 'B', tool: 'seo' }, { id: 1, name: 'A', tool: 'code-generator', dependencies: [3] }])
  assert.equal(out[0].tool, 'scaffold')
  assert.deepEqual(out.map((t) => t.name), ['Scaffold the project', 'B', 'A'])
  // A depended on B, which now comes earlier, so that dependency is kept.
  assert.deepEqual(out[2].dependencies, [0, 3])
})

test('pickNextStep runs tasks in dependency order and stops for tasks that need the user', () => {
  let tasks = [T(0, 'scaffold', []), T(1, 'code-generator'), T(2, 'deploy', [0, 1])]
  assert.equal(pickNextStep(tasks).task.id, 0)
  tasks = startTask(tasks, 0, NOW)
  assert.equal(pickNextStep(tasks).kind, 'busy')
  tasks = finishTask(tasks, 0, 'ok', NOW)
  assert.equal(pickNextStep(tasks).task.id, 1)
  tasks = finishTask(startTask(tasks, 1, NOW), 1, 'ok', NOW)
  const next = pickNextStep(tasks)
  assert.equal(next.kind, 'needs_user')
  assert.equal(next.task.id, 2)
  tasks = waitOnTask(tasks, 2)
  assert.equal(pickNextStep(tasks).kind, 'waiting')
  tasks = resolveTask(tasks, 2, 'complete', NOW)
  assert.equal(pickNextStep(tasks).kind, 'done')
})

test('a failed task blocks everything behind it until it is retried', () => {
  let tasks = [T(0, 'scaffold', []), T(1, 'code-generator'), T(2, 'seo', [0, 1])]
  tasks = failTask(startTask(finishTask(startTask(tasks, 0, NOW), 0, 'ok', NOW), 1, NOW), 1, 'model error', NOW)
  assert.equal(pickNextStep(tasks).kind, 'failed')
  assert.equal(resolveTask(tasks, 2, 'retry', NOW), null)
  const retried = resolveTask(tasks, 1, 'retry', NOW)
  assert.equal(retried.find((t) => t.id === 1).status, 'pending')
  assert.equal(retried.find((t) => t.id === 1).attempts, 0)
  assert.equal(pickNextStep(retried).task.id, 1)
})

test('resolveTask only lets a person settle tasks that cannot run on their own', () => {
  const tasks = [T(0, 'scaffold', [], 'completed'), T(1, 'code-generator'), T(2, 'manual', [0], 'waiting'), T(3, 'deploy')]
  assert.equal(resolveTask(tasks, 1, 'complete', NOW), null) // automatic task: the runner does it
  assert.equal(resolveTask(tasks, 9, 'skip', NOW), null)
  assert.equal(resolveTask(tasks, 2, 'skip', NOW).find((t) => t.id === 2).status, 'skipped')
  assert.equal(resolveTask(tasks, 3, 'complete', NOW).find((t) => t.id === 3).status, 'completed')
  assert.equal(resolveTask(tasks, 0, 'retry', NOW), null) // only failed tasks can be retried
})

test('deriveGoalStatus follows the tasks but never overrides planned or cancelled', () => {
  const done = [T(0, 'scaffold', [], 'completed'), T(1, 'seo', [0], 'skipped')]
  assert.equal(deriveGoalStatus('running', done), 'completed')
  assert.equal(deriveGoalStatus('planned', done), 'planned')
  assert.equal(deriveGoalStatus('cancelled', done), 'cancelled')
  assert.equal(deriveGoalStatus('running', [T(0, 'scaffold', [], 'completed'), T(1, 'manual')]), 'waiting')
  assert.equal(deriveGoalStatus('running', [T(0, 'scaffold', [], 'failed'), T(1, 'seo')]), 'failed')
  assert.equal(deriveGoalStatus('running', [T(0, 'scaffold', [], 'running')]), 'running')
  assert.equal(deriveGoalStatus('waiting', [T(0, 'scaffold', [], 'completed'), T(1, 'seo')]), 'running')
})

test('recoverStaleTasks retries an interrupted task, then gives up after MAX_ATTEMPTS', () => {
  let tasks = [T(0, 'scaffold', [])]
  tasks = startTask(tasks, 0, NOW)
  tasks = recoverStaleTasks(tasks, NOW)
  assert.equal(tasks[0].status, 'pending')
  for (let i = 1; i < MAX_ATTEMPTS; i++) tasks = startTask(tasks, 0, NOW)
  tasks = recoverStaleTasks(tasks, NOW)
  assert.equal(tasks[0].status, 'failed')
})

test('computeProgress counts finished and skipped tasks and names the active one', () => {
  const tasks = [T(0, 'scaffold', [], 'completed'), T(1, 'seo', [0], 'skipped'), T(2, 'code-generator', [0], 'running'), T(3, 'seed')]
  assert.deepEqual(computeProgress(tasks), { completedTasks: 2, totalTasks: 4, currentTask: 'task 2' })
  assert.equal(computeProgress([T(0, 'scaffold', [], 'completed')]).currentTask, null)
})

test('readJson accepts stringified, parsed and missing values', () => {
  assert.deepEqual(readJson('[1,2]', []), [1, 2])
  assert.deepEqual(readJson([3], []), [3])
  assert.deepEqual(readJson('not json', ['x']), ['x'])
  assert.deepEqual(readJson(null, {}), {})
})

test('buildTaskInstruction carries the goal, finished work and the task, within the size limit', () => {
  const tasks = [T(0, 'scaffold', [], 'completed'), { ...T(1, 'seo'), description: 'Do SEO well' }]
  const text = buildTaskInstruction('Sell shoes online', 'A shoe shop', tasks[1], tasks)
  assert.match(text, /Sell shoes online/)
  assert.match(text, /Already done:\n- task 0/)
  assert.match(text, /Current task: task 1/)
  assert.match(text, /Do SEO well/)
  assert.match(text, /meta descriptions/)
  const long = buildTaskInstruction('g'.repeat(5000), 's'.repeat(5000), tasks[1], tasks)
  assert.ok(long.length <= MAX_INSTRUCTION_CHARS)
})

test('settleFailure retries while attempts remain, then fails the task', () => {
  let tasks = [T(0, 'scaffold', [])]
  tasks = settleFailure(startTask(tasks, 0, NOW), 0, 'timeout', NOW)
  assert.equal(tasks[0].status, 'pending')
  assert.match(tasks[0].note, /Attempt 1 failed: timeout/)
  for (let i = 1; i < MAX_ATTEMPTS; i++) tasks = startTask(tasks, 0, NOW)
  tasks = settleFailure(tasks, 0, 'timeout again', NOW)
  assert.equal(tasks[0].status, 'failed')
  assert.equal(tasks[0].note, 'timeout again')
})

test('describeGoal gives an honest sentence for every state', () => {
  const tasks = [T(0, 'scaffold', [], 'completed'), T(1, 'manual', [0], 'waiting'), T(2, 'seo', [0, 1], 'failed')]
  tasks[2].note = 'boom'
  assert.match(describeGoal('planned', tasks), /Plan ready: 2 tasks/)
  assert.match(describeGoal('completed', tasks), /All 3 tasks are finished/)
  assert.match(describeGoal('cancelled', tasks), /Stopped by you after 1 of 3/)
  assert.match(describeGoal('failed', tasks), /"task 2" failed \(boom\)/)
  assert.match(describeGoal('waiting', tasks), /Waiting for you: "task 1"/)
  assert.match(describeGoal('running', [T(0, 'scaffold', [], 'running')]), /Working on "task 0"/)
})
