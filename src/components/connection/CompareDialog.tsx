import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowRight, CheckCircle, XCircle, AlertTriangle } from "lucide-react"
import type { Connection, DatabaseInfo, CompareResult } from "@/lib/db"
import { compareSchemas } from "@/lib/db"

interface CompareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
}

const statusColor: Record<string, string> = {
  match: "text-green-500",
  differs: "text-amber-500",
  only_in_source: "text-blue-500",
  only_in_target: "text-orange-500",
  missing_in_target: "text-red-400",
  extra_in_target: "text-orange-400",
  missing: "text-red-500",
  type_mismatch: "text-amber-500",
  nullable_mismatch: "text-amber-500",
  default_mismatch: "text-amber-500",
  key_mismatch: "text-amber-500",
}

const statusIcon = (s: string) => {
  if (s === "match") return <CheckCircle className="h-3 w-3 text-green-500" />
  if (s === "differs") return <AlertTriangle className="h-3 w-3 text-amber-500" />
  if (s === "only_in_source") return <ArrowRight className="h-3 w-3 text-blue-500" />
  if (s === "only_in_target") return <XCircle className="h-3 w-3 text-orange-500" />
  return <AlertTriangle className="h-3 w-3 text-amber-500" />
}

export function CompareDialog({ open, onOpenChange, connections }: CompareDialogProps) {
  const { t } = useTranslation()
  const connected = connections.filter((c) => c.connected)
  const [sourceId, setSourceId] = useState("")
  const [sourceDb, setSourceDb] = useState("")
  const [targetId, setTargetId] = useState("")
  const [targetDb, setTargetDb] = useState("")
  const [sourceDbs, setSourceDbs] = useState<DatabaseInfo[]>([])
  const [targetDbs, setTargetDbs] = useState<DatabaseInfo[]>([])
  const [comparing, setComparing] = useState(false)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())

  const handleSourceChange = async (id: string) => {
    setSourceId(id)
    setSourceDb("")
    setSourceDbs([])
    setResult(null)
    try {
      const dbs: DatabaseInfo[] = await import("@tauri-apps/api/core").then(m => m.invoke("get_databases", { id }))
      setSourceDbs(dbs)
    } catch {}
  }

  const handleTargetChange = async (id: string) => {
    setTargetId(id)
    setTargetDb("")
    setTargetDbs([])
    setResult(null)
    try {
      const dbs: DatabaseInfo[] = await import("@tauri-apps/api/core").then(m => m.invoke("get_databases", { id }))
      setTargetDbs(dbs)
    } catch {}
  }

  const handleCompare = async () => {
    if (!sourceId || !targetId || !sourceDb || !targetDb) return
    setComparing(true)
    setResult(null)
    try {
      const res = await compareSchemas(sourceId, sourceDb, targetId, targetDb)
      setResult(res)
    } catch (e: any) {
      setResult({
        tables: [],
        extra_in_source: [],
        extra_in_target: [],
        summary: `Error: ${e}`,
      })
    } finally {
      setComparing(false)
    }
  }

  const toggleTable = (name: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('compare.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
            <div className="space-y-2">
              <Label className="text-xs">{t('compare.source')}</Label>
              <Select value={sourceId} onValueChange={handleSourceChange}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('compare.select_source')} /></SelectTrigger>
                <SelectContent>
                  {connected.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sourceId && (
                <Select value={sourceDb} onValueChange={setSourceDb}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('compare.select_database')} /></SelectTrigger>
                  <SelectContent>
                    {sourceDbs.map((d) => (
                      <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-center justify-center">
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{t('compare.target')}</Label>
              <Select value={targetId} onValueChange={handleTargetChange}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('compare.select_target')} /></SelectTrigger>
                <SelectContent>
                  {connected.filter((c) => c.id !== sourceId).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetId && (
                <Select value={targetDb} onValueChange={setTargetDb}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('compare.select_database')} /></SelectTrigger>
                  <SelectContent>
                    {targetDbs.map((d) => (
                      <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Button
            className="w-full h-8 text-xs"
            onClick={handleCompare}
            disabled={!sourceId || !targetId || !sourceDb || !targetDb || comparing}
          >
            {comparing ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
            {comparing ? t('compare.comparing') : t('compare.compare')}
          </Button>

          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span>{result.summary}</span>
              </div>

              {result.tables.length > 0 && (
                <div className="border rounded divide-y max-h-[400px] overflow-y-auto">
                  {result.tables.map((tbl) => (
                    <div key={tbl.table}>
                      <button
                        onClick={() => toggleTable(tbl.table)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-accent/30 text-left"
                      >
                        {statusIcon(tbl.status)}
                        <span className={statusColor[tbl.status] || ""}>{tbl.table}</span>
                        <span className="text-muted-foreground ml-auto">
                          {tbl.columns.filter(c => c.status !== "match").length > 0
                            ? `${tbl.columns.filter(c => c.status !== "match").length} ${t('compare.diffs')}`
                            : t('compare.ok')}
                        </span>
                      </button>
                      {expandedTables.has(tbl.table) && (
                        <div className="px-6 pb-2 space-y-1">
                          {tbl.columns.length > 0 && (
                            <table className="w-full text-[10px] font-mono">
                              <thead>
                                <tr className="text-muted-foreground">
                                  <th className="text-left pr-2">{t('compare.column')}</th>
                                  <th className="text-left pr-2">{t('compare.source_type')}</th>
                                  <th className="text-left pr-2">{t('compare.target_type')}</th>
                                  <th className="text-left">{t('compare.status')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tbl.columns.map((c) => (
                                  <tr key={c.name} className={c.status !== "match" ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                                    <td className="pr-2">{c.name}</td>
                                    <td className="pr-2 text-muted-foreground">{c.source_type || "-"}</td>
                                    <td className="pr-2 text-muted-foreground">{c.target_type || "-"}</td>
                                    <td className={statusColor[c.status] || ""}>{c.status}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {tbl.sync_sql.length > 0 && (
                            <div className="text-[10px] bg-muted/30 rounded p-1.5 font-mono text-muted-foreground">
                              {tbl.sync_sql.map((sql, i) => <div key={i}>{sql}</div>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {result.extra_in_source.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">{t('compare.only_in_source', { count: result.extra_in_source.length })}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {result.extra_in_source.map((t) => (
                      <span key={t} className="text-[10px] bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.extra_in_target.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-orange-600 dark:text-orange-400">{t('compare.only_in_target', { count: result.extra_in_target.length })}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {result.extra_in_target.map((t) => (
                      <span key={t} className="text-[10px] bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>{t('compare.close')}</Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
