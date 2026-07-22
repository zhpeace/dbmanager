import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import type { ColumnDef, DatabaseType } from "@/lib/db"

const COMMON_TYPES = [
  "INT",
  "BIGINT",
  "VARCHAR(255)",
  "TEXT",
  "DECIMAL(10,2)",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "BLOB",
]

interface CreateTableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  dbType: DatabaseType
  onCreated: () => void
}

export function CreateTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  dbType: _dbType,
  onCreated,
}: CreateTableDialogProps) {
  const { t } = useTranslation()
  const [tableName, setTableName] = useState("")
  const [columns, setColumns] = useState<ColumnDef[]>([
    { name: "id", data_type: "INT", nullable: false, primary_key: true, default_value: null },
  ])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset() {
    setTableName("")
    setColumns([{ name: "id", data_type: "INT", nullable: false, primary_key: true, default_value: null }])
    setError(null)
  }

  function updateCol(i: number, patch: Partial<ColumnDef>) {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  async function handleCreate() {
    if (!tableName.trim()) {
      setError(t('dialog.table_name_required'))
      return
    }
    if (columns.some((c) => !c.name.trim())) {
      setError(t('dialog.column_name_required'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { createTable } = await import("@/lib/db")
      await createTable(connectionId, database, tableName.trim(), columns.map((c) => ({ ...c, name: c.name.trim() })))
      reset()
      onOpenChange(false)
      onCreated()
    } catch (e: any) {
      setError(t('dialog.failed', { error: String(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dialog.create_table_title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">{t('dialog.table_name')}</label>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder={t('dialog.table_name_placeholder')}
              className="flex-1"
            />
          </div>
          <div className="border rounded max-h-[50vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr className="border-b">
                  <th className="text-left px-2 py-1.5 font-medium w-10">#</th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.col_name')}</th>
                  <th className="text-left px-2 py-1.5 font-medium w-40">{t('dialog.col_type')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-16">{t('dialog.col_nullable')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-12">{t('dialog.col_pk')}</th>
                  <th className="text-left px-2 py-1.5 font-medium w-32">{t('dialog.col_default')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1">
                      <Input
                        value={col.name}
                        onChange={(e) => updateCol(i, { name: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={col.data_type}
                        onChange={(e) => updateCol(i, { data_type: e.target.value })}
                        list="common-types"
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={col.nullable}
                        onCheckedChange={(v) => updateCol(i, { nullable: v === true })}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={col.primary_key}
                        onCheckedChange={(v) => updateCol(i, { primary_key: v === true, nullable: v === true ? false : col.nullable })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={col.default_value ?? ""}
                        onChange={(e) => updateCol(i, { default_value: e.target.value || null })}
                        placeholder={t('dialog.default_placeholder')}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setColumns((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="common-types">
            {COMMON_TYPES.map((tp) => (
              <option key={tp} value={tp} />
            ))}
          </datalist>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setColumns((prev) => [...prev, { name: "", data_type: "VARCHAR(255)", nullable: true, primary_key: false, default_value: null }])}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('dialog.add_column')}
          </Button>
          {error && <p className="text-xs text-destructive break-all">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false) }}>
            {t('datatable.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={busy}>
            {t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
