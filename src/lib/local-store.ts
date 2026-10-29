// Local in-memory data store — mimics the Supabase server client API.
// ------------------------------------------------------------------
// When Supabase isn't configured (no SUPABASE_URL / SERVICE_ROLE_KEY),
// the `db` proxy in supabase-server.ts delegates to this store so the
// entire app works end-to-end for local dev / demos without a database.
//
// Supported query patterns (covers every call site in src/app/api/**):
//   db.from('table').select('*').eq('col', val).order('col', { ascending }).maybeSingle()
//   db.from('table').select('*').eq('col', val).single()
//   db.from('table').select('id', { count: 'exact', head: true }).eq('col', val)
//   db.from('table').select('col1,col2').eq('col', val).order(...)
//   db.from('table').insert({ ... }).select('*').single()
//   db.from('table').insert([{ ... }, { ... }])
//   db.from('table').update({ ... }).eq('col', val)
//   db.from('table').delete().eq('col', val)
//   db.from('table').upsert({ ... }, { onConflict: 'col,col2' })
//
// Data persists for the lifetime of the server process (in-memory, not
// durable). Uses globalThis so the store survives HMR and is shared
// across route chunks in dev mode. Good enough for demos — switch to
// Supabase for production.

export type Row = Record<string, unknown>

// Module-level store: table name → array of rows.
// Uses globalThis so the store survives HMR + is shared across all route
// handlers (Next.js dev compiles each route into a separate chunk, each
// with its own module instance — globalThis bridges them).
const g = globalThis as unknown as { __buildrLocalTables?: Map<string, Row[]> }

if (!g.__buildrLocalTables) {
  g.__buildrLocalTables = new Map()
}
const tables = g.__buildrLocalTables

function getTable(name: string): Row[] {
  if (!tables.has(name)) tables.set(name, [])
  return tables.get(name)!
}

// Generate a UUID-like ID.
function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Parse a select column spec: "id,name,email" → ['id','name','email']
// "*" → null (meaning all columns).
function parseColumns(spec: string | undefined): string[] | null {
  if (!spec || spec === '*') return null
  return spec.split(',').map((s) => s.trim()).filter(Boolean)
}

function projectRow(row: Row, columns: string[] | null): Row {
  if (!columns) return { ...row }
  const out: Row = {}
  for (const c of columns) out[c] = row[c]
  return out
}

type PostgrestError = { message: string; code: string; details?: string }

interface QueryState {
  table: string
  columns: string[] | null
  countMode: boolean
  headOnly: boolean
  filters: { column: string; op: string; value: unknown }[]
  order: { column: string; ascending: boolean } | null
  limitN: number | null
  singleMode: boolean
  maybeSingleMode: boolean
  insertRows: Row[] | null
  updatePatch: Record<string, unknown> | null
  deleteMode: boolean
  upsertRows: Row[] | null
  upsertConflict: string[] | null
}

function newQueryState(table: string): QueryState {
  return {
    table,
    columns: null,
    countMode: false,
    headOnly: false,
    filters: [],
    order: null,
    limitN: null,
    singleMode: false,
    maybeSingleMode: false,
    insertRows: null,
    updatePatch: null,
    deleteMode: false,
    upsertRows: null,
    upsertConflict: null,
  }
}

// Apply filters to a set of rows.
function applyFilters(rows: Row[], filters: QueryState['filters']): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const val = row[f.column]
      if (f.op === 'eq') return val === f.value
      if (f.op === 'neq') return val !== f.value
      if (f.op === 'gte') return typeof val === 'string' && typeof f.value === 'string' ? val >= f.value : Number(val) >= Number(f.value)
      if (f.op === 'lte') return typeof val === 'string' && typeof f.value === 'string' ? val <= f.value : Number(val) <= Number(f.value)
      if (f.op === 'is') return f.value === null ? val === null || val === undefined : val === f.value
      if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val)
      return false
    }),
  )
}

// Apply ordering.
function applyOrder(rows: Row[], order: QueryState['order']): Row[] {
  if (!order) return rows
  return [...rows].sort((a, b) => {
    const av = a[order.column]
    const bv = b[order.column]
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    const cmp = av < bv ? -1 : 1
    return order.ascending ? cmp : -cmp
  })
}

