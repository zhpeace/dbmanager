import { useState, useEffect, useCallback } from "react"
import { invokeWithTimeout } from "@/lib/invoke"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Info, Code, X, RefreshCw, Save, Trash2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import type { TableData } from "@/lib/db"

interface RedisKeyInfo {
  key: string
  key_type: string
  ttl: number
  value: unknown
  size: number
  encoding: string
  refcount: number
  idletime: number
  memory_usage: number | null
  n_elements: number
}

interface RedisValuePanelProps {
  connectionId: string
  database: string
  table: string
  onClose?: () => void
}

type Format = "text" | "json" | "hex" | "ascii" | "base64"

function formatStringValue(v: string, format: Format): string {
  switch (format) {
    case "json": {
      try {
        return JSON.stringify(JSON.parse(v), null, 2)
      } catch {
        return v
      }
    }
    case "hex": {
      let out = ""
      for (let i = 0; i < v.length; i++) {
        out += v.charCodeAt(i).toString(16).padStart(2, "0")
        if ((i + 1) % 16 === 0) out += "\n"
        else out += " "
      }
      return out.trimEnd()
    }
    case "base64": {
      try {
        return btoa(unescape(encodeURIComponent(v)))
      } catch {
        return v
      }
    }
    case "ascii":
      return v.replace(/[^\x20-\x7E]/g, "�")
    default:
      return v
  }
}

