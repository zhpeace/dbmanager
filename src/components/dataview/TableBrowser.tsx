import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Table2, Info, Code, Download, X, Plus, Trash2, Save, RotateCcw, RefreshCw, Filter, FilterX, ChevronsUpDown, Wand2, PenLine } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DataTable, type RowState } from "./DataTable"
import { ValueEditorDialog } from "./ValueEditorDialog"
import { BinaryEditorDialog } from "./BinaryEditorDialog"
import { RedisValuePanel } from "./RedisValuePanel"
import { ExportDialog } from "@/components/connection/ExportDialog"
import type { TableData, DatabaseType, ColumnDef, IndexInfo, ForeignKeyInfo, ColumnInfo } from "@/lib/db"
import { COMMON_TYPES } from "@/components/connection/CreateTableDialog"
import {
  isNumericType,
  getSchemaCache,
  alterAddColumn,
  alterDropColumn,
  alterModifyColumn,
  alterRenameColumn,
  createIndex,
  dropIndex,
  addForeignKey,
  dropForeignKey,
} from "@/lib/db"
import { buildXlsx } from "@/lib/xlsx"
import { formatSql } from "@/lib/sql"
import { cn } from "@/lib/utils"
import Editor from "@monaco-editor/react"
import { useTheme } from "@/lib/theme"

type EditableColumn = ColumnDef & { origName?: string }

interface TableBrowserProps {
  connectionId: string
  database: string
  table: string
  dbType: DatabaseType
  onClose?: () => void
  embedded?: boolean
  defaultTab?: "data" | "columns" | "indexes" | "fks" | "ddl"
  objectType?: string
  onRunSql?: (sql: string) => Promise<void>
  onInsertSql?: (sql: string) => void
  isPro?: boolean
  onOpenLicense?: () => void
}

type NewRow = Record<string, unknown>

