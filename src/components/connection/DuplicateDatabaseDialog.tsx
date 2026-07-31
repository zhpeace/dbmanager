import { useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { listen } from "@tauri-apps/api/event"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Loader2, CheckCircle, XCircle } from "lucide-react"
import { duplicateDatabase } from "@/lib/db"

interface DuplicateDatabaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  sourceDb: string
  onDone: () => void
}

export function DuplicateDatabaseDialog({ open, onOpenChange, connectionId, sourceDb, onDone }: DuplicateDatabaseDialogProps) {
  const { t } = useTranslation()
  const [targetDb, setTargetDb] = useState("")
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ tables: number; rows: number; duration: string; errors: string[] } | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setTargetDb(sourceDb + "_copy")
      setError(null)
      setResult(null)
      setLogs([])
      setDuplicating(false)
    }
  }, [open, sourceDb])

  useEffect(() => {
    if (!duplicating) return
    const unlisten = listen<string>("migration-log", (event) => {
      setLogs((prev) => [...prev, event.payload])
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [duplicating])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const handleDuplicate = async () => {
    if (!targetDb.trim()) return
    setDuplicating(true)
    setError(null)
    try {
      const res = await duplicateDatabase(connectionId, sourceDb, targetDb.trim())
      setResult({ tables: res.tables_transferred.length, rows: res.rows_transferred, duration: res.duration, errors: res.errors })
    } catch (e: any) {
      setError(e.toString())
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.duplicate_database')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {t('dialog.duplicate_from')} <span className="font-medium text-foreground">{sourceDb}</span>
          </div>
          <div className="space-y-1">
            <Label>{t('dialog.target_database_name')}</Label>
            <Input
              className="h-8 text-xs"
              value={targetDb}
              onChange={(e) => setTargetDb(e.target.value)}
              placeholder={t('dialog.database_name_placeholder')}
              disabled={duplicating}
              autoFocus
            />
          </div>

          {logs.length > 0 && (
            <div className="max-h-[160px] overflow-y-auto border rounded p-2 space-y-1 bg-muted/20">
              {logs.map((msg, i) => (
                <div key={i} className="text-[10px] text-muted-foreground font-mono">{msg}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

          {result && (
            <div>
              <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 dark:bg-green-950/30 rounded p-2">
                <CheckCircle className="h-4 w-4 shrink-0" />
                {t('dialog.duplicate_success', { tables: result.tables, rows: result.rows, duration: result.duration })}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-1 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 rounded p-2 space-y-0.5">
                  <div className="font-medium">{t('dialog.duplicate_warnings')}</div>
                  {result.errors.map((e, i) => (
                    <div key={i} className="font-mono text-[10px] break-all">{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <XCircle className="h-3 w-3" />
              {error}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); onDone() }} disabled={duplicating}>
            {t('dialog.close')}
          </Button>
          {!result && !error && (
            <Button size="sm" onClick={handleDuplicate} disabled={!targetDb.trim() || duplicating}>
              {duplicating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t('dialog.duplicate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}