import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Loader2, ArrowRight, CheckCircle, XCircle, ChevronDown, Plus, Trash2, Undo2 } from "lucide-react"
import type { Connection, DatabaseInfo, TableInfo, TransferOptions, TransferResult, ColumnMapping, CheckpointState } from "@/lib/db"
import { saveCheckpoint, getCheckpoint, clearCheckpoint } from "@/lib/db"

interface TransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
}

export function TransferDialog({ open, onOpenChange, connections }: TransferDialogProps) {
  const { t } = useTranslation()
  const connected = connections.filter((c) => c.connected)
  const [sourceId, setSourceId] = useState("")
  const [sourceDb, setSourceDb] = useState("")
  const [targetId, setTargetId] = useState("")
  const [targetDb, setTargetDb] = useState("")
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [sourceTables, setSourceTables] = useState<TableInfo[]>([])
  const [transferring, setTransferring] = useState(false)
  const [result, setResult] = useState<TransferResult | null>(null)
  const [sourceDbs, setSourceDbs] = useState<DatabaseInfo[]>([])
  const [targetDbs, setTargetDbs] = useState<DatabaseInfo[]>([])
  const [liveLogs, setLiveLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<string>("structure_and_data")
  const [conflictStrategy, setConflictStrategy] = useState<string>("error")
  const [dropTarget, setDropTarget] = useState(false)
  const [truncateTarget, setTruncateTarget] = useState(false)
  const [whereClause, setWhereClause] = useState("")
  const [rowLimit, setRowLimit] = useState("")
  const [pageSize, setPageSize] = useState("2000")
  const [parallelism, setParallelism] = useState("4")
  const [transferIndexes, setTransferIndexes] = useState(true)
  const [transferForeignKeys, setTransferForeignKeys] = useState(false)
  const [transferViews, setTransferViews] = useState(false)
  const [transferRoutines, setTransferRoutines] = useState(false)
  const [transferTriggers, setTransferTriggers] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [selectAll, setSelectAll] = useState(false)
  const [checkpoint, setCheckpoint] = useState<CheckpointState | null>(null)
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([])
  const [errorMode, setErrorMode] = useState<string>("skip")

  useEffect(() => {
    if (!open) {
      setResult(null)
      setLiveLogs([])
      setTransferring(false)
      setCheckpoint(null)
      setColumnMappings([])
    }
  }, [open])

  useEffect(() => {
    if (sourceId && sourceDb && targetId && targetDb) {
      getCheckpoint(sourceId, sourceDb, targetId, targetDb).then(setCheckpoint)
    } else {
      setCheckpoint(null)
    }
  }, [sourceId, sourceDb, targetId, targetDb])

  useEffect(() => {
    if (!transferring) return
    const unlisten = listen<string>("migration-log", (event) => {
      setLiveLogs((prev) => [...prev, event.payload])
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [transferring])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [liveLogs])

  const handleSourceChange = async (id: string) => {
    setSourceId(id)
    setSourceDb("")
    setSourceTables([])
    setSelectedTables([])
    setSourceDbs([])
    try {
      const dbs: DatabaseInfo[] = await invoke("get_databases", { id })
      setSourceDbs(dbs)
    } catch {}
  }

  const handleTargetChange = async (id: string) => {
    setTargetId(id)
    setTargetDb("")
    setTargetDbs([])
    try {
      const dbs: DatabaseInfo[] = await invoke("get_databases", { id })
      setTargetDbs(dbs)
    } catch {}
  }

  const handleSourceDbChange = async (db: string) => {
    setSourceDb(db)
    setSelectedTables([])
    setSelectAll(false)
    try {
      const tables: TableInfo[] = await invoke("get_tables", { id: sourceId, database: db })
      setSourceTables(tables.filter((t) => t.object_type === "TABLE" || t.object_type === "BASE TABLE" || t.object_type === "COLLECTION"))
    } catch {}
  }

  const toggleTable = (name: string) => {
    setSelectedTables((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    )
  }

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedTables([])
      setSelectAll(false)
    } else {
      setSelectedTables(sourceTables.map((t) => t.name))
      setSelectAll(true)
    }
  }

  const addMapping = () => {
    setColumnMappings([...columnMappings, { source_column: "", target_column: "", skip: false, default_value: null }])
  }

  const removeMapping = (i: number) => {
    setColumnMappings(columnMappings.filter((_, idx) => idx !== i))
  }

  const updateMapping = (i: number, field: keyof ColumnMapping, value: unknown) => {
    const updated = columnMappings.map((m, idx) => idx === i ? { ...m, [field]: value } : m)
    setColumnMappings(updated)
  }

  const handleTransfer = async (resume = false) => {
    if (!sourceId || !targetId || !sourceDb || !targetDb || selectedTables.length === 0) return
    setTransferring(true)
    setResult(null)
    setLiveLogs([])

    const checkpointId = resume && checkpoint
      ? checkpoint.completed_tables.join(",")
      : undefined

    try {
      const opts: TransferOptions = {
        source_id: sourceId,
        source_database: sourceDb,
        target_id: targetId,
        target_database: targetDb,
        tables: selectedTables,
        mode: mode as 'structure_and_data' | 'structure_only' | 'data_only',
        conflict_strategy: conflictStrategy as 'error' | 'ignore' | 'replace',
        drop_target: dropTarget,
        truncate_target: truncateTarget,
        where_clause: whereClause || null,
        row_limit: rowLimit ? parseInt(rowLimit) : null,
        page_size: parseInt(pageSize) || 2000,
        parallelism: parseInt(parallelism) || 4,
        transfer_indexes: transferIndexes,
        transfer_foreign_keys: transferForeignKeys,
        transfer_views: transferViews,
        transfer_routines: transferRoutines,
        transfer_triggers: transferTriggers,
        column_mappings: columnMappings.filter(m => m.source_column),
        checkpoint_id: checkpointId || null,
        error_mode: errorMode as 'skip' | 'stop' | 'skip_table',
      }
      const res: TransferResult = await invoke("transfer_data", { opts })

      if (res.errors.length === 0) {
        await clearCheckpoint(sourceId, sourceDb, targetId, targetDb)
      } else {
        const partialCp = selectedTables.filter(t => res.tables_transferred.includes(t))
        await saveCheckpoint(sourceId, sourceDb, targetId, targetDb, partialCp, res.rows_transferred)
      }
      setResult(res)
    } catch (e: any) {
      setResult({
        tables_transferred: [],
        rows_transferred: 0,
        errors: [String(e)],
        duration: "0ms",
        logs: [],
      })
    } finally {
      setTransferring(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {result || (!transferring && liveLogs.length > 0) ? (
            <div className="space-y-3">
              {result && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    {result.errors.length === 0 ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-yellow-500" />
                    )}
                    <span>{t('transfer.result', { rows: result.rows_transferred, tables: result.tables_transferred.length, duration: result.duration })}</span>
                  </div>
                  {result.errors.length > 0 && (
                    <div className="rounded border border-destructive/30 bg-destructive/5 p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-destructive">{t('transfer.errors')} ({result.errors.length})</p>
                      </div>
                      <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                        {result.errors.map((e, i) => (
                          <p key={i} className="text-[10px] text-destructive/80 font-mono">{e}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {result.tables_transferred.map((t) => (
                      <span key={t} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </>
              )}
              <details open={transferring}>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  {transferring
                    ? `${t('transfer.log_title')} (${liveLogs.length})`
                    : `${t('transfer.migration_log')} (${result?.logs?.length ?? liveLogs.length} ${t('transfer.log_entries')})`}
                </summary>
                <div className="mt-1 max-h-[250px] overflow-y-auto bg-muted/30 rounded p-2 font-mono text-[10px] space-y-0.5">
                  {(result?.logs || liveLogs).map((line, i) => (
                    <div key={i} className="text-muted-foreground">{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </details>
              {!transferring && (
                <DialogFooter>
                  <Button onClick={() => onOpenChange(false)}>{t('transfer.close')}</Button>
                </DialogFooter>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
                <div className="space-y-3">
                  <Label>{t('transfer.source')}</Label>
                  <Select value={sourceId} onValueChange={handleSourceChange}>
                    <SelectTrigger><SelectValue placeholder={t('transfer.select_source')} /></SelectTrigger>
                    <SelectContent>
                      {connected.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sourceId && (
                    <>
                      <Label>{t('transfer.database')}</Label>
                      <Select value={sourceDb} onValueChange={handleSourceDbChange}>
                        <SelectTrigger><SelectValue placeholder={t('transfer.select_source_db')} /></SelectTrigger>
                        <SelectContent>
                          {sourceDbs.map((d) => (
                            <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {sourceTables.length > 0 && (
                    <div className="space-y-1 max-h-[200px] overflow-y-auto border rounded p-2">
                      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer hover:bg-accent/30 px-1 py-0.5 rounded border-b pb-1 mb-1">
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={toggleSelectAll}
                          className="accent-primary"
                        />
                        {t('transfer.select_all')} ({selectedTables.length}/{sourceTables.length})
                      </label>
                      {sourceTables.map((t) => (
                        <label key={t.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent/30 px-1 py-0.5 rounded">
                          <input
                            type="checkbox"
                            checked={selectedTables.includes(t.name)}
                            onChange={() => toggleTable(t.name)}
                            className="accent-primary"
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-center">
                  <ArrowRight className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-3">
                  <Label>{t('transfer.target')}</Label>
                  <Select value={targetId} onValueChange={handleTargetChange}>
                    <SelectTrigger><SelectValue placeholder={t('transfer.select_target')} /></SelectTrigger>
                    <SelectContent>
                      {connected.filter((c) => c.id !== sourceId).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {targetId && (
                    <>
                      <Label>{t('transfer.database')}</Label>
                      <Select value={targetDb} onValueChange={setTargetDb}>
                        <SelectTrigger><SelectValue placeholder={t('transfer.select_target_db')} /></SelectTrigger>
                        <SelectContent>
                          {targetDbs.map((d) => (
                            <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
              </div>

              {checkpoint && checkpoint.completed_tables.length > 0 && !transferring && (
                <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Undo2 className="h-3 w-3 text-amber-600" />
                      <span className="text-amber-800 dark:text-amber-300">
                        {t('transfer.resume_banner', { count: checkpoint.completed_tables.length })}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => handleTransfer(true)}>
                        {t('transfer.resume')}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={async () => {
                        await clearCheckpoint(sourceId, sourceDb, targetId, targetDb)
                        setCheckpoint(null)
                      }}>
                        {t('transfer.start_fresh')}
                    </Button>
                  </div>
                </div>
              )}

              {transferring && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium truncate">
                      {liveLogs.filter(l => l.startsWith("Starting table:")).pop()?.replace("Starting table:", "").trim() || t('transfer.preparing')}
                    </span>
                    <span className="text-muted-foreground shrink-0 ml-2">
                      {liveLogs.filter(l => l.startsWith("Completed table:")).length}/{selectedTables.length} {t('transfer.tables_done')}
                    </span>
                  </div>
                  <div className="border rounded bg-muted/20">
                    <div className="text-xs font-medium px-2 pt-1.5 pb-1 text-muted-foreground flex items-center justify-between">
                      <span>{t('transfer.log_title')} ({liveLogs.length})</span>
                    </div>
                    <div className="max-h-[300px] min-h-[100px] overflow-y-auto font-mono text-[10px] space-y-0.5 px-2 pb-1.5">
                      {liveLogs.map((line, i) => (
                        <div key={i} className="text-muted-foreground">{line}</div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setShowOptions(!showOptions)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
                  {t('transfer.options')}
                </button>

                {showOptions && !transferring && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.mode')}</Label>
                        <Select value={mode} onValueChange={setMode}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="structure_and_data">{t('transfer.mode_structure_data')}</SelectItem>
                            <SelectItem value="structure_only">{t('transfer.mode_structure_only')}</SelectItem>
                            <SelectItem value="data_only">{t('transfer.mode_data_only')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.conflict')}</Label>
                        <Select value={conflictStrategy} onValueChange={setConflictStrategy}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="error">{t('transfer.conflict_error')}</SelectItem>
                            <SelectItem value="ignore">{t('transfer.conflict_ignore')}</SelectItem>
                            <SelectItem value="replace">{t('transfer.conflict_replace')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.error_mode')}</Label>
                        <Select value={errorMode} onValueChange={setErrorMode}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">{t('transfer.error_mode_skip')}</SelectItem>
                            <SelectItem value="stop">{t('transfer.error_mode_stop')}</SelectItem>
                            <SelectItem value="skip_table">{t('transfer.error_mode_skip_table')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.where')}</Label>
                        <Input
                          className="h-8 text-xs font-mono"
                          placeholder={t('transfer.where_placeholder')}
                          value={whereClause}
                          onChange={(e) => setWhereClause(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.row_limit')}</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          placeholder={t('transfer.limit_placeholder')}
                          value={rowLimit}
                          onChange={(e) => setRowLimit(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.page_size')}</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          value={pageSize}
                          onChange={(e) => setPageSize(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t('transfer.parallelism')}</Label>
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          value={parallelism}
                          onChange={(e) => setParallelism(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('transfer.actions')}</Label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={dropTarget} onCheckedChange={setDropTarget} />
                          {t('transfer.drop_target')}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={truncateTarget} onCheckedChange={setTruncateTarget} />
                          {t('transfer.truncate_target')}
                        </label>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('transfer.structure_items')}</Label>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={transferIndexes} onCheckedChange={setTransferIndexes} />
                          {t('transfer.switch_indexes')}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={transferForeignKeys} onCheckedChange={setTransferForeignKeys} />
                          {t('transfer.switch_foreign_keys')}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={transferViews} onCheckedChange={setTransferViews} />
                          {t('transfer.switch_views')}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={transferRoutines} onCheckedChange={setTransferRoutines} />
                          {t('transfer.switch_routines')}
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <Switch checked={transferTriggers} onCheckedChange={setTransferTriggers} />
                          {t('transfer.switch_triggers')}
                        </label>
                      </div>
                    </div>

                    <div className="border-t pt-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t('transfer.column_mappings')}</Label>
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={addMapping}>
                          <Plus className="h-3 w-3 mr-1" /> {t('transfer.mapping_add')}
                        </Button>
                      </div>
                      {columnMappings.length === 0 && (
                        <p className="text-[10px] text-muted-foreground">{t('transfer.mapping_empty')}</p>
                      )}
                      {columnMappings.map((m, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <Input
                            className="h-7 text-[10px] w-[120px] font-mono"
                            placeholder={t('transfer.mapping_source')}
                            value={m.source_column}
                            onChange={(e) => updateMapping(i, "source_column", e.target.value)}
                          />
                          <span className="text-[10px] text-muted-foreground">→</span>
                          <Input
                            className="h-7 text-[10px] w-[120px] font-mono"
                            placeholder={t('transfer.mapping_target')}
                            value={m.target_column}
                            onChange={(e) => updateMapping(i, "target_column", e.target.value)}
                          />
                          <label className="flex items-center gap-1 text-[10px] whitespace-nowrap">
                            <Switch
                              checked={m.skip}
                              onCheckedChange={(v) => updateMapping(i, "skip", v)}
                            />
                            {t('transfer.mapping_skip')}
                          </label>
                          <Input
                            className="h-7 text-[10px] w-[80px] font-mono"
                            placeholder={t('transfer.mapping_default')}
                            value={m.default_value as string || ""}
                            onChange={(e) => updateMapping(i, "default_value", e.target.value || null)}
                          />
                          <button onClick={() => removeMapping(i)} className="text-destructive hover:text-destructive/80">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>{t('transfer.cancel')}</Button>
                <Button
                  onClick={() => handleTransfer(false)}
                  disabled={!sourceId || !targetId || !sourceDb || !targetDb || selectedTables.length === 0 || transferring}
                >
                  {transferring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {transferring ? t('transfer.transferring') : t('transfer.start')}
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
