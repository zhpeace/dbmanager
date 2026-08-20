import { useState, useEffect, useCallback, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Table2, Info, Code, Download, X, Plus, Trash2, Save, RotateCcw, RefreshCw, Filter, FilterX } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DataTable, type RowState } from "./DataTable"
import { ValueEditorDialog } from "./ValueEditorDialog"
import { BinaryEditorDialog } from "./BinaryEditorDialog"
import { RedisValuePanel } from "./RedisValuePanel"
import type { TableData, DatabaseType } from "@/lib/db"
import { buildXlsx } from "@/lib/xlsx"

interface TableBrowserProps {
  connectionId: string
  database: string
  table: string
  dbType: DatabaseType
  onClose?: () => void
  embedded?: boolean
}

type NewRow = Record<string, unknown>

export function TableBrowser({ connectionId, database, table, dbType, onClose, embedded = false }: TableBrowserProps) {
  const { t } = useTranslation()
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [ddl, setDdl] = useState<string>("")
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<string>("asc")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [filtersVisible, setFiltersVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)
  const [largeEditCell, setLargeEditCell] = useState<{ row: number; col: string } | null>(null)
  const [binaryEditCell, setBinaryEditCell] = useState<{ row: number; col: string } | null>(null)

  const [dirtyRows, setDirtyRows] = useState<Map<number, Record<string, string>>>(new Map())
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const filterConds = Object.entries(filters)
        .filter(([, v]) => v.trim() !== "")
        .map(([col, v]) => {
          const qcol = quoteId(col)
          const val = v.trim()
          if (/^(>=|<=|<>|!=|>|<|=)\s*/.test(val)) {
            const m = val.match(/^(>=|<=|<>|!=|>|<|=)\s*(.*)$/)!
            return `${qcol} ${m[1]} ${escapeVal(parseNumOrStr(m[2]))}`
          }
          if (val.startsWith("%") || val.endsWith("%")) {
            return `${qcol} LIKE ${escapeVal(val)}`
          }
          return `${qcol} = ${escapeVal(parseNumOrStr(val))}`
        })
      const whereClause = filterConds.length > 0 ? filterConds.join(" AND ") : null
      const result: TableData = await invoke("get_table_data", {
        id: connectionId,
        database,
        table,
        page,
        pageSize,
        sortColumn: sortColumn || null,
        sortOrder: sortColumn ? sortOrder : null,
        whereClause,
      })
      setTableData(result)
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- helper fns are recreated per render; adding them would loop via useEffect(loadData)
  }, [connectionId, database, table, page, pageSize, sortColumn, sortOrder, filters])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    invoke<string>("get_table_ddl", { id: connectionId, database, table })
      .then(setDdl)
      .catch(() => {})
  }, [connectionId, database, table])

  function quoteId(s: string): string {
    if (dbType === "mysql" || dbType === "sqlite") {
      return "`" + s.replace(/`/g, "``") + "`"
    }
    if (s.toLowerCase() !== s || /[^a-zA-Z0-9_]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  function escapeVal(v: unknown): string {
    if (v === null || v === undefined) return "NULL"
    if (typeof v === "number") return String(v)
    if (typeof v === "boolean") return dbType === "postgresql" ? `'${v}'` : (v ? "1" : "0")
    return "'" + String(v).replace(/'/g, "''") + "'"
  }

  function parseNumOrStr(v: string): string | number {
    const n = Number(v)
    if (v.trim() !== "" && !Number.isNaN(n) && /^[-+]?\d+(\.\d+)?$/.test(v.trim())) {
      return n
    }
    return v
  }

  const binaryColumns = useMemo(() => {
    if (!tableData) return []
    return tableData.columns
      .filter((c) => /blob|binary|bytea|bytes|raw|image/i.test(c.data_type))
      .map((c) => c.name)
  }, [tableData])

  function binaryLiteral(v: unknown): string {
    if (v === null || v === undefined) return "NULL"
    let hex: string
    if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) {
      hex = v.slice(2)
    } else {
      const bytes = new TextEncoder().encode(String(v))
      hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
    }
    if (dbType === "mysql" || dbType === "sqlite") return `X'${hex}'`
    if (dbType === "oracle") return `HEXTORAW('${hex}')`
    if (dbType === "postgresql") return `decode('${hex}', 'hex')`
    return `X'${hex}'`
  }

  const qualified = useMemo(() => {
    return table.includes(".") ? table.split(".").map(quoteId).join(".") : quoteId(table)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteId is a local helper recreated per render
  }, [table, dbType])

  function buildWhereClause(handle: Record<string, unknown>): { where: string; error?: string } {
    const rowid = handle["__rowid__"] ?? handle["ROWID2"]
    if (rowid !== undefined) {
      const where = dbType === "oracle"
        ? `WHERE ROWID = CHARTOROWID(${escapeVal(rowid)})`
        : `WHERE ROWID = ${escapeVal(rowid)}`
      return { where }
    }
    const pks = (tableData?.primary_keys ?? []).filter((pk) => handle[pk] !== undefined)
    if (pks.length === 0) {
      return { where: "", error: t('tablebrowser.no_pk') }
    }
    const conds = pks.map((pk) => `${quoteId(pk)} = ${escapeVal(handle[pk])}`)
    return { where: `WHERE ${conds.join(" AND ")}` }
  }

  const mergedRows = useMemo<Record<string, unknown>[]>(() => {
    if (!tableData) return []
    const rows: Record<string, unknown>[] = tableData.rows.map((r, i) => {
      const dirty = dirtyRows.get(i)
      return dirty ? { ...r, ...dirty } : r
    })
    for (const nr of newRows) rows.push(nr)
    return rows
  }, [tableData, dirtyRows, newRows])

  const rowStates = useMemo<Array<RowState | undefined>>(() => {
    if (!tableData) return []
    const states: Array<RowState | undefined> = tableData.rows.map((_, i) => {
      if (deletedRows.has(i)) return "deleted"
      if (dirtyRows.has(i)) return "modified"
      return undefined
    })
    for (const _ of newRows) states.push("added")
    return states
  }, [tableData, dirtyRows, deletedRows, newRows])

  const hasUnsaved = dirtyRows.size > 0 || newRows.length > 0 || deletedRows.size > 0

  function clearBuffer() {
    setDirtyRows(new Map())
    setNewRows([])
    setDeletedRows(new Set())
    setSelectedRows(new Set())
    setEditingCell(null)
  }

  const handleCellEdit = useCallback((rowIndex: number, columnName: string, newValue: string) => {
    setEditingCell(null)
    if (!tableData) return
    const row = mergedRows[rowIndex]
    if (!row) return
    const rowState = rowStates[rowIndex]
    if (rowState === "deleted") return
    const origValue = row[columnName]
    if (String(origValue ?? "") === newValue) return

    if (rowState === "added") {
      const addedIndex = rowIndex - tableData.rows.length
      if (addedIndex < 0) return
      setNewRows((prev) =>
        prev.map((r, i) => (i === addedIndex ? { ...r, [columnName]: newValue } : r))
      )
    } else {
      setDirtyRows((prev) => {
        const next = new Map(prev)
        const cells = next.get(rowIndex) ?? {}
        next.set(rowIndex, { ...cells, [columnName]: newValue })
        return next
      })
    }
  }, [tableData, mergedRows, rowStates])

  const handleSave = useCallback(async () => {
    if (!tableData || !hasUnsaved) return
    const sql: string[] = []

    for (const [rowIdx, cells] of dirtyRows) {
      const handle = tableData.row_handles[rowIdx] ?? {}
      const { where, error: whereErr } = buildWhereClause(handle)
      if (whereErr) {
        setError(whereErr)
        return
      }
      for (const [col, val] of Object.entries(cells)) {
        const lit = binaryColumns.includes(col) ? binaryLiteral(val) : escapeVal(val)
        sql.push(`UPDATE ${qualified} SET ${quoteId(col)} = ${lit} ${where}`)
      }
    }

    for (const row of newRows) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined)
      if (cols.length === 0) continue
      const vals = cols.map((c) => binaryColumns.includes(c) ? binaryLiteral(row[c]) : escapeVal(row[c]))
      sql.push(`INSERT INTO ${qualified} (${cols.map(quoteId).join(", ")}) VALUES (${vals.join(", ")})`)
    }

    for (const rowIdx of deletedRows) {
      const handle = tableData.row_handles[rowIdx] ?? {}
      const { where, error: whereErr } = buildWhereClause(handle)
      if (whereErr) {
        setError(whereErr)
        return
      }
      sql.push(`DELETE FROM ${qualified} ${where}`)
    }

    if (sql.length === 0) return
    setLoading(true)
    setError(null)
    try {
      await invoke<number>("execute_batch", { id: connectionId, queries: sql })
      clearBuffer()
      await loadData()
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- local helper fns (escapeVal/quoteId/buildWhereClause/binaryLiteral) are recreated per render
  }, [tableData, hasUnsaved, dirtyRows, newRows, deletedRows, qualified, connectionId, t, loadData, binaryColumns])

  const handleRollback = useCallback(() => {
    clearBuffer()
    loadData()
  }, [loadData])

  const handleRefresh = useCallback(() => {
    if (hasUnsaved && !window.confirm(t('tablebrowser.unsaved_changes'))) return
    clearBuffer()
    loadData()
  }, [hasUnsaved, t, loadData])

  const handleAddRow = useCallback(() => {
    if (!tableData) return
    const blank: NewRow = {}
    for (const col of tableData.columns) blank[col.name] = null
    setNewRows((prev) => [...prev, blank])
  }, [tableData])

  const handleDeleteSelected = useCallback(() => {
    if (!tableData || selectedRows.size === 0) return
    const nextDeleted = new Set(deletedRows)
    const nextNewRows = [...newRows]
    let changed = false
    for (const idx of selectedRows) {
      const rowState = rowStates[idx]
      if (rowState === "added") {
        const addedIndex = idx - tableData.rows.length
        if (addedIndex >= 0 && addedIndex < nextNewRows.length) {
          nextNewRows.splice(addedIndex, 1)
          changed = true
        }
      } else if (rowState !== "deleted") {
        nextDeleted.add(idx)
        changed = true
      }
    }
    if (changed) {
      setDeletedRows(nextDeleted)
      setNewRows(nextNewRows)
    }
    setSelectedRows(new Set())
    setEditingCell(null)
  }, [tableData, selectedRows, deletedRows, newRows, rowStates])

  const handleSelectionChange = useCallback((rowIndex: number, selected: boolean) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (selected) next.add(rowIndex)
      else next.delete(rowIndex)
      return next
    })
  }, [])

  const handleMoveNext = useCallback((rowIndex: number, columnName: string, direction: "down" | "right") => {
    if (!tableData) return
    const cols = tableData.columns.map((c) => c.name)
    const ci = cols.indexOf(columnName)
    if (direction === "right") {
      if (ci >= 0 && ci < cols.length - 1) {
        setEditingCell({ row: rowIndex, col: cols[ci + 1] })
      } else if (rowIndex < mergedRows.length - 1) {
        setEditingCell({ row: rowIndex + 1, col: cols[0] })
      } else {
        setEditingCell(null)
      }
    } else {
      if (rowIndex < mergedRows.length - 1) {
        setEditingCell({ row: rowIndex + 1, col: columnName })
      } else {
        setEditingCell(null)
      }
    }
  }, [tableData, mergedRows])

  const goPage = useCallback((p: number) => {
    if (hasUnsaved && !window.confirm(t('tablebrowser.unsaved_changes'))) return
    clearBuffer()
    setPage(p)
  }, [hasUnsaved, t])

  const handleSort = useCallback((col: string) => {
    if (hasUnsaved && !window.confirm(t('tablebrowser.unsaved_changes'))) return
    clearBuffer()
    if (sortColumn === col) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortColumn(col)
      setSortOrder("asc")
    }
    setPage(1)
  }, [hasUnsaved, t, sortColumn])

  const totalPages = tableData ? Math.ceil(tableData.total / pageSize) : 1

  const exportCsv = () => {
    if (!tableData) return
    const headers = tableData.columns.map((c) => c.name)
    const visibleRows = mergedRows.filter((_, i) => rowStates[i] !== "deleted")
    const csvRows = [headers.join(",")]
    for (const row of visibleRows) {
      const values = headers.map((h) => {
        const v = row[h]
        if (v === null || v === undefined) return ""
        const s = String(v)
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      })
      csvRows.push(values.join(","))
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${table}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportXlsx = () => {
    if (!tableData) return
    const headers = tableData.columns.map((c) => c.name)
    const visibleRows = mergedRows.filter((_, i) => rowStates[i] !== "deleted")
    const bytes = buildXlsx(
      headers,
      visibleRows.map((row) => headers.map((h) => row[h] ?? null)),
    )
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${table}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = () => {
    if (!tableData) return
    const visibleRows = mergedRows.filter((_, i) => rowStates[i] !== "deleted")
    const blob = new Blob([JSON.stringify(visibleRows, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${table}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col">
      {dbType === "redis" ? (
        <RedisValuePanel connectionId={connectionId} database={database} table={table} onClose={onClose} />
      ) : (
      <>
      <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {!embedded && (
            <>
              <Table2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium truncate" title={table}>{table}</span>
              {onClose && (
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0 ml-1 shrink-0" onClick={onClose}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
          {tableData && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {t('tablebrowser.rows_info', { count: tableData.total, duration: tableData.duration })}
            </span>
          )}
          {hasUnsaved && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
              {t('tablebrowser.modified_count', { count: dirtyRows.size + newRows.length + deletedRows.size })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleAddRow} disabled={!tableData}>
            <Plus className="h-3 w-3 mr-1" />
            {t('tablebrowser.add_row')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleDeleteSelected} disabled={selectedRows.size === 0}>
            <Trash2 className="h-3 w-3 mr-1" />
            {t('tablebrowser.delete_row')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-amber-600 dark:text-amber-400" onClick={handleSave} disabled={!hasUnsaved || loading}>
            <Save className="h-3 w-3 mr-1" />
            {t('tablebrowser.save_rows')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleRollback} disabled={!hasUnsaved || loading}>
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('tablebrowser.rollback')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" />
            {t('tablebrowser.refresh')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setFiltersVisible((prev) => !prev)}
            disabled={!tableData}
            title={t('tablebrowser.filter')}
          >
            <Filter className="h-3 w-3 mr-1" />
            {t('tablebrowser.filter')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={exportCsv}>
            <Download className="h-3 w-3 mr-1" />
            {t('tablebrowser.csv')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={exportXlsx}>
            <Download className="h-3 w-3 mr-1" />
            {t('tablebrowser.xlsx')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={exportJson}>
            <Download className="h-3 w-3 mr-1" />
            {t('tablebrowser.json')}
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={page <= 1}
              onClick={() => goPage(Math.max(1, page - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-[60px] text-center tabular-nums">
              {t('tablebrowser.pagination', { page, total: totalPages })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={page >= totalPages}
              onClick={() => goPage(Math.min(totalPages, page + 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
      {filtersVisible && tableData && (
        <div className="flex items-center gap-1 border-b px-3 py-1 overflow-x-auto">
          <button
            className="shrink-0 p-0.5 rounded hover:bg-muted/60"
            onClick={() => { setFilters({}); setPage(1) }}
            title={t('tablebrowser.clear_filters')}
          >
            <FilterX className="h-3 w-3 text-muted-foreground" />
          </button>          <span className="text-[10px] text-muted-foreground shrink-0">{t('tablebrowser.filter_hint')}</span>
          {tableData.columns.map((c) => (
            <div key={c.name} className="flex items-center gap-1 shrink-0">
              <input
                className="w-28 h-5 rounded border bg-transparent px-1.5 text-[11px] outline-none focus:ring-1 ring-primary"
                placeholder={c.name}
                value={filters[c.name] ?? ""}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, [c.name]: e.target.value }))
                  setPage(1)
                }}
              />
            </div>
          ))}
        </div>
      )}
      <Tabs defaultValue="data" className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-3">
          <TabsList className="bg-transparent h-9">
            <TabsTrigger value="data" className="text-xs data-[state=active]:bg-background">
              <Table2 className="h-3.5 w-3.5 mr-1" />
              {t('tablebrowser.tab_data')}
            </TabsTrigger>
            <TabsTrigger value="columns" className="text-xs data-[state=active]:bg-background">
              <Info className="h-3.5 w-3.5 mr-1" />
              {t('tablebrowser.tab_columns')}
            </TabsTrigger>
            <TabsTrigger value="ddl" className="text-xs data-[state=active]:bg-background">
              <Code className="h-3.5 w-3.5 mr-1" />
              {t('tablebrowser.tab_ddl')}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="data" className="flex-1 mt-0 min-h-0 data-[state=active]:flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {t('tablebrowser.loading')}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-xs text-destructive">{error}</div>
          ) : tableData ? (
            <DataTable
              columns={tableData.columns.map((c) => c.name)}
              rows={mergedRows}
              sortColumn={sortColumn}
              sortOrder={sortOrder}
              onSort={handleSort}
              editingCell={editingCell}
              onCellEditStart={(row, col) => setEditingCell(row < 0 ? null : { row, col })}
              onCellEdit={handleCellEdit}
              onMoveNext={handleMoveNext}
              onLargeEdit={(row, col) => setLargeEditCell({ row, col })}
              onBinaryEdit={(row, col) => setBinaryEditCell({ row, col })}
              binaryColumns={binaryColumns}
              rowStates={rowStates}
              selectedRows={selectedRows}
              onSelectionChange={handleSelectionChange}
              tableName={table}
              primaryKeys={tableData.primary_keys}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {t('tablebrowser.no_data')}
            </div>
          )}
        </TabsContent>
        <TabsContent value="columns" className="flex-1 mt-0 min-h-0 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80">
              <tr className="border-b">
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">{t('tablebrowser.col_name')}</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">{t('tablebrowser.col_type')}</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">{t('tablebrowser.col_nullable')}</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">{t('tablebrowser.col_key')}</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">{t('tablebrowser.col_default')}</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">{t('tablebrowser.col_extra')}</th>
              </tr>
            </thead>
            <tbody>
              {tableData?.columns.map((col) => (
                <tr key={col.name} className="border-b hover:bg-accent/30">
                  <td className="px-3 py-1 font-medium">{col.name}</td>
                  <td className="px-3 py-1 text-muted-foreground">{col.data_type}</td>
                  <td className="px-3 py-1">{col.nullable ? t('tablebrowser.yes') : t('tablebrowser.no')}</td>
                  <td className="px-3 py-1 text-muted-foreground">{col.key || t('datatable.empty')}</td>
                  <td className="px-3 py-1 text-muted-foreground font-mono">{col.default_value ?? t('datatable.empty')}</td>
                  <td className="px-3 py-1 text-muted-foreground">{col.extra || t('datatable.empty')}</td>
                </tr>
              ))}
              {(!tableData || tableData.columns.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                    {t('tablebrowser.no_columns')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TabsContent>
        <TabsContent value="ddl" className="flex-1 mt-0 min-h-0 data-[state=active]:flex flex-col">
          <pre className="flex-1 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap text-muted-foreground">
            {ddl || t('tablebrowser.loading')}
          </pre>
        </TabsContent>
      </Tabs>
      <ValueEditorDialog
        open={largeEditCell !== null}
        tableName={table}
        column={largeEditCell?.col ?? ""}
        rowIndex={largeEditCell?.row ?? 0}
        value={largeEditCell ? mergedRows[largeEditCell.row]?.[largeEditCell.col] : undefined}
        onSave={(v) => {
          if (largeEditCell) {
            handleCellEdit(largeEditCell.row, largeEditCell.col, v)
          }
          setLargeEditCell(null)
        }}
        onClose={() => setLargeEditCell(null)}
      />
      <BinaryEditorDialog
        open={binaryEditCell !== null}
        tableName={table}
        column={binaryEditCell?.col ?? ""}
        rowIndex={binaryEditCell?.row ?? 0}
        value={binaryEditCell ? mergedRows[binaryEditCell.row]?.[binaryEditCell.col] : undefined}
        onSave={(hexVal) => {
          if (binaryEditCell) {
            const orig = mergedRows[binaryEditCell.row]?.[binaryEditCell.col]
            let origHex = ""
            if (typeof orig === "string" && /^0x[0-9a-f]+$/i.test(orig)) {
              origHex = orig.slice(2).toUpperCase()
            } else if (orig !== null && orig !== undefined) {
              origHex = Array.from(new TextEncoder().encode(String(orig)))
                .map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")
            }
            if (hexVal.slice(2).toUpperCase() !== origHex) {
              handleCellEdit(binaryEditCell.row, binaryEditCell.col, hexVal)
            }
          }
          setBinaryEditCell(null)
        }}
        onClose={() => setBinaryEditCell(null)}
      />
      </>
      )}
    </div>
  )
}
