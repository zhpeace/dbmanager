import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { listProcesses, killProcess, type ProcessInfo } from "@/lib/db"

interface SessionMonitorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string | null
}

export function SessionMonitor({ open, onOpenChange, connectionId }: SessionMonitorProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ProcessInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!connectionId) return
    setBusy(true)
    setError(null)
    try {
      const r = await listProcesses(connectionId)
      setRows(r)
    } catch (e) {
      setError(String(e))
      setRows([])
    } finally {
      setBusy(false)
    }
  }, [connectionId])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  async function handleKill(p: ProcessInfo) {
    if (!connectionId) return
    if (!confirm(`终止会话 ${p.id}？`)) return
    try {
      await killProcess(connectionId, p.id)
      refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('session_monitor.title')}</DialogTitle>
          <DialogDescription>{t('session_monitor.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">
            {t('session_monitor.count', { count: rows.length })}
          </span>
          <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
            {t('session_monitor.refresh')}
          </Button>
        </div>
        {error && (
          <div className="px-3 py-2 rounded-md text-sm bg-red-50 text-red-700 mb-2">{error}</div>
        )}
        <div className="flex-1 min-h-0 overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-left">
              <tr>
                <th className="px-2 py-1.5 font-medium">ID</th>
                <th className="px-2 py-1.5 font-medium">用户</th>
                <th className="px-2 py-1.5 font-medium">主机</th>
                <th className="px-2 py-1.5 font-medium">库</th>
                <th className="px-2 py-1.5 font-medium">状态</th>
                <th className="px-2 py-1.5 font-medium">耗时(s)</th>
                <th className="px-2 py-1.5 font-medium">当前查询</th>
                <th className="px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                    {t('session_monitor.empty')}
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="px-2 py-1.5 font-mono">{p.id}</td>
                  <td className="px-2 py-1.5">{p.user || "-"}</td>
                  <td className="px-2 py-1.5">{p.host || "-"}</td>
                  <td className="px-2 py-1.5">{p.db || "-"}</td>
                  <td className="px-2 py-1.5">{p.state || p.command || "-"}</td>
                  <td className="px-2 py-1.5 font-mono">{p.duration || "-"}</td>
                  <td className="px-2 py-1.5 max-w-[40ch] truncate" title={p.info}>{p.info || "-"}</td>
                  <td className="px-2 py-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] text-destructive"
                      onClick={() => handleKill(p)}
                    >
                      {t('session_monitor.kill')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