export function RedisValuePanel({ connectionId, database, table, onClose }: RedisValuePanelProps) {
  const { t } = useTranslation()
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [keyInfo, setKeyInfo] = useState<RedisKeyInfo | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stringValue, setStringValue] = useState("")
  const [stringFormat, setStringFormat] = useState<Format>("text")
  const [saving, setSaving] = useState(false)

  const keyType = keyInfo?.key_type || tableData?.columns[0]?.data_type || "string"
  const isString = keyType === "string"

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result: TableData = await invokeWithTimeout("get_table_data", {
        id: connectionId,
        database,
        table,
        page,
        pageSize,
        sortColumn: null,
        sortOrder: null,
        whereClause: null,
      })
      setTableData(result)
      if (isString) {
        const first = result.rows[0]
        setStringValue(typeof first?.value === "string" ? first.value : "")
      }
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, table, page, pageSize, isString])

  const loadInfo = useCallback(async () => {
    try {
      const info: RedisKeyInfo = await invokeWithTimeout("redis_key_info", { id: connectionId, database, key: table })
      setKeyInfo(info)
    } catch (e: any) {
      setError(String(e))
    }
  }, [connectionId, database, table])

  useEffect(() => {
    loadData()
    loadInfo()
  }, [loadData, loadInfo])

  const refresh = () => {
    setPage(1)
    loadData()
    loadInfo()
  }

  const saveString = async () => {
    setSaving(true)
    try {
      await invokeWithTimeout("redis_command", { id: connectionId, database, command: "SET", args: [table, stringValue] })
      await loadData()
    } catch (e: any) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const setTtl = async () => {
    const secs = window.prompt(t('redispanel.ttl_prompt'), keyInfo?.ttl != null && keyInfo.ttl > 0 ? String(keyInfo.ttl) : "300")
    const n = Number(secs)
    if (secs === null || Number.isNaN(n)) return
    try {
      if (n > 0) {
        await invokeWithTimeout("redis_command", { id: connectionId, database, command: "EXPIRE", args: [table, String(Math.floor(n))] })
      } else {
        await invokeWithTimeout("redis_command", { id: connectionId, database, command: "PERSIST", args: [table] })
      }
      await loadInfo()
    } catch (e: any) {
      setError(String(e))
    }
  }

  const deleteKey = async () => {
    if (!window.confirm(t('redispanel.delete_confirm', { key: table }))) return
    try {
      await invokeWithTimeout("redis_command", { id: connectionId, database, command: "DEL", args: [table] })
      onClose?.()
    } catch (e: any) {
      setError(String(e))
    }
  }

  const totalPages = tableData ? Math.max(1, Math.ceil(tableData.total / pageSize)) : 1
  const rowCount = tableData?.rows.length ?? 0
  const fmtTtl = (ttl: number) =>
    ttl < 0 ? "∞" : ttl >= 86400 ? `${Math.floor(ttl / 86400)}d` : ttl >= 3600 ? `${Math.floor(ttl / 3600)}h` : ttl >= 60 ? `${Math.floor(ttl / 60)}m` : `${ttl}s`

  const columns = tableData?.columns ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-3 py-1.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-primary font-medium truncate" title={table}>{table}</span>
          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold shrink-0">{keyType}</span>
          {keyInfo && (
            <span className="text-[10px] text-muted-foreground shrink-0">{t('redispanel.ttl_label', { ttl: fmtTtl(keyInfo.ttl) })}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={refresh} disabled={loading}>
            <RefreshCw className="h-3 w-3 mr-1" />
            {t('tablebrowser.refresh')}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={deleteKey}>
            <Trash2 className="h-3 w-3 mr-1" />
            {t('redispanel.delete_key')}
          </Button>
          {onClose && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b px-3 py-1.5 text-xs text-destructive break-all">{error}</div>
      )}

      <Tabs defaultValue="data" className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-3">
          <TabsList className="bg-transparent h-9">
            <TabsTrigger value="data" className="text-xs data-[state=active]:bg-background">
              <Info className="h-3.5 w-3.5 mr-1" />
              {t('tablebrowser.tab_data')}
            </TabsTrigger>
            <TabsTrigger value="info" className="text-xs data-[state=active]:bg-background">
              <Info className="h-3.5 w-3.5 mr-1" />
              {t('redispanel.tab_info')}
            </TabsTrigger>
            <TabsTrigger value="value" className="text-xs data-[state=active]:bg-background">
              <Code className="h-3.5 w-3.5 mr-1" />
              {t('redispanel.tab_value')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="data" className="flex-1 mt-0 min-h-0 data-[state=active]:flex flex-col">
          <div className="flex items-center gap-1 border-b px-3 py-1 justify-between">
            {isString ? (
              <div className="flex items-center gap-1">
                {(["text", "json", "hex", "ascii", "base64"] as Format[]).map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={stringFormat === f ? "default" : "ghost"}
                    className="h-5 px-1.5 text-[10px] uppercase"
                    onClick={() => setStringFormat(f)}
                  >
                    {f}
                  </Button>
                ))}
              </div>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {t('redispanel.elements', { count: rowCount, total: tableData?.total ?? 0 })}
              </span>
            )}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {tableData && (
                <span className="mr-2 text-[10px] hidden sm:inline">
                  {t('tablebrowser.rows_info', { count: tableData.total, duration: tableData.duration })}
                </span>
              )}
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="min-w-[60px] text-center tabular-nums">
                {t('tablebrowser.pagination', { page, total: totalPages })}
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                {t('tablebrowser.loading')}
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-xs text-destructive">{error}</div>
            ) : isString ? (
              <div className="flex flex-col h-full">
                <textarea
                  className="flex-1 w-full resize-none bg-transparent p-3 font-mono text-xs outline-none"
                  value={stringValue}
                  onChange={(e) => setStringValue(e.target.value)}
                  placeholder={t('redispanel.empty_value')}
                />
                {stringFormat !== "text" && (
                  <pre className="max-h-48 overflow-auto border-t p-3 font-mono text-xs whitespace-pre-wrap break-all bg-muted/30">
                    {formatStringValue(stringValue, stringFormat)}
                  </pre>
                )}
                <div className="flex items-center gap-2 border-t px-3 py-1.5">
                  <Button size="sm" variant="default" className="h-7 gap-1" onClick={saveString} disabled={saving || stringValue === (tableData?.rows[0]?.value as string)}>
                    <Save className="h-3.5 w-3.5" />
                    {t('redispanel.save_value')}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">{t('redispanel.string_hint')}</span>
                </div>
              </div>
            ) : tableData && rowCount > 0 ? (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-muted/80">
                  <tr className="border-b">
                    {columns.map((c) => (
                      <th key={c.name} className="text-left px-3 py-1.5 font-medium text-muted-foreground">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/40">
                      {columns.map((c) => (
                        <td key={c.name} className="px-3 py-1 font-mono whitespace-pre-wrap break-all">
                          {String(row[c.name] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                {t('tablebrowser.no_data')}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="info" className="flex-1 mt-0 min-h-0 overflow-auto p-3">
          {keyInfo ? (
            <div className="max-w-xl space-y-2">
              {[
                { label: t('redispanel.key'), value: keyInfo.key, mono: true },
                { label: t('redispanel.type'), value: keyInfo.key_type },
                { label: t('redispanel.encoding'), value: keyInfo.encoding || "-" },
                { label: t('redispanel.ttl'), value: fmtTtl(keyInfo.ttl), mono: true },
                { label: t('redispanel.refcount'), value: String(keyInfo.refcount), mono: true },
                { label: t('redispanel.idletime'), value: String(keyInfo.idletime), mono: true },
                { label: t('redispanel.memory'), value: keyInfo.memory_usage != null ? formatBytes(keyInfo.memory_usage) : "-" },
                { label: t('redispanel.elements'), value: String(keyInfo.n_elements), mono: true },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between border-b border-border/50 pb-1.5">
                  <span className="text-xs text-muted-foreground">{row.label}</span>
                  <span className={`text-xs font-medium ${row.mono ? "font-mono" : ""}`}>{row.value}</span>
                </div>
              ))}
              <div className="pt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={setTtl}>
                  {t('redispanel.set_ttl')}
                </Button>
                {keyInfo.ttl > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => {
                    try {
                      await invokeWithTimeout("redis_command", { id: connectionId, database, command: "PERSIST", args: [table] })
                      await loadInfo()
                    } catch (e: any) {
                      setError(String(e))
                    }
                  }}>
                    {t('redispanel.persist')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{t('tablebrowser.loading')}</div>
          )}
        </TabsContent>

        <TabsContent value="value" className="flex-1 mt-0 min-h-0 overflow-auto p-3">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {tableData ? JSON.stringify(tableData.rows, null, 2) : t('tablebrowser.loading')}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}
