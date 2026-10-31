import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { replaceProjectFiles } from '../src/lib/project-files.ts'

// In-memory stand-in for the slice of the Supabase client the helper uses.
function fakeDb(initial = [], failures = {}) {
  const rows = new Map(initial.map((r) => [`${r.project_id}:${r.path}`, { ...r }]))
  const calls = []
  const client = {
    rows,
    calls,
    from(table) {
      assert.equal(table, 'project_files')
      return {
        async upsert(batch, opts) {
          calls.push(['upsert', batch.length, opts.onConflict])
          if (failures.upsert) return { error: { message: failures.upsert } }
          for (const r of batch) rows.set(`${r.project_id}:${r.path}`, { ...r })
          return { error: null }
        },
        select() {
          return {
            async eq(_col, projectId) {
              calls.push(['select', projectId])
              if (failures.list) return { data: null, error: { message: failures.list } }
              return { data: [...rows.values()].filter((r) => r.project_id === projectId).map((r) => ({ path: r.path })), error: null }
            },
          }
        },
        delete() {
          return {
            eq(_col, projectId) {
              return {
                async in(_c, paths) {
                  calls.push(['delete', paths.length])
                  if (failures.delete) return { error: { message: failures.delete } }
                  for (const p of paths) rows.delete(`${projectId}:${p}`)
                  return { error: null }
                },
              }
            },
          }
        },
      }
    },
  }
  return client
}

const file = (path, content = 'x') => ({ path, content, language: 'ts' })
const pathsOf = (db, projectId) => [...db.rows.values()].filter((r) => r.project_id === projectId).map((r) => r.path).sort()

test('replaceProjectFiles produces exactly the new tree and removes stale paths', async () => {
  const db = fakeDb([
    { project_id: 'p1', path: 'old.ts', content: 'old' },
    { project_id: 'p1', path: 'keep.ts', content: 'before' },
    { project_id: 'p2', path: 'other-project.ts', content: 'untouched' },
  ])
  const result = await replaceProjectFiles(db, 'p1', [file('keep.ts', 'after'), file('new.ts')])
  assert.deepEqual(pathsOf(db, 'p1'), ['keep.ts', 'new.ts'])
  assert.equal(db.rows.get('p1:keep.ts').content, 'after', 'existing paths are overwritten')
  assert.deepEqual(pathsOf(db, 'p2'), ['other-project.ts'], 'other projects are never touched')
  assert.deepEqual(result, { written: 2, removed: 1 })
  assert.equal(db.calls[0][0], 'upsert', 'the new tree must be written before anything is deleted')
  assert.equal(db.calls[0][2], 'project_id,path')
})

test('a failed write leaves the existing files untouched and surfaces an error', async () => {
  const db = fakeDb([{ project_id: 'p1', path: 'old.ts', content: 'old' }], { upsert: 'payload too large' })
  await assert.rejects(replaceProjectFiles(db, 'p1', [file('new.ts')]), /project_files_write_failed: payload too large/)
  assert.deepEqual(pathsOf(db, 'p1'), ['old.ts'], 'nothing may be deleted when the write fails')
  assert.ok(!db.calls.some((c) => c[0] === 'delete'), 'no delete may run after a failed write')
})

test('a failed cleanup keeps the new files in place and reports the error', async () => {
  const db = fakeDb([{ project_id: 'p1', path: 'old.ts', content: 'old' }], { delete: 'timeout' })
  await assert.rejects(replaceProjectFiles(db, 'p1', [file('new.ts')]), /project_files_cleanup_failed: timeout/)
  assert.ok(pathsOf(db, 'p1').includes('new.ts'), 'the new tree must already be saved')
})

test('a failed listing is reported instead of skipping cleanup silently', async () => {
  const db = fakeDb([], { list: 'connection reset' })
  await assert.rejects(replaceProjectFiles(db, 'p1', [file('a.ts')]), /project_files_list_failed: connection reset/)
})

test('duplicate paths collapse with the last entry winning, and cleanup is chunked', async () => {
  const stale = Array.from({ length: 250 }, (_, i) => ({ project_id: 'p1', path: `stale-${i}.ts`, content: '' }))
  const db = fakeDb(stale)
  const result = await replaceProjectFiles(db, 'p1', [file('a.ts', 'first'), file('a.ts', 'second')])
  assert.equal(db.rows.get('p1:a.ts').content, 'second')
  assert.deepEqual(pathsOf(db, 'p1'), ['a.ts'])
  assert.equal(result.removed, 250)
  assert.deepEqual(db.calls.filter((c) => c[0] === 'delete').map((c) => c[1]), [100, 100, 50])
})

test('an empty tree clears the project, matching the previous replace behaviour', async () => {
  const db = fakeDb([{ project_id: 'p1', path: 'old.ts', content: 'old' }])
  const result = await replaceProjectFiles(db, 'p1', [])
  assert.deepEqual(pathsOf(db, 'p1'), [])
  assert.deepEqual(result, { written: 0, removed: 1 })
})

test('generation and rewind never delete all project files before writing the replacement', () => {
  for (const path of ['../src/lib/llm/code-generator.ts', '../src/app/api/projects/[id]/rewind/route.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.ok(source.includes('replaceProjectFiles('), `${path} must use the safe replace helper`)
    assert.ok(!source.includes("from('project_files').delete()"), `${path} must not delete the whole file tree up front`)
  }
})
