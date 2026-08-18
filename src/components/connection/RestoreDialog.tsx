import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Loader2, CheckCircle, XCircle, FolderOpen } from "lucide-react"
import type { Connection, DatabaseInfo } from "@/lib/db"

interface RestoreDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: Connection[]
}

export function RestoreDialog({ open, onOpenChange, connections }: RestoreDialogProps) {
  const { t } = useTranslation()
  const connected = connections.filter((c) => c.connected)
  const [targetId, setTargetId] = useState("")
  const [targetDb, setTargetDb] = useState("")
  const [targetDbs, setTargetDbs] = useState<DatabaseInfo[]>([])
  const [filePath, setFilePath] = useState("")
  const [restoring, setRestoring] = useState(false)
  const [result, setResult] = useState<{ count: number; errors: string[]; duration: string } | null>(null)
  const [liveLogs, setLiveLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setResult(null)
      setLiveLogs([])
      setRestoring(false)
      setFilePath("")
    }
  }, [open])

  useEffect(() => {
    if (!restoring) return
    const unlisten = listen<string>("migration-log", (event) => {
      setLiveLogs((prev) => [...prev, event.payload])
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [restoring])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [liveLogs])

  const handleTargetChange = async (id: string) => {
    setTargetId(id)
    setTargetDb("")
    setTargetDbs([])
    try {
      const dbs: DatabaseInfo[] = await invoke("get_databases", { id })
      setTargetDbs(dbs)
    } catch {}
  }

  const handleBrowse = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog")
      const path = await openDialog({
        filters: [{ name: "SQL Files", extensions: ["sql"] }],
        multiple: false,
      })
      if (path) setFilePath(path as string)
    } catch {
      setFilePath("")
    }
  }

  const handleRestore = async () => {
    if (!targetId || !targetDb || !filePath) return
    setRestoring(true)
    setResult(null)
    setLiveLogs([])
    try {
      const [count, errors]: [number, string[]] = await invoke("restore_database", {
        targetId,
        database: targetDb,
        inputPath: filePath,
      })
      setResult({ count, errors, duration: "" })
    } catch (e: any) {
      setLiveLogs((prev) => [...prev, `Error: ${e}`])
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[600px]"
        hideClose={restoring}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('restore.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {result && !restoring ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                {result.errors.length === 0 ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-yellow-500" />
                )}
                <span>{t('restore.success')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('restore.result', { count: result.count, duration: result.duration })}</p>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">{t('restore.errors', { count: result.errors.length })}</p>
                  <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-[10px] text-destructive/80 font-mono">{e}</p>
                    ))}
                  </div>
                </div>
              )}
              <details open>
                <summary className="text-xs text-muted-foreground cursor-pointer">{t('restore.log_title')} ({liveLogs.length})</summary>
                <div className="mt-1 max-h-[200px] overflow-y-auto bg-muted/30 rounded p-2 font-mono text-[10px] space-y-0.5">
                  {liveLogs.map((line, i) => (
                    <div key={i} className="text-muted-foreground">{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </details>
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>{t('restore.close')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <Label>{t('restore.target')}</Label>
                <Select value={targetId} onValueChange={handleTargetChange}>
                  <SelectTrigger><SelectValue placeholder={t('restore.select_target')} /></SelectTrigger>
                  <SelectContent>
                    {connected.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.config.name} ({c.config.type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targetId && (
                  <>
                    <Label>{t('restore.database')}</Label>
                    <Select value={targetDb} onValueChange={setTargetDb}>
                      <SelectTrigger><SelectValue placeholder={t('restore.select_target_db')} /></SelectTrigger>
                      <SelectContent>
                        {targetDbs.map((d) => (
                          <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
                <div className="space-y-1">
                  <Label>{t('restore.file_path')}</Label>
                  <div className="flex gap-2">
                    <Input className="h-8 text-xs flex-1 font-mono" value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="/path/to/backup.sql" />
                    <Button size="sm" variant="outline" className="h-8" onClick={handleBrowse}>
                      <FolderOpen className="h-3 w-3 mr-1" /> {t('restore.browse')}
                    </Button>
                  </div>
                </div>
              </div>

              {restoring && (
                <div className="border rounded p-2 bg-muted/20">
                  <div className="text-xs font-medium mb-1">{t('restore.log_title')}</div>
                  <div className="max-h-[200px] overflow-y-auto font-mono text-[10px] space-y-0.5">
                    {liveLogs.map((line, i) => (
                      <div key={i} className="text-muted-foreground">{line}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                {!restoring && (
                  <Button variant="outline" onClick={() => onOpenChange(false)}>{t('restore.close')}</Button>
                )}
                <Button
                  onClick={handleRestore}
                  disabled={!targetId || !targetDb || !filePath || restoring}
                >
                  {restoring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {restoring ? t('restore.restoring') : t('restore.start')}
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