export function TableBrowser({ connectionId, database, table, dbType, onClose, embedded = false, defaultTab, objectType, onRunSql, onInsertSql, isPro, onOpenLicense }: TableBrowserProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const isView = objectType === "VIEW"
  const editable = !isView
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [ddl, setDdl] = useState<string>("")
  const [ddlBusy, setDdlBusy] = useState(false)
  const [ddlMsg, setDdlMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)
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
  const [exportOpen, setExportOpen] = useState(false)

  const [dirtyRows, setDirtyRows] = useState<Map<number, Record<string, string>>>(new Map())
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  // --- 结构维护（列/索引/外键）：本地编辑 + 「应用」统一提交 ALTER ---
  const [structColumns, setStructColumns] = useState<EditableColumn[]>([])
  const [structOrigColumns, setStructOrigColumns] = useState<EditableColumn[]>([])
  const [structIndexes, setStructIndexes] = useState<IndexInfo[]>([])
  const [structOrigIndexes, setStructOrigIndexes] = useState<IndexInfo[]>([])
  const [structFks, setStructFks] = useState<ForeignKeyInfo[]>([])
  const [structOrigFks, setStructOrigFks] = useState<ForeignKeyInfo[]>([])
  const [otherTables, setOtherTables] = useState<string[]>([])
  const [structBusy, setStructBusy] = useState(false)
  const [structError, setStructError] = useState<string | null>(null)
  const [structSuccess, setStructSuccess] = useState(false)
  const structSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [newCol, setNewCol] = useState<ColumnDef>({ name: "", data_type: "VARCHAR(255)", nullable: true, primary_key: false, default_value: null })
  const [newIdx, setNewIdx] = useState<{ name: string; columns: string[]; unique: boolean }>({ name: "", columns: [], unique: false })
  const [newFk, setNewFk] = useState<{ name: string; column: string; refTable: string; refColumn: string }>({ name: "", column: "", refTable: "", refColumn: "" })

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

  const loadSchema = useCallback(async () => {
    try {
      const cache = await getSchemaCache(connectionId, database)
      const tbl = cache.tables.find((x) => x.table === table)
      if (!tbl) return
      const defs: EditableColumn[] = tbl.columns.map((c: ColumnInfo) => ({
        name: c.name,
        data_type: c.data_type,
        nullable: c.nullable,
        primary_key: c.key === "PRI",
        default_value: c.default_value ?? null,
        origName: c.name,
      }))
      setStructColumns(defs)
      setStructOrigColumns(defs.map((d) => ({ ...d })))
      setStructIndexes(tbl.indexes ?? [])
      setStructOrigIndexes(tbl.indexes ?? [])
      setStructFks(tbl.foreign_keys ?? [])
      setStructOrigFks(tbl.foreign_keys ?? [])
      setOtherTables(cache.tables.map((x) => x.table).filter((x) => x !== table))
    } catch (e: any) {
      setStructError(String(e))
    }
  }, [connectionId, database, table])

  useEffect(() => {
    loadSchema()
  }, [loadSchema])

  useEffect(() => () => {
    if (structSuccessTimer.current) clearTimeout(structSuccessTimer.current)
  }, [])

  async function runStructDdl(steps: (() => Promise<unknown>)[]) {
    setStructBusy(true)
    setStructError(null)
    setStructSuccess(false)
    try {
      for (const fn of steps) await fn()
      await loadSchema()
      await loadData()
      setStructOrigColumns(structColumns.map((d) => ({ ...d })))
      setStructOrigIndexes(structIndexes)
      setStructOrigFks(structFks)
      setStructSuccess(true)
      if (structSuccessTimer.current) clearTimeout(structSuccessTimer.current)
      structSuccessTimer.current = setTimeout(() => setStructSuccess(false), 3000)
    } catch (e: any) {
      setStructError(t('dialog.failed', { error: String(e) }))
      setStructSuccess(false)
    } finally {
      setStructBusy(false)
    }
  }

  function applyColumns() {
    const orig = new Map(structOrigColumns.map((c) => [c.origName ?? c.name, c]))
    const steps: (() => Promise<unknown>)[] = []
    for (const o of structOrigColumns) {
      const key = o.origName ?? o.name
      if (!structColumns.some((c) => (c.origName ?? c.name) === key)) {
        steps.push(() => alterDropColumn(connectionId, database, table, key))
      }
    }
    for (const c of structColumns) {
      const on = c.origName
      if (!on) {
        steps.push(() => alterAddColumn(connectionId, database, table, c))
        continue
      }
      const o = orig.get(on)
      if (!o) {
        steps.push(() => alterAddColumn(connectionId, database, table, c))
        continue
      }
      if (c.name !== o.name) {
        steps.push(() => alterRenameColumn(connectionId, database, table, o.name, c.name))
      }
      const changed =
        c.data_type !== o.data_type ||
        c.nullable !== o.nullable ||
        c.primary_key !== o.primary_key ||
        (c.default_value ?? null) !== (o.default_value ?? null)
      if (changed) {
        steps.push(() => alterModifyColumn(connectionId, database, table, c))
      }
    }
    return runStructDdl(steps)
  }

  function applyIndexes() {
    const orig = new Map(structOrigIndexes.map((i) => [i.name, i]))
    const steps: (() => Promise<unknown>)[] = []
    for (const i of structOrigIndexes) {
      if (!structIndexes.some((x) => x.name === i.name)) {
        steps.push(() => dropIndex(connectionId, database, table, i.name))
      }
    }
    for (const i of structIndexes) {
      if (!orig.has(i.name)) {
        const cols = (i.columns ?? []).join(",").split(",").map((s) => s.trim()).filter(Boolean)
        steps.push(() => createIndex(connectionId, database, table, i.name, cols, i.unique))
      }
    }
    return runStructDdl(steps)
  }

  function applyFks() {
    const key = (f: ForeignKeyInfo) => f.constraint_name ?? f.column_name
    const orig = new Map(structOrigFks.map((f) => [key(f), f]))
    const steps: (() => Promise<unknown>)[] = []
    for (const f of structOrigFks) {
      if (!structFks.some((x) => key(x) === key(f))) {
        steps.push(() => dropForeignKey(connectionId, database, table, key(f)))
      }
    }
    for (const f of structFks) {
      if (!orig.has(key(f))) {
        steps.push(() =>
          addForeignKey(connectionId, database, table, f.constraint_name ?? f.column_name, f.column_name, f.ref_table, f.ref_column),
        )
      }
    }
    return runStructDdl(steps)
  }

  function formatDdl() {
    try {
      setDdl(formatSql(ddl, dbType))
      setDdlMsg(null)
    } catch (e: any) {
      setDdlMsg({ type: "err", text: String(e) })
    }
  }

  async function applyDdl() {
    if (!onRunSql) return
    setDdlBusy(true)
    setDdlMsg(null)
    try {
      await onRunSql(ddl)
      await loadSchema()
      setDdlMsg({ type: "ok", text: t('dialog.success') })
    } catch (e: any) {
      setDdlMsg({ type: "err", text: String(e) })
    } finally {
      setDdlBusy(false)
    }
  }

  function quoteId(s: string): string {
    if (dbType === "mysql" || dbType === "sqlite") {
      return "`" + s.replace(/`/g, "``") + "`"
    }
    if (s.toLowerCase() !== s || /[^a-zA-Z0-9_]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  function escapeVal(v: unknown, numeric?: boolean): string {
    if (v === null || v === undefined) return "NULL"
    if (typeof v === "number") return String(v)
    if (typeof v === "boolean") return dbType === "postgresql" ? `'${v}'` : (v ? "1" : "0")
    const s = String(v)
    // Numeric columns: keep big integers / decimals unquoted so the exact
    // value round-trips (PostgreSQL rejects a quoted bigint literal).
    if (numeric && /^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(s.trim())) return s
    return "'" + s.replace(/'/g, "''") + "'"
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

  const numericColumns = useMemo(() => {
    if (!tableData) return new Set<string>()
    return new Set(
      tableData.columns
        .filter((c) => isNumericType(c.data_type))
        .map((c) => c.name)
    )
  }, [tableData])

  const columnTypes = useMemo(() => {
    if (!tableData) return {} as Record<string, string>
    const m: Record<string, string> = {}
    for (const c of tableData.columns) m[c.name] = c.data_type
    return m
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
    const conds = pks.map((pk) => `${quoteId(pk)} = ${escapeVal(handle[pk], numericColumns.has(pk))}`)
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
        const lit = binaryColumns.includes(col) ? binaryLiteral(val) : escapeVal(val, numericColumns.has(col))
        sql.push(`UPDATE ${qualified} SET ${quoteId(col)} = ${lit} ${where}`)
      }
    }

    for (const row of newRows) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined)
      if (cols.length === 0) continue
      const vals = cols.map((c) => binaryColumns.includes(c) ? binaryLiteral(row[c]) : escapeVal(row[c], numericColumns.has(c)))
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
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setExportOpen(true)} title="服务端导出整表（支持大表 / SQL）">
            <Download className="h-3 w-3 mr-1" />
            导出全部
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
      <Tabs defaultValue={defaultTab ?? "data"} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-3">
          <TabsList className="bg-transparent h-9">
            <TabsTrigger value="data" className="text-xs data-[state=active]:bg-background">
              <Table2 className="h-3.5 w-3.5 mr-1" />
              {t('tablebrowser.tab_data')}
            </TabsTrigger>
            {isPro && (
              <TabsTrigger value="columns" className="text-xs data-[state=active]:bg-background">
                <Info className="h-3.5 w-3.5 mr-1" />
                {t('tablebrowser.tab_columns')}
              </TabsTrigger>
            )}
            {!isView && isPro && (
              <TabsTrigger value="indexes" className="text-xs data-[state=active]:bg-background">
                {t('tablebrowser.tab_indexes')}
              </TabsTrigger>
            )}
            {!isView && isPro && (
              <TabsTrigger value="fks" className="text-xs data-[state=active]:bg-background">
                {t('tablebrowser.tab_fks')}
              </TabsTrigger>
            )}
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
              columnTypes={columnTypes}
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
        <TabsContent value="columns" className="flex-1 mt-0 min-h-0 flex flex-col">
          <div className="flex-1 overflow-auto">
            <table className="w-full table-fixed text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/80">
                <tr className="border-b">
                  <th className="text-left px-2 py-1.5 font-medium w-10">#</th>
                  <th className="text-left px-2 py-1.5 font-medium w-56 truncate">{t('dialog.col_name')}</th>
                  <th className="text-left px-2 py-1.5 font-medium w-44">{t('dialog.col_type')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-16">{t('dialog.col_nullable')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-12">{t('dialog.col_pk')}</th>
                  <th className="text-left px-2 py-1.5 font-medium w-36">{t('dialog.col_default')}</th>
                  <th className="w-8" />
                  <th />
                </tr>
              </thead>
              <tbody>
                {structColumns.map((col, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1">
                      <Input
                        value={col.name}
                        disabled={!editable}
                        onChange={(e) => setStructColumns((p) => p.map((c, idx) => (idx === i ? { ...c, name: e.target.value } : c)))}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <TypeCombobox
                        value={col.data_type}
                        disabled={structBusy || !editable}
                        onChange={(v) => setStructColumns((p) => p.map((c, idx) => (idx === i ? { ...c, data_type: v } : c)))}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={col.nullable}
                        disabled={!editable}
                        onCheckedChange={(v) => setStructColumns((p) => p.map((c, idx) => (idx === i ? { ...c, nullable: v === true } : c)))}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={col.primary_key}
                        disabled={!editable}
                        onCheckedChange={(v) =>
                          setStructColumns((p) => p.map((c, idx) => (idx === i ? { ...c, primary_key: v === true, nullable: v === true ? false : c.nullable } : c)))
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={col.default_value ?? ""}
                        disabled={!editable}
                        onChange={(e) => setStructColumns((p) => p.map((c, idx) => (idx === i ? { ...c, default_value: e.target.value || null } : c)))}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={t('dialog.design_drop_col')}
                        disabled={!editable || structBusy}
                        onClick={() => setStructColumns((p) => p.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                    <td />
                  </tr>
                ))}
                {structColumns.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">
                      {t('tablebrowser.no_columns')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {editable && (
            <div className="flex items-end gap-2 border-t p-2">
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.col_name')}</label>
                <Input value={newCol.name} onChange={(e) => setNewCol((p) => ({ ...p, name: e.target.value }))} className="h-7 text-xs" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.col_type')}</label>
                <TypeCombobox
                  value={newCol.data_type}
                  disabled={structBusy}
                  onChange={(v) => setNewCol((p) => ({ ...p, data_type: v }))}
                />
              </div>
              <Button
                size="sm"
                className="text-xs"
                disabled={!newCol.name.trim() || structBusy}
                onClick={() => {
                  setStructColumns((p) => [...p, { ...newCol, name: newCol.name.trim(), origName: undefined }])
                  setNewCol({ name: "", data_type: "VARCHAR(255)", nullable: true, primary_key: false, default_value: null })
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('dialog.design_add')}
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2 border-t px-2 py-2">
            {editable ? (
              <>
                <Button size="sm" onClick={applyColumns} disabled={structBusy}>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {t('dialog.apply')}
                </Button>
                <Button size="sm" variant="outline" onClick={loadSchema} disabled={structBusy}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  {t('dialog.reset')}
                </Button>
                {structError && <span className="text-xs text-destructive break-all">{structError}</span>}
                {structSuccess && <span className="text-xs text-emerald-600">{t('dialog.success')}</span>}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{t('tablebrowser.view_columns_readonly')}</span>
            )}
          </div>
        </TabsContent>

        <TabsContent value="indexes" className="flex-1 mt-0 min-h-0 flex flex-col">
          <div className="flex-1 overflow-auto border rounded m-2">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr className="border-b">
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.idx_name')}</th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.idx_columns')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-16">{t('dialog.idx_unique')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {structIndexes.map((idx, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">{idx.name}</td>
                    <td className="px-2 py-1">{(idx.columns ?? []).join(", ")}</td>
                    <td className="px-2 py-1 text-center">{idx.unique ? "✓" : ""}</td>
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={t('dialog.idx_drop')}
                        disabled={structBusy}
                        onClick={() => setStructIndexes((p) => p.filter((_, x) => x !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {structIndexes.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">{t('dialog.no_indexes')}</p>
            )}
          </div>
          <div className="flex items-end gap-2 border rounded p-2 m-2 mt-0">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.idx_name')}</label>
              <Input
                value={newIdx.name}
                onChange={(e) => setNewIdx((p) => ({ ...p, name: e.target.value }))}
                className="h-7 text-xs"
                placeholder={`idx_${table}_`}
              />
            </div>
            <div className="flex-[2]">
              <label className="text-[10px] text-muted-foreground">{t('dialog.idx_columns')}</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-7 w-full justify-between text-xs font-normal" disabled={structBusy}>
                    <span className="truncate">
                      {newIdx.columns.length > 0 ? newIdx.columns.join(", ") : t('dialog.idx_pick_columns')}
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2">
                  <div className="max-h-52 overflow-auto space-y-1">
                    {structColumns.length === 0 && (
                      <p className="text-xs text-muted-foreground px-1">{t('dialog.no_columns')}</p>
                    )}
                    {structColumns.map((c) => {
                      const checked = newIdx.columns.includes(c.name)
                      return (
                        <label key={c.name} className="flex items-center gap-2 text-xs px-1 py-0.5 rounded hover:bg-accent cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setNewIdx((p) => ({
                                ...p,
                                columns: v === true ? [...p.columns, c.name] : p.columns.filter((n) => n !== c.name),
                              }))
                            }
                          />
                          <span className="truncate">{c.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-1 pb-1.5">
              <Checkbox checked={newIdx.unique} onCheckedChange={(v) => setNewIdx((p) => ({ ...p, unique: v === true }))} id="new-idx-unique" />
              <label htmlFor="new-idx-unique" className="text-xs">{t('dialog.idx_unique')}</label>
            </div>
            <Button
              size="sm"
              className="text-xs"
              disabled={!newIdx.name.trim() || newIdx.columns.length === 0 || structBusy}
              onClick={() => {
                const name = newIdx.name.trim()
                const cols = newIdx.columns
                setStructIndexes((p) => [...p, { name, columns: cols, unique: newIdx.unique, index_type: "" }])
                setNewIdx({ name: "", columns: [], unique: false })
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('dialog.idx_add')}
            </Button>
          </div>
          <div className="flex items-center gap-2 px-2 pb-2">
            <Button size="sm" onClick={applyIndexes} disabled={structBusy}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {t('dialog.apply')}
            </Button>
            <Button size="sm" variant="outline" onClick={loadSchema} disabled={structBusy}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {t('dialog.reset')}
            </Button>
            {structError && <span className="text-xs text-destructive break-all">{structError}</span>}
            {structSuccess && <span className="text-xs text-emerald-600">{t('dialog.success')}</span>}
          </div>
        </TabsContent>

        <TabsContent value="fks" className="flex-1 mt-0 min-h-0 flex flex-col">
          <div className="flex-1 overflow-auto border rounded m-2">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr className="border-b">
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_name')}</th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_column')}</th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_ref_table')}</th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_ref_column')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {structFks.map((fk, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">{fk.constraint_name ?? fk.column_name}</td>
                    <td className="px-2 py-1">{fk.column_name}</td>
                    <td className="px-2 py-1">{fk.ref_table}</td>
                    <td className="px-2 py-1">{fk.ref_column}</td>
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={t('dialog.fk_drop')}
                        disabled={structBusy}
                        onClick={() => setStructFks((p) => p.filter((_, x) => x !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {structFks.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">{t('dialog.no_fks')}</p>
            )}
          </div>
          <div className="flex items-end gap-2 border rounded p-2 m-2 mt-0">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.fk_name')}</label>
              <Input value={newFk.name} onChange={(e) => setNewFk((p) => ({ ...p, name: e.target.value }))} className="h-7 text-xs" placeholder={`fk_${table}_`} />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.fk_column')}</label>
              <Select value={newFk.column} onValueChange={(v) => setNewFk((p) => ({ ...p, column: v }))}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={t('dialog.fk_column')} />
                </SelectTrigger>
                <SelectContent>
                  {structColumns.filter((c) => !c.primary_key).map((c) => (
                    <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.fk_ref_table')}</label>
              <Select value={newFk.refTable} onValueChange={(v) => setNewFk((p) => ({ ...p, refTable: v, refColumn: "" }))}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={t('dialog.fk_ref_table')} />
                </SelectTrigger>
                <SelectContent>
                  {otherTables.map((tb) => (
                    <SelectItem key={tb} value={tb}>{tb}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.fk_ref_column')}</label>
              <Input value={newFk.refColumn} onChange={(e) => setNewFk((p) => ({ ...p, refColumn: e.target.value }))} className="h-7 text-xs" placeholder="id" />
            </div>
            <Button
              size="sm"
              className="text-xs"
              disabled={!newFk.name.trim() || !newFk.column || !newFk.refTable || !newFk.refColumn.trim() || structBusy}
              onClick={() => {
                const name = newFk.name.trim()
                setStructFks((p) => [...p, { constraint_name: name, column_name: newFk.column, ref_table: newFk.refTable, ref_column: newFk.refColumn.trim() }])
                setNewFk({ name: "", column: "", refTable: "", refColumn: "" })
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('dialog.fk_add')}
            </Button>
          </div>
          <div className="flex items-center gap-2 px-2 pb-2">
            <Button size="sm" onClick={applyFks} disabled={structBusy}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {t('dialog.apply')}
            </Button>
            <Button size="sm" variant="outline" onClick={loadSchema} disabled={structBusy}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {t('dialog.reset')}
            </Button>
            {structError && <span className="text-xs text-destructive break-all">{structError}</span>}
            {structSuccess && <span className="text-xs text-emerald-600">{t('dialog.success')}</span>}
          </div>
          {dbType === "sqlite" && (
            <p className="text-[11px] text-muted-foreground px-2 pb-2">{t('dialog.fk_unsupported')}</p>
          )}
        </TabsContent>
        <TabsContent value="ddl" className="flex-1 mt-0 min-h-0 data-[state=active]:flex flex-col">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Button size="sm" variant="outline" onClick={formatDdl} disabled={ddlBusy || !ddl}>
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              {t('editor.format')}
            </Button>
            <Button size="sm" onClick={() => { if (!isPro) { onOpenLicense?.(); return } applyDdl() }} disabled={ddlBusy || !ddl || !onRunSql}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {t('tablebrowser.apply_ddl')}
            </Button>
            {onInsertSql && (
              <Button size="sm" variant="ghost" onClick={() => onInsertSql(ddl)} disabled={ddlBusy || !ddl}>
                <PenLine className="h-3.5 w-3.5 mr-1" />
                {t('tablebrowser.open_in_editor')}
              </Button>
            )}
            {ddlMsg && (
              <span className={cn("text-xs break-all", ddlMsg.type === "ok" ? "text-emerald-600" : "text-destructive")}>
                {ddlMsg.text}
              </span>
            )}
            {!isPro && (
              <span className="text-xs text-muted-foreground ml-auto">{t('tablebrowser.ddl_pro_only')}</span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              defaultLanguage="sql"
              theme={theme === "dark" ? "vs-dark" : "light"}
              value={ddl}
              onChange={(v) => {
                setDdl(v ?? "")
                setDdlMsg(null)
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                wordWrap: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
      <ValueEditorDialog
        open={largeEditCell !== null}
        tableName={table}
        column={largeEditCell?.col ?? ""}
        columnType={largeEditCell ? columnTypes[largeEditCell.col] : undefined}
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
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        connectionId={connectionId}
        query={`SELECT * FROM ${qualified}`}
        table={table}
        defaultName={table}
      />
      </>
      )}
    </div>
  )
}

function TypeCombobox({ value, options, onChange, disabled }: { value: string; options?: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  const [typed, setTyped] = useState(false)
  const selectedRef = useRef(false)
  useEffect(() => {
    setText(value)
    setTyped(false)
  }, [value])
  const list = options ?? COMMON_TYPES
  const filtered = useMemo(
    () => (typed ? list.filter((tp) => tp.toLowerCase().includes(text.toLowerCase())) : list),
    [typed, text, list],
  )
  return (
    <div className="relative">
      <Input
        value={text}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value)
          setText(e.target.value)
          setTyped(true)
        }}
        onFocus={() => {
          setOpen(true)
          setTyped(false)
        }}
        className="h-7 text-xs pr-7"
      />
      <Popover
        open={open && !disabled}
        onOpenChange={(o) => {
          if (!o && !selectedRef.current) onChange(text)
          selectedRef.current = false
          setOpen(o)
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" tabIndex={-1} className="absolute right-0 top-0 h-7 w-7" title={t('dialog.pick_type')}>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="max-h-52 overflow-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1">{t('dialog.no_type_match')}</p>
            ) : (
              filtered.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent"
                  onClick={() => {
                    selectedRef.current = true
                    onChange(tp)
                    setText(tp)
                    setTyped(false)
                    setOpen(false)
                  }}
                >
                  {tp}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
