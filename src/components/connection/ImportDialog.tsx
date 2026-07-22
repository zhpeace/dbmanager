import { useState, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Upload, Loader2 } from "lucide-react"
import type { TableInfo } from "@/lib/db"

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  tables: TableInfo[]
}

export function ImportDialog({ open, onOpenChange, connectionId, tables }: ImportDialogProps) {
  const { t } = useTranslation()
  const [targetTable, setTargetTable] = useState("")
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [importOk, setImportOk] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function parseCsvLine(line: string): string[] {
    const fields: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"'
          i++
        } else if (ch === '"') {
          inQuotes = false
        } else {
          current += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        fields.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
    fields.push(current.trim())
    return fields
  }

  function escapeSql(val: string): string {
    if (val === "" || val === "NULL") return "NULL"
    return `'${val.replace(/'/g, "''")}'`
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !targetTable) return
    setImporting(true)
    setResult(null)
    setImportOk(false)
    try {
      const text = await file.text()
      const isJson = file.name.endsWith(".json")
      let headers: string[]
      let rows: string[][]

      if (isJson) {
        const data = JSON.parse(text)
        const arr = Array.isArray(data) ? data : data.rows || data.data || []
        if (arr.length === 0) throw new Error("JSON must contain at least one row")
        if (Array.isArray(arr[0])) {
          headers = arr[0] as string[]
          rows = arr.slice(1).map((r: any) => (r as any[]).map(String))
        } else {
          headers = Object.keys(arr[0])
          rows = arr.map((r: any) => headers.map(h => String(r[h] ?? "")))
        }
      } else {
        const lines = text.split("\n").filter(Boolean)
        if (lines.length < 2) throw new Error("File must have a header row and at least one data row")
        headers = parseCsvLine(lines[0])
        rows = lines.slice(1).map(parseCsvLine)
      }

      let count = 0
      for (const vals of rows) {
        const placeholders = headers.map((_, j) => escapeSql(vals[j] || ""))
        const sql = `INSERT INTO \`${targetTable}\` (\`${headers.join("`, `")}\`) VALUES (${placeholders.join(", ")})`
        await invoke("execute_query", { id: connectionId, query: sql })
        count++
      }
      setResult(t('import.success', { count, table: targetTable }))
      setImportOk(true)
    } catch (e: any) {
      setResult(t('import.failed', { error: String(e) }))
      setImportOk(false)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('import.target_table')}</Label>
            <Select value={targetTable} onValueChange={setTargetTable}>
              <SelectTrigger>
                <SelectValue placeholder={t('import.select_table')} />
              </SelectTrigger>
              <SelectContent>
                {tables.filter(t => t.object_type === "TABLE" || t.object_type === "BASE TABLE").map(t => (
                  <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('import.csv_file')}</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFile}
              className="hidden"
            />
            <Button
              variant="outline"
              className="w-full h-20 border-dashed"
              disabled={!targetTable || importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {importing ? t('import.importing') : t('import.choose_file')}
            </Button>
          </div>
          {result && (
            <div className={`text-xs p-2 rounded ${importOk ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
              {result}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('import.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
