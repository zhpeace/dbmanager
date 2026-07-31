import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Plus, Pencil, Trash2, Loader2, FolderOpen, ChevronDown, ChevronRight } from "lucide-react"
import type { Connection, DatabaseInfo, TableInfo, ScheduledTask, TaskConfig } from "@/lib/db"
import { listScheduledTasks, createScheduledTask, updateScheduledTask, deleteScheduledTask, toggleScheduledTask } from "@/lib/db"

interface SchedulerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
}

function TaskForm({ task, connections, onSave, onCancel }: {
  task: ScheduledTask | null
  connections: Connection[]
  onSave: (name: string, cronExpr: string, config: TaskConfig, enabled: boolean) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const connected = connections.filter((c) => c.connected)
  const [name, setName] = useState(task?.name || "")
  const [cronExpr, setCronExpr] = useState(task?.cron_expr || "0 0 2 * * *")
  const [type, setType] = useState<"Backup" | "Transfer">(
    task?.config.type === "Transfer" ? "Transfer" : "Backup"
  )
  const [enabled, setEnabled] = useState(task?.enabled ?? true)
  const [showOptions, setShowOptions] = useState(false)

  // Backup fields
  const [backupSourceId, setBackupSourceId] = useState(
    task?.config.type === "Backup" ? task.config.source_id : ""
  )
  const [backupDb, setBackupDb] = useState(
    task?.config.type === "Backup" ? task.config.database : ""
  )
  const [backupTables, setBackupTables] = useState<string[]>(
    task?.config.type === "Backup" ? task.config.tables : []
  )
  const [backupPath, setBackupPath] = useState(
    task?.config.type === "Backup" ? task.config.output_path : ""
  )

  // Transfer basic fields
  const [transferSourceId, setTransferSourceId] = useState(
    task?.config.type === "Transfer" ? task.config.source_id : ""
  )
  const [transferSourceDb, setTransferSourceDb] = useState(
    task?.config.type === "Transfer" ? task.config.source_database : ""
  )
  const [transferTargetId, setTransferTargetId] = useState(
    task?.config.type === "Transfer" ? task.config.target_id : ""
  )
  const [transferTargetDb, setTransferTargetDb] = useState(
    task?.config.type === "Transfer" ? task.config.target_database : ""
  )
  const [transferTables, setTransferTables] = useState<string[]>(
    task?.config.type === "Transfer" ? task.config.tables : []
  )

  // Transfer advanced options
  const cfg = task?.config.type === "Transfer" ? task.config : undefined
  const [transferMode, setTransferMode] = useState<string>(cfg?.mode ?? "structure_and_data")
  const [conflictStrategy, setConflictStrategy] = useState<string>(cfg?.conflict_strategy ?? "error")
  const [dropTarget, setDropTarget] = useState(cfg?.drop_target ?? false)
  const [truncateTarget, setTruncateTarget] = useState(cfg?.truncate_target ?? false)
  const [whereClause, setWhereClause] = useState(cfg?.where_clause ?? "")
  const [rowLimit, setRowLimit] = useState(cfg?.row_limit ?? "")
  const [pageSize, setPageSize] = useState((cfg?.page_size ?? 2000).toString())
  const [parallelism, setParallelism] = useState((cfg?.parallelism ?? 4).toString())
  const [transferIndexes, setTransferIndexes] = useState(cfg?.transfer_indexes ?? true)
  const [transferForeignKeys, setTransferForeignKeys] = useState(cfg?.transfer_foreign_keys ?? false)
  const [transferViews, setTransferViews] = useState(cfg?.transfer_views ?? false)
  const [transferRoutines, setTransferRoutines] = useState(cfg?.transfer_routines ?? false)
  const [transferTriggers, setTransferTriggers] = useState(cfg?.transfer_triggers ?? false)
  const [errorMode, setErrorMode] = useState<string>(cfg?.error_mode ?? "skip")
  const foreignKeyAction = cfg?.foreign_key_action ?? "preserve"

  const [sourceDbs, setSourceDbs] = useState<DatabaseInfo[]>([])
  const [sourceTables, setSourceTables] = useState<TableInfo[]>([])
  const [targetDbs, setTargetDbs] = useState<DatabaseInfo[]>([])

  const loadDbs = async (id: string, setter: (dbs: DatabaseInfo[]) => void) => {
    try {
      const dbs: DatabaseInfo[] = await invoke("get_databases", { id })
      setter(dbs)
    } catch { setter([]) }
  }

  const loadTables = async (id: string, db: string, setter: (tables: TableInfo[]) => void) => {
    try {
      const tables: TableInfo[] = await invoke("get_tables", { id, database: db })
      setter(tables.filter((t) => t.object_type === "TABLE" || t.object_type === "BASE TABLE"))
    } catch { setter([]) }
  }

  useEffect(() => {
    if (type === "Backup" && backupSourceId) loadDbs(backupSourceId, setSourceDbs)
  }, [type, backupSourceId])

  useEffect(() => {
    if (type === "Backup" && backupSourceId && backupDb) loadTables(backupSourceId, backupDb, setSourceTables)
  }, [type, backupSourceId, backupDb])

  useEffect(() => {
    if (type === "Transfer" && transferSourceId) loadDbs(transferSourceId, setSourceDbs)
  }, [type, transferSourceId])

  useEffect(() => {
    if (type === "Transfer" && transferSourceId && transferSourceDb) loadTables(transferSourceId, transferSourceDb, setSourceTables)
  }, [type, transferSourceId, transferSourceDb])

  useEffect(() => {
    if (type === "Transfer" && transferTargetId) loadDbs(transferTargetId, setTargetDbs)
  }, [type, transferTargetId])

  const handleSave = () => {
    if (!name.trim() || !cronExpr.trim()) return
    let config: TaskConfig
    if (type === "Backup") {
      if (!backupSourceId || !backupDb || backupTables.length === 0 || !backupPath) return
      config = { type: "Backup", source_id: backupSourceId, database: backupDb, tables: backupTables, output_path: backupPath }
    } else {
      if (!transferSourceId || !transferSourceDb || !transferTargetId || !transferTargetDb || transferTables.length === 0) return
      config = {
        type: "Transfer",
        source_id: transferSourceId,
        source_database: transferSourceDb,
        target_id: transferTargetId,
        target_database: transferTargetDb,
        tables: transferTables,
        mode: transferMode as any,
        conflict_strategy: conflictStrategy as any,
        drop_target: dropTarget,
        truncate_target: truncateTarget,
        where_clause: whereClause || null,
        row_limit: rowLimit ? parseInt(String(rowLimit)) || null : null,
        page_size: parseInt(pageSize) || 2000,
        parallelism: parseInt(parallelism) || 4,
        transfer_indexes: transferIndexes,
        transfer_foreign_keys: transferForeignKeys,
        transfer_views: transferViews,
        transfer_routines: transferRoutines,
        transfer_triggers: transferTriggers,
        foreign_key_action: foreignKeyAction as any,
        error_mode: errorMode as any,
      }
    }
    onSave(name.trim(), cronExpr.trim(), config, enabled)
  }

  const toggleTable = (name: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(name) ? list.filter((t) => t !== name) : [...list, name])
  }

  const handleBrowse = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const path = await save({
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
        defaultPath: `backup_${backupDb}_${new Date().toISOString().slice(0, 10)}.sql`,
      })
      if (path) setBackupPath(path)
    } catch { /* fallback */ }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>{t('scheduler.task_name')}</Label>
          <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('scheduler.name_placeholder')} />
        </div>
        <div className="space-y-1">
          <Label>{t('scheduler.type')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as any)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Backup">{t('scheduler.backup')}</SelectItem>
              <SelectItem value="Transfer">{t('scheduler.transfer')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>{t('scheduler.cron_expr')} <span className="text-[10px] text-muted-foreground">({t('scheduler.cron_hint')})</span></Label>
        <Input className="h-8 text-xs font-mono" value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder={t('scheduler.cron_placeholder')} />
      </div>

      {type === "Backup" ? (
        <>
          <div className="space-y-1">
            <Label>{t('scheduler.source')}</Label>
            <Select value={backupSourceId} onValueChange={(v) => { setBackupSourceId(v); setBackupDb(""); setBackupTables([]) }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('scheduler.select_source')} /></SelectTrigger>
              <SelectContent>
                {connected.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {backupSourceId && (
            <div className="space-y-1">
              <Label>{t('scheduler.database')}</Label>
              <Select value={backupDb} onValueChange={(v) => { setBackupDb(v); setBackupTables([]) }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('scheduler.select_db')} /></SelectTrigger>
                <SelectContent>
                  {sourceDbs.map((d) => (
                    <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {sourceTables.length > 0 && (
            <div className="space-y-1">
              <Label>{t('scheduler.tables')}</Label>
              <div className="max-h-[150px] overflow-y-auto border rounded p-2 space-y-1">
                {sourceTables.map((t) => (
                  <label key={t.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent/30 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={backupTables.includes(t.name)} onChange={() => toggleTable(t.name, backupTables, setBackupTables)} className="accent-primary" />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>{t('scheduler.save_path')}</Label>
            <div className="flex gap-2">
              <Input className="h-8 text-xs flex-1 font-mono" value={backupPath} onChange={(e) => setBackupPath(e.target.value)} />
              <Button size="sm" variant="outline" className="h-8" onClick={handleBrowse}>
                <FolderOpen className="h-3 w-3 mr-1" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <Label>{t('scheduler.source')}</Label>
            <Select value={transferSourceId} onValueChange={(v) => { setTransferSourceId(v); setTransferSourceDb(""); setTransferTables([]) }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('scheduler.select_source')} /></SelectTrigger>
              <SelectContent>
                {connected.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {transferSourceId && (
            <div className="space-y-1">
              <Label>{t('scheduler.database')}</Label>
              <Select value={transferSourceDb} onValueChange={(v) => { setTransferSourceDb(v); setTransferTables([]) }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('scheduler.select_db')} /></SelectTrigger>
                <SelectContent>
                  {sourceDbs.map((d) => (
                    <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {transferSourceDb && (
            <div className="space-y-1">
              <Label>{t('scheduler.target')}</Label>
              <Select value={transferTargetId} onValueChange={(v) => { setTransferTargetId(v); setTransferTargetDb("") }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('scheduler.select_target')} /></SelectTrigger>
                <SelectContent>
                  {connected.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {transferTargetId && (
            <div className="space-y-1">
              <Label>{t('scheduler.database')}</Label>
              <Select value={transferTargetDb} onValueChange={setTransferTargetDb}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('scheduler.select_db')} /></SelectTrigger>
                <SelectContent>
                  {targetDbs.map((d) => (
                    <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {sourceTables.length > 0 && (
            <div className="space-y-1">
              <Label>{t('scheduler.tables')}</Label>
              <div className="max-h-[150px] overflow-y-auto border rounded p-2 space-y-1">
                {sourceTables.map((t) => (
                  <label key={t.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent/30 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={transferTables.includes(t.name)} onChange={() => toggleTable(t.name, transferTables, setTransferTables)} className="accent-primary" />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowOptions(!showOptions)}
            >
              {showOptions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t('transfer.options')}
            </button>
            {showOptions && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.mode')}</Label>
                    <Select value={transferMode} onValueChange={setTransferMode}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="structure_and_data">{t('transfer.mode_structure_data')}</SelectItem>
                        <SelectItem value="structure_only">{t('transfer.mode_structure_only')}</SelectItem>
                        <SelectItem value="data_only">{t('transfer.mode_data_only')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.conflict')}</Label>
                    <Select value={conflictStrategy} onValueChange={setConflictStrategy}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="error">{t('transfer.conflict_error')}</SelectItem>
                        <SelectItem value="ignore">{t('transfer.conflict_ignore')}</SelectItem>
                        <SelectItem value="replace">{t('transfer.conflict_replace')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.error_mode')}</Label>
                    <Select value={errorMode} onValueChange={setErrorMode}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">{t('transfer.error_mode_skip')}</SelectItem>
                        <SelectItem value="stop">{t('transfer.error_mode_stop')}</SelectItem>
                        <SelectItem value="skip_table">{t('transfer.error_mode_skip_table')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.actions')}</Label>
                    <div className="flex gap-3 pt-1">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <Switch checked={dropTarget} onCheckedChange={setDropTarget} className="scale-75" />
                        {t('transfer.drop_target')}
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <Switch checked={truncateTarget} onCheckedChange={setTruncateTarget} className="scale-75" />
                        {t('transfer.truncate_target')}
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.where')}</Label>
                    <Input className="h-7 text-xs" value={whereClause} onChange={(e) => setWhereClause(e.target.value)} placeholder={t('transfer.where_placeholder')} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.row_limit')}</Label>
                    <Input className="h-7 text-xs" type="number" value={rowLimit} onChange={(e) => setRowLimit(e.target.value)} placeholder={t('transfer.limit_placeholder')} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.page_size')}</Label>
                    <Input className="h-7 text-xs" type="number" value={pageSize} onChange={(e) => setPageSize(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('transfer.parallelism')}</Label>
                    <Input className="h-7 text-xs" type="number" value={parallelism} onChange={(e) => setParallelism(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">{t('transfer.structure_items')}</Label>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Switch checked={transferIndexes} onCheckedChange={setTransferIndexes} className="scale-75" />
                      {t('transfer.switch_indexes')}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Switch checked={transferForeignKeys} onCheckedChange={setTransferForeignKeys} className="scale-75" />
                      {t('transfer.switch_foreign_keys')}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Switch checked={transferViews} onCheckedChange={setTransferViews} className="scale-75" />
                      {t('transfer.switch_views')}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Switch checked={transferRoutines} onCheckedChange={setTransferRoutines} className="scale-75" />
                      {t('transfer.switch_routines')}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Switch checked={transferTriggers} onCheckedChange={setTransferTriggers} className="scale-75" />
                      {t('transfer.switch_triggers')}
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="task-enabled" className="text-xs">{enabled ? t('scheduler.enabled') : t('scheduler.disabled')}</Label>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>{t('scheduler.cancel')}</Button>
        <Button size="sm" onClick={handleSave}>{task ? t('scheduler.save') : t('scheduler.add')}</Button>
      </DialogFooter>
    </div>
  )
}

export function SchedulerDialog({ open, onOpenChange, connections }: SchedulerDialogProps) {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)
  const [loading, setLoading] = useState(false)

  const loadTasks = async () => {
    setLoading(true)
    try {
      const list = await listScheduledTasks()
      setTasks(list)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    if (open) { loadTasks(); setShowForm(false); setEditingTask(null) }
  }, [open])

  const handleCreate = async (name: string, cronExpr: string, config: TaskConfig, _enabled: boolean) => {
    try {
      await createScheduledTask(name, cronExpr, config)
      setShowForm(false)
      loadTasks()
    } catch {}
  }

  const handleUpdate = async (id: string, name: string, cronExpr: string, config: TaskConfig, enabled: boolean) => {
    try {
      await updateScheduledTask(id, name, cronExpr, config, enabled)
      setEditingTask(null)
      setShowForm(false)
      loadTasks()
    } catch {}
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteScheduledTask(id)
      loadTasks()
    } catch {}
  }

  const handleToggle = async (id: string) => {
    try {
      await toggleScheduledTask(id)
      loadTasks()
    } catch {}
  }

  const startEdit = (task: ScheduledTask) => {
    setEditingTask(task)
    setShowForm(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] max-h-[80vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('scheduler.title')}</DialogTitle>
        </DialogHeader>

        {showForm ? (
          <TaskForm
            task={editingTask}
            connections={connections}
            onSave={(name, cronExpr, config, enabled) => {
              if (editingTask) {
                handleUpdate(editingTask.id, name, cronExpr, config, enabled)
              } else {
                handleCreate(name, cronExpr, config, enabled)
              }
            }}
            onCancel={() => { setShowForm(false); setEditingTask(null) }}
          />
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex justify-end mb-2">
              <Button size="sm" onClick={() => { setEditingTask(null); setShowForm(true) }}>
                <Plus className="h-4 w-4 mr-1" /> {t('scheduler.create')}
              </Button>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">{t('scheduler.no_tasks')}</div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 px-2 font-medium">{t('scheduler.task_name')}</th>
                      <th className="text-left py-2 px-2 font-medium">Cron</th>
                      <th className="text-left py-2 px-2 font-medium">{t('scheduler.type')}</th>
                      <th className="text-left py-2 px-2 font-medium">{t('scheduler.last_run')}</th>
                      <th className="text-left py-2 px-2 font-medium">{t('scheduler.next_run')}</th>
                      <th className="text-left py-2 px-2 font-medium">{t('scheduler.result')}</th>
                      <th className="text-center py-2 px-2 font-medium">{t('scheduler.enabled')}</th>
                      <th className="text-right py-2 px-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id} className="border-b hover:bg-accent/20">
                        <td className="py-2 px-2 font-medium">{task.name}</td>
                        <td className="py-2 px-2 font-mono">{task.cron_expr}</td>
                        <td className="py-2 px-2">{task.config.type}</td>
                        <td className="py-2 px-2 text-muted-foreground">{task.last_run ? new Date(task.last_run).toLocaleString() : t('scheduler.never')}</td>
                        <td className="py-2 px-2 text-muted-foreground">{task.next_run ? new Date(task.next_run).toLocaleString() : "-"}</td>
                        <td className="py-2 px-2 max-w-[120px] truncate">
                          {task.last_result ? (
                            <span className={task.last_result.startsWith("OK") ? "text-green-500" : "text-destructive"}>{task.last_result}</span>
                          ) : "-"}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Switch checked={task.enabled} onCheckedChange={() => handleToggle(task.id)} />
                        </td>
                        <td className="py-2 px-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(task)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDelete(task.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
