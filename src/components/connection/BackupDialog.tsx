import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Loader2, CheckCircle, FolderOpen } from "lucide-react"
import type { Connection, DatabaseInfo, TableInfo } from "@/lib/db"

interface BackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
}

export function BackupDialog({ open, onOpenChange, connections }: BackupDialogProps) {
  const { t } = useTranslation()
  const connected = connections.filter((c) => c.connected)
  const [sourceId, setSourceId] = useState("")
  const [sourceDb, setSourceDb] = useState("")
  const [sourceDbs, setSourceDbs] = useState<DatabaseInfo[]>([])
  const [sourceTables, setSourceTables] = useState<TableInfo[]>([])
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [savePath, setSavePath] = useState("")
  const [backingUp, setBackingUp] = useState(false)
  const [result, setResult] = useState<{ tables: number; duration: string } | null>(null)
  const [liveLogs, setLiveLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setResult(null)
      setLiveLogs([])
      setBackingUp(false)
      setSavePath("")
      setSelectedTables([])
    }
  }, [open])

  useEffect(() => {
    if (!backingUp) return
    const unlisten = listen<string>("migration-log", (event) => {
      setLiveLogs((prev) => [...prev, event.payload])
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [backingUp])

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

  const handleSourceDbChange = async (db: string) => {
    setSourceDb(db)
    setSelectedTables([])
    try {
      const tables: TableInfo[] = await invoke("get_tables", { id: sourceId, database: db })
      setSourceTables(tables.filter((t) => t.object_type === "TABLE" || t.object_type === "BASE TABLE"))
    } catch {}
  }

  const toggleTable = (name: string) => {
    setSelectedTables((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    )
  }

  const handleBrowse = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const path = await save({
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
        defaultPath: `backup_${sourceDb}_${new Date().toISOString().slice(0, 10)}.sql`,
      })
      if (path) setSavePath(path)
    } catch {
      setSavePath(`/tmp/backup_${sourceDb}.sql`)
    }
  }

  const handleBackup = async () => {
    if (!sourceId || !sourceDb || selectedTables.length === 0 || !savePath) return
    setBackingUp(true)
    setResult(null)
    setLiveLogs([])
    try {
      const [tables, duration]: [number, string] = await invoke("backup_database", {
        sourceId,
        database: sourceDb,
        tables: selectedTables,
        outputPath: savePath,
      })
      setResult({ tables, duration })
    } catch (e: any) {
      setLiveLogs((prev) => [...prev, `Error: ${e}`])
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[600px]"
        hideClose={backingUp}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('backup.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {result && !backingUp ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>{t('backup.success')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('backup.result', { tables: result.tables, duration: result.duration })}</p>
              <p className="text-xs font-mono text-muted-foreground">{savePath}</p>
              <details open>
                <summary className="text-xs text-muted-foreground cursor-pointer">{t('backup.log_title')} ({liveLogs.length})</summary>
                <div className="mt-1 max-h-[200px] overflow-y-auto bg-muted/30 rounded p-2 font-mono text-[10px] space-y-0.5">
                  {liveLogs.map((line, i) => (
                    <div key={i} className="text-muted-foreground">{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </details>
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>{t('backup.close')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <Label>{t('backup.source')}</Label>
                <Select value={sourceId} onValueChange={handleSourceChange}>
                  <SelectTrigger><SelectValue placeholder={t('backup.select_source')} /></SelectTrigger>
                  <SelectContent>
                    {connected.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sourceId && (
                  <>
                    <Label>{t('backup.database')}</Label>
                    <Select value={sourceDb} onValueChange={handleSourceDbChange}>
                      <SelectTrigger><SelectValue placeholder={t('backup.select_source_db')} /></SelectTrigger>
                      <SelectContent>
                        {sourceDbs.map((d) => (
                          <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
                {sourceTables.length > 0 && (
                  <div className="space-y-1">
                    <Label>{t('backup.select_tables')}</Label>
                    <div className="max-h-[200px] overflow-y-auto border rounded p-2 space-y-1">
                      <label className="flex items-center gap-2 text-xs font-medium cursor-pointer border-b pb-1 mb-1">
                        <input
                          type="checkbox"
                          checked={selectedTables.length === sourceTables.length}
                          onChange={() => setSelectedTables(selectedTables.length === sourceTables.length ? [] : sourceTables.map(t => t.name))}
                          className="accent-primary"
                        />
                        {t('backup.select_all')} ({selectedTables.length}/{sourceTables.length})
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
                  </div>
                )}
                <div className="space-y-1">
                  <Label>{t('backup.save_path')}</Label>
                  <div className="flex gap-2">
                    <Input className="h-8 text-xs flex-1 font-mono" value={savePath} onChange={(e) => setSavePath(e.target.value)} />
                    <Button size="sm" variant="outline" className="h-8" onClick={handleBrowse}>
                      <FolderOpen className="h-3 w-3 mr-1" /> {t('backup.browse')}
                    </Button>
                  </div>
                </div>
              </div>

              {backingUp && (
                <div className="border rounded p-2 bg-muted/20">
                  <div className="text-xs font-medium mb-1">{t('backup.log_title')}</div>
                  <div className="max-h-[200px] overflow-y-auto font-mono text-[10px] space-y-0.5">
                    {liveLogs.map((line, i) => (
                      <div key={i} className="text-muted-foreground">{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                {!backingUp && (
                  <Button variant="outline" onClick={() => onOpenChange(false)}>{t('backup.close')}</Button>
                )}
                <Button
                  onClick={handleBackup}
                  disabled={!sourceId || !sourceDb || selectedTables.length === 0 || !savePath || backingUp}
                >
                  {backingUp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {backingUp ? t('backup.backing_up') : t('backup.start')}
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
