import { useState, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Table2, Info, Code, Download, X } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DataTable } from "./DataTable"
import type { TableData, DatabaseType } from "@/lib/db"

interface TableBrowserProps {
  connectionId: string
  database: string
  table: string
  dbType: DatabaseType
  onClose?: () => void
}

export function TableBrowser({ connectionId, database, table, dbType, onClose }: TableBrowserProps) {
  const { t } = useTranslation()
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [ddl, setDdl] = useState<string>("")
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<string>("asc")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result: TableData = await invoke("get_table_data", {
        id: connectionId,
        database,
        table,
        page,
        pageSize,
        sortColumn: sortColumn || null,
        sortOrder: sortColumn ? sortOrder : null,
      })
      setTableData(result)
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, table, page, pageSize, sortColumn, sortOrder])

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

  const handleCellEdit = useCallback(async (rowIndex: number, columnName: string, newValue: string) => {
    setEditingCell(null)
    if (!tableData) return
    const row = tableData.rows[rowIndex]
    const origValue = row[columnName]
    if (String(origValue ?? "") === newValue) return

    const handle = tableData.row_handles[rowIndex] || {}
    let whereClause = ""
    const rowid = handle["__rowid__"] ?? handle["ROWID2"]
    if (rowid !== undefined) {
      whereClause = dbType === "oracle"
        ? `WHERE ROWID = CHARTOROWID(${escapeVal(rowid)})`
        : `WHERE ROWID = ${escapeVal(rowid)}`
    } else {
      const pks = tableData.primary_keys.length > 0 ? tableData.primary_keys : Object.keys(handle)
      if (pks.length === 0) {
        setError(t('tablebrowser.no_pk'))
        return
      }
      const conds = pks.map((pk) => `${quoteId(pk)} = ${escapeVal(handle[pk])}`)
      whereClause = `WHERE ${conds.join(" AND ")}`
    }

    const qualified = table.includes(".") ? table.split(".").map(quoteId).join(".") : quoteId(table)
    const sql = `UPDATE ${qualified} SET ${quoteId(columnName)} = ${escapeVal(newValue)} ${whereClause}`

    setLoading(true)
    try {
      await invoke<TableData>("execute_update", { id: connectionId, query: sql })
      const updated = tableData.rows.map((r, i) =>
        i === rowIndex ? { ...r, [columnName]: newValue } : r
      )
      setTableData({ ...tableData, rows: updated })
    } catch (e: any) {
      setError(String(e))
      loadData()
    } finally {
      setLoading(false)
    }
  }, [tableData, table, dbType, connectionId, t, loadData])

  const totalPages = tableData ? Math.ceil(tableData.total / pageSize) : 1

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setSortColumn(col)
      setSortOrder("asc")
    }
    setPage(1)
  }

  const exportCsv = () => {
    if (!tableData) return
    const headers = tableData.columns.map((c) => c.name)
    const csvRows = [headers.join(",")]
    for (const row of tableData.rows) {
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/30">
        <div className="flex items-center gap-2">
          <Table2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium">{table}</span>
          {onClose && (
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 ml-1" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          )}
          {tableData && (
            <span className="text-[10px] text-muted-foreground">
              {t('tablebrowser.rows_info', { count: tableData.total, duration: tableData.duration })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={exportCsv}>
            <Download className="h-3 w-3 mr-1" />
            {t('tablebrowser.csv')}
          </Button>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
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
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
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
              rows={tableData.rows}
              sortColumn={sortColumn}
              sortOrder={sortOrder}
              onSort={handleSort}
              editingCell={editingCell}
              onCellEditStart={(row, col) => setEditingCell(row < 0 ? null : { row, col })}
              onCellEdit={handleCellEdit}
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
    </div>
  )
}
