import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Table2, Info, Download } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DataTable } from "./DataTable"
import { PlanView } from "./PlanView"
import { save } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { toCsv, toJson } from "@/lib/sql"
import { buildXlsx } from "@/lib/xlsx"
import type { ExecResult } from "@/lib/db"

interface ResultPanelProps {
  results: ExecResult[] | null
}

async function exportResult(result: ExecResult, format: "csv" | "json" | "xlsx", ext: string) {
  if (result.columns.length === 0 || result.error) return
  const defaultPath = `export_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.${ext}`
  const filters = format === "xlsx"
    ? [{ name: "Excel", extensions: ["xlsx"] }]
    : [{ name: ext.toUpperCase(), extensions: [ext] }]
  const path = await save({ defaultPath, filters })
  if (!path) return
  if (format === "xlsx") {
    const bytes = buildXlsx(result.columns, result.rows.map((r) => result.columns.map((c) => r[c] ?? null)))
    await invoke("write_binary_file", { path, data: Array.from(bytes) })
    return
  }
  const content = format === "csv" ? toCsv(result.columns, result.rows) : toJson(result.rows)
  await invoke("write_text_file", { path, content })
}

export function ResultPanel({ results }: ResultPanelProps) {
  const { t } = useTranslation()
  const [activeIndex, setActiveIndex] = useState(0)

  const effective = results && results.length > 0 ? results : null
  useEffect(() => {
    if (effective && activeIndex >= effective.length) {
      setActiveIndex(Math.max(0, effective.length - 1))
    }
    if (!effective) setActiveIndex(0)
  }, [effective, activeIndex])

  if (!effective) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <div className="text-center">
          <p>{t('resultpanel.empty_title')}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{t('resultpanel.empty_hint')}</p>
        </div>
      </div>
    )
  }

  const single = effective.length === 1
  const active = effective[Math.min(activeIndex, effective.length - 1)]

  const statusBar = (
    <div className="flex items-center gap-3 border-t bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
      <span>
        {t('resultpanel.rows')}: <span className="font-mono">{active.rowCount}</span>
      </span>
      <span>
        {t('resultpanel.duration')}: <span className="font-mono">{active.duration}</span>
      </span>
      {active.error && <span className="ml-auto truncate max-w-[50%] text-destructive">{active.error}</span>}
    </div>
  )

  const exportBar = !active.error && active.columns.length > 0 && (
    <div className="flex items-center justify-end gap-1 border-b px-3 py-1">
      <span className="text-[10px] text-muted-foreground mr-auto">
        {t('resultpanel.duration')}: <span className="font-mono">{active.duration}</span> · {t('resultpanel.rows')}:{" "}
        <span className="font-mono">{active.rowCount}</span> · {t('resultpanel.columns')}:{" "}
        <span className="font-mono">{active.columns.length}</span>
      </span>
      <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={() => exportResult(active, "csv", "csv")}>
        <Download className="h-3 w-3" />
        {t('resultpanel.export_csv')}
      </Button>
      <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={() => exportResult(active, "json", "json")}>
        <Download className="h-3 w-3" />
        {t('resultpanel.export_json')}
      </Button>
      <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={() => exportResult(active, "xlsx", "xlsx")}>
        <Download className="h-3 w-3" />
        {t('resultpanel.export_xlsx')}
      </Button>
    </div>
  )

  if (!single) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center border-b overflow-x-auto">
          {effective.map((r, i) => (
            <button
              key={r.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-r whitespace-nowrap ${
                i === activeIndex ? "bg-background text-foreground font-medium" : "text-muted-foreground hover:bg-background/60"
              }`}
              onClick={() => setActiveIndex(i)}
            >
              <span>{r.title}</span>
              {r.rowCount > 0 && (
                <span className="rounded bg-muted px-1 py-0 text-[10px] font-mono">{r.rowCount}</span>
              )}
              {r.error && <span className="text-[10px] text-destructive">!</span>}
            </button>
          ))}
        </div>
        {exportBar}
        <div className="flex-1 min-h-0">
          {active.isPlan ? (
            <PlanView columns={active.columns} rows={active.rows} />
          ) : (
            <DataTable
              columns={active.columns}
              rows={active.rows}
              error={active.error}
              rowCount={active.rowCount}
            />
          )}
        </div>
        {statusBar}
      </div>
    )
  }

  return (
    <Tabs defaultValue="results" className="h-full flex flex-col">
      <div className="border-b px-3">
        <TabsList className="bg-transparent h-9">
          <TabsTrigger value="results" className="text-xs data-[state=active]:bg-background">
            <Table2 className="h-3.5 w-3.5 mr-1" />
            {t('resultpanel.tab_results')}
            {active.rowCount > 0 && (
              <span className="ml-1.5 rounded bg-muted px-1 py-0 text-[10px] font-mono">
                {active.rowCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="info" className="text-xs data-[state=active]:bg-background">
            <Info className="h-3.5 w-3.5 mr-1" />
            {t('resultpanel.tab_info')}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="results" className="flex-1 mt-0 min-h-0 data-[state=active]:flex flex-col">
        {exportBar}
        <div className="flex-1 min-h-0">
          {active.isPlan ? (
            <PlanView columns={active.columns} rows={active.rows} />
          ) : (
            <DataTable
              columns={active.columns}
              rows={active.rows}
              error={active.error}
              rowCount={active.rowCount}
            />
          )}
        </div>
      </TabsContent>
      <TabsContent value="info" className="flex-1 mt-0 p-3 min-h-0">
        <div className="text-xs space-y-2 text-muted-foreground">
          <div className="flex justify-between">
            <span>{t('resultpanel.duration')}</span>
            <span className="font-mono">{active.duration}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('resultpanel.rows')}</span>
            <span className="font-mono">{active.rowCount}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('resultpanel.columns')}</span>
            <span className="font-mono">{active.columns.length}</span>
          </div>
          {active.columns.length > 0 && (
            <div>
              <p className="font-medium mb-1 mt-3">{t('resultpanel.columns_heading')}</p>
              <div className="space-y-0.5">
                {active.columns.map((col) => (
                  <div key={col} className="flex items-center gap-2 text-[11px]">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                    {col}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TabsContent>
      {statusBar}
    </Tabs>
  )
}
