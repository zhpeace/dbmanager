import { useState } from "react"
import { save } from "@tauri-apps/plugin-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { exportData, type ExportFormat } from "@/lib/db"

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  /** SQL to run for export, e.g. "SELECT * FROM table". */
  query: string
  /** Optional table name used for INSERT statements / sheet name. */
  table?: string
  defaultName?: string
}

const FORMAT_EXT: Record<ExportFormat, string> = {
  csv: "csv",
  json: "json",
  sql: "sql",
  xlsx: "xlsx",
}

export function ExportDialog({
  open,
  onOpenChange,
  connectionId,
  query,
  table,
  defaultName,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv")
  const [filePath, setFilePath] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  async function pickFile() {
    const ext = FORMAT_EXT[format]
    const name = `${defaultName || "export"}.${ext}`
    const path = await save({
      defaultPath: name,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (path) {
      setFilePath(path)
      setStatus(null)
    }
  }

  async function runExport() {
    if (!filePath) {
      setStatus({ ok: false, message: "请先选择保存位置" })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      await exportData(connectionId, query, format, filePath, table)
      setStatus({ ok: true, message: `已导出到 ${filePath}` })
    } catch (e) {
      setStatus({ ok: false, message: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出数据</DialogTitle>
          <DialogDescription>
            在服务端执行查询并将结果导出为文件（支持大表、SQL 格式）。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1 grid gap-2">
              <Label>格式</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="sql">SQL</SelectItem>
                  <SelectItem value="xlsx">Excel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 grid gap-2">
              <Label>保存位置</Label>
              <div className="flex gap-2">
                <Input placeholder="点击右侧选择文件" value={filePath} readOnly />
                <Button variant="outline" onClick={pickFile} className="shrink-0">选择</Button>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground break-all">
            执行：<code>{query}</code>
          </div>
        </div>
        {status && (
          <div className={`px-3 py-2 rounded-md text-sm ${status.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {status.message}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={runExport} disabled={busy}>{busy ? "导出中…" : "导出"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
