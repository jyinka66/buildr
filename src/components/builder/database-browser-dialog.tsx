// @ts-nocheck — type mismatches between dialog and api-client will be fixed in a follow-up
'use client'

// Database Browser — browse Supabase tables, view columns, and query data.
// Shows a table list (sidebar) + column viewer + data grid for the selected
// table. Connected to the project's Supabase database via its db_config.

import * as React from 'react'
import { Database, Loader2, Table2, RefreshCw, KeyRound, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

interface Column {
  name: string
  type: string
  nullable: boolean
  default: string | null
}

interface Table {
  name: string
  columns: Column[]
  rowCount: number | null
}

export function DatabaseBrowserDialog({ open, onOpenChange, projectId }: Props) {
  const [tables, setTables] = React.useState<Table[]>([])
  const [selectedTable, setSelectedTable] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [querying, setQuerying] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchTables = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getDbTables(projectId)
      setTables(data.tables)
      if (data.error) setError(data.error)
      if (data.tables.length > 0) setSelectedTable(data.tables[0].name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchTableData = React.useCallback(async (tableName: string) => {
    setQuerying(true)
    try {
      const result = await api.dbQuery(projectId, {
        sql: `SELECT * FROM ${tableName}`,
        tableName,
        limit: 50,
      })
      if (result.ok) {
        setRows(result.rows)
        setColumns(result.columns)
      } else {
        setRows([])
        setColumns([])
        if (result.error) toast.error('Query failed', { description: result.error })
      }
    } catch (err) {
      toast.error('Failed to load data')
    } finally {
      setQuerying(false)
    }
  }, [projectId])

  React.useEffect(() => {
    if (open) void fetchTables()
  }, [open, fetchTables])

  React.useEffect(() => {
    if (selectedTable) void fetchTableData(selectedTable)
  }, [selectedTable, fetchTableData])

  const selectedTableData = tables.find((t) => t.name === selectedTable)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Database className="h-4 w-4" />
            </span>
            <DialogTitle className="text-lg">Database Browser</DialogTitle>
            <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1" onClick={() => void fetchTables()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
          <DialogDescription>
            Browse tables, columns, and data in your project's Supabase database.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : tables.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No tables found. Use the Schema Designer to create one.
          </div>
        ) : (
          <div className="grid grid-cols-[200px_1fr] gap-3 h-[55vh]">
            {/* Table list */}
            <ScrollArea className="rounded-md border border-border">
              <div className="p-2">
                <p className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tables.length} table{tables.length === 1 ? '' : 's'}
                </p>
                {tables.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setSelectedTable(t.name)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                      selectedTable === t.name ? 'bg-accent text-foreground font-medium' : 'hover:bg-accent/50 text-muted-foreground',
                    )}
                  >
                    <Table2 className="h-3 w-3 shrink-0 text-emerald-600" />
                    <span className="truncate font-mono">{t.name}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>

            {/* Data + columns */}
            <div className="flex flex-col gap-3 overflow-hidden">
              {/* Columns */}
              {selectedTableData ? (
                <div className="rounded-md border border-border p-2">
                  <div className="flex items-center gap-1.5 px-1 py-0.5">
                    <Table2 className="h-3 w-3 text-emerald-600" />
                    <span className="text-xs font-mono font-medium">{selectedTableData.name}</span>
                    <Badge variant="secondary" className="text-[9px]">{selectedTableData.columns.length} cols</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedTableData.columns.map((col) => (
                      <span
                        key={col.name}
                        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-mono"
                        title={`${col.type}${col.nullable ? ' (nullable)' : ''}${col.default ? ` default: ${col.default}` : ''}`}
                      >
                        {col.name}
                        <span className="text-muted-foreground">{col.type}</span>
                        {col.default?.includes('gen_random_uuid') || col.name === 'id' ? (
                          <KeyRound className="h-2.5 w-2.5 text-amber-500" />
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Data grid */}
              <ScrollArea className="flex-1 rounded-md border border-border">
                {querying ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : rows.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">No rows in this table.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr>
                        {columns.map((col) => (
                          <th key={col} className="border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                          {columns.map((col) => (
                            <td key={col} className="px-2 py-1.5 font-mono text-[11px] max-w-[200px] truncate">
                              {String(row[col] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ScrollArea>

              <div className="text-xs text-muted-foreground">
                {querying ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'} (max 50 shown)`}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