// Execute the query and return a Supabase-shaped result.
function execute(state: QueryState): {
  data: Row | Row[] | null
  error: PostgrestError | null
  count: number | null
  status: number
  statusText: string
} {
  const rows = getTable(state.table)

  // --- INSERT ---
  if (state.insertRows) {
    const now = new Date().toISOString()
    const inserted: Row[] = state.insertRows.map((r) => {
      const row: Row = { ...r }
      if (!row.id) row.id = genId()
      if (!row.created_at) row.created_at = now
      if (!row.updated_at) row.updated_at = now
      return row
    })
    rows.push(...inserted)
    const projected = inserted.map((r) => projectRow(r, state.columns))
    if (state.singleMode) {
      return { data: projected[0] ?? null, error: null, count: inserted.length, status: 201, statusText: 'Created' }
    }
    return { data: projected, error: null, count: inserted.length, status: 201, statusText: 'Created' }
  }

  // --- UPDATE ---
  if (state.updatePatch) {
    const patch = { ...state.updatePatch, updated_at: new Date().toISOString() }
    const matched = applyFilters(rows, state.filters)
    matched.forEach((row) => Object.assign(row, patch))
    const projected = matched.map((r) => projectRow(r, state.columns))
    if (state.singleMode) {
      return { data: projected[0] ?? null, error: null, count: matched.length, status: 200, statusText: 'OK' }
    }
    return { data: projected, error: null, count: matched.length, status: 200, statusText: 'OK' }
  }

  // --- DELETE ---
  if (state.deleteMode) {
    const matched = applyFilters(rows, state.filters)
    const ids = new Set(matched.map((r) => r.id))
    const remaining = rows.filter((r) => !ids.has(r.id))
    tables.set(state.table, remaining)
    return { data: matched, error: null, count: matched.length, status: 200, statusText: 'OK' }
  }

  // --- UPSERT ---
  if (state.upsertRows) {
    const now = new Date().toISOString()
    const conflictCols = state.upsertConflict ?? ['id']
    for (const newRow of state.upsertRows) {
      const existing = rows.find((r) =>
        conflictCols.every((c) => r[c] === newRow[c]),
      )
      if (existing) {
        Object.assign(existing, newRow, { updated_at: now })
      } else {
        const row: Row = { ...newRow }
        if (!row.id) row.id = genId()
        if (!row.created_at) row.created_at = now
        if (!row.updated_at) row.updated_at = now
        rows.push(row)
      }
    }
    const conflictVals = state.upsertRows.map((r) => r[conflictCols[0]])
    const matched = rows.filter((r) => conflictVals.includes(r[conflictCols[0]]))
    return { data: matched, error: null, count: matched.length, status: 200, statusText: 'OK' }
  }

  // --- SELECT ---
  let result = applyFilters(rows, state.filters)
  result = applyOrder(result, state.order)
  if (state.limitN !== null) result = result.slice(0, state.limitN)
  const count = result.length

  if (state.countMode) {
    return { data: null, error: null, count, status: 200, statusText: 'OK' }
  }
  if (state.headOnly) {
    return { data: null, error: null, count, status: 200, statusText: 'OK' }
  }

  const projected = result.map((r) => projectRow(r, state.columns))

  if (state.singleMode) {
    if (projected.length === 0) {
      return {
        data: null,
        error: { message: 'no rows returned', code: 'PGRST116' },
        count: 0,
        status: 404,
        statusText: 'Not Found',
      }
    }
    return { data: projected[0], error: null, count: 1, status: 200, statusText: 'OK' }
  }

  if (state.maybeSingleMode) {
    return { data: projected[0] ?? null, error: null, count, status: 200, statusText: 'OK' }
  }

  return { data: projected, error: null, count, status: 200, statusText: 'OK' }
}

// Chainable query builder.
class LocalQueryBuilder {
  private state: QueryState

  constructor(table: string) {
    this.state = newQueryState(table)
  }

  select(columns?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    this.state.columns = parseColumns(columns)
    if (opts?.count === 'exact') this.state.countMode = true
    if (opts?.head) this.state.headOnly = true
    return this
  }

  eq(column: string, value: unknown): this {
    this.state.filters.push({ column, op: 'eq', value })
    return this
  }

  neq(column: string, value: unknown): this {
    this.state.filters.push({ column, op: 'neq', value })
    return this
  }

  gte(column: string, value: unknown): this {
    this.state.filters.push({ column, op: 'gte', value })
    return this
  }

  lte(column: string, value: unknown): this {
    this.state.filters.push({ column, op: 'lte', value })
    return this
  }

  is(column: string, value: unknown): this {
    this.state.filters.push({ column, op: 'is', value })
    return this
  }

  in(column: string, values: unknown[]): this {
    this.state.filters.push({ column, op: 'in', value: values })
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.state.order = { column, ascending: opts?.ascending ?? true }
    return this
  }

  limit(n: number): this {
    this.state.limitN = n
    return this
  }

  maybeSingle(): this {
    this.state.maybeSingleMode = true
    return this
  }

  single(): this {
    this.state.singleMode = true
    return this
  }

  insert(data: Row | Row[]): this {
    this.state.insertRows = Array.isArray(data) ? data : [data]
    return this
  }

  update(patch: Record<string, unknown>): this {
    this.state.updatePatch = patch
    return this
  }

  delete(): this {
    this.state.deleteMode = true
    return this
  }

  upsert(data: Row | Row[], opts?: { onConflict?: string }): this {
    this.state.upsertRows = Array.isArray(data) ? data : [data]
    if (opts?.onConflict) {
      this.state.upsertConflict = opts.onConflict.split(',').map((s) => s.trim())
    }
    return this
  }

  // Make it thenable — resolves to the query result.
  then<TResult1 = { data: Row | Row[] | null; error: PostgrestError | null; count: number | null }>(
    onFulfilled?: (value: { data: Row | Row[] | null; error: PostgrestError | null; count: number | null }) => TResult1 | PromiseLike<TResult1>,
    _onRejected?: (reason: unknown) => unknown,
  ): Promise<TResult1> {
    const result = execute(this.state)
    return Promise.resolve(result).then(onFulfilled as (value: typeof result) => TResult1 | PromiseLike<TResult1>) as Promise<TResult1>
  }

  catch<TResult = never>(_onRejected?: (reason: unknown) => TResult): Promise<unknown> {
    return Promise.resolve(execute(this.state))
  }

  finally(_onFinally?: () => void): Promise<unknown> {
    return Promise.resolve(execute(this.state))
  }
}

// The local db client — mimics the SupabaseClient `.from()` entry point.
export const localDb = {
  from(table: string): LocalQueryBuilder {
    return new LocalQueryBuilder(table)
  },
  // Exposed for tests / debugging.
  get _tables() { return tables },
  _reset(): void {
    tables.clear()
  },
}
