import { useState, useEffect } from "react"
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
import type { ColumnDef, ColumnInfo, DatabaseType } from "@/lib/db"

interface DesignTableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  table: string
  dbType: DatabaseType
  onChanged: () => void
}

export function DesignTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  table,
  dbType: _dbType,
  onChanged,
}: DesignTableDialogProps) {
  const { t } = useTranslation()
  const [columns, setColumns] = useState<ColumnDef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newCol, setNewCol] = useState<ColumnDef>({ name: "", data_type: "VARCHAR(255)", nullable: true, primary_key: false, default_value: null })

  useEffect(() => {
    if (!open) return
    setError(null)
    ;(async () => {
      try {
        const { getSchemaCache } = await import("@/lib/db")
        const cache = await getSchemaCache(connectionId, database)
        const tbl = cache.tables.find((x) => x.table === table)
        if (tbl) {
          const defs: ColumnDef[] = tbl.columns.map((c: ColumnInfo) => ({
            name: c.name,
            data_type: c.data_type,
            nullable: c.nullable,
            primary_key: c.key === "PRI",
            default_value: c.default_value ?? null,
          }))
          setColumns(defs)
        }
      } catch (e: any) {
        setError(String(e))
      }
    })()
  }, [open, connectionId, database, table])

  async function runDdl(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e: any) {
      setError(t('dialog.failed', { error: String(e) }))
    } finally {
      setBusy(false)
    }
  }

  function updateCol(i: number, patch: Partial<ColumnDef>) {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('dialog.design_table_title', { table })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="border rounded max-h-[50vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr className="border-b">
                  <th className="text-left px-2 py-1.5 font-medium w-10">#</th>
                  <th className="text-left px-2 py-1.5 font-medium">{t('dialog.col_name')}</th>
                  <th className="text-left px-2 py-1.5 font-medium w-40">{t('dialog.col_type')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-16">{t('dialog.col_nullable')}</th>
                  <th className="text-center px-2 py-1.5 font-medium w-12">{t('dialog.col_pk')}</th>
                  <th className="text-left px-2 py-1.5 font-medium w-28">{t('dialog.col_default')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1">
                      <Input value={col.name} onChange={(e) => updateCol(i, { name: e.target.value })} className="h-7 text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={col.data_type} onChange={(e) => updateCol(i, { data_type: e.target.value })} className="h-7 text-xs" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox checked={col.nullable} onCheckedChange={(v) => updateCol(i, { nullable: v === true })} />
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
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={t('dialog.design_drop_col')}
                        disabled={busy}
                        onClick={() => runDdl(async () => {
                          const { alterDropColumn } = await import("@/lib/db")
                          await alterDropColumn(connectionId, database, table, col.name)
                          setColumns((prev) => prev.filter((_, idx) => idx !== i))
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-end gap-2 border rounded p-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.col_name')}</label>
              <Input value={newCol.name} onChange={(e) => setNewCol((p) => ({ ...p, name: e.target.value }))} className="h-7 text-xs" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('dialog.col_type')}</label>
              <Input value={newCol.data_type} onChange={(e) => setNewCol((p) => ({ ...p, data_type: e.target.value }))} className="h-7 text-xs" />
            </div>
            <Button
              size="sm"
              className="text-xs"
              disabled={!newCol.name.trim() || busy}
              onClick={() => runDdl(async () => {
                const { alterAddColumn } = await import("@/lib/db")
                const col = { ...newCol, name: newCol.name.trim() }
                await alterAddColumn(connectionId, database, table, col)
                setColumns((prev) => [...prev, col])
                setNewCol({ name: "", data_type: "VARCHAR(255)", nullable: true, primary_key: false, default_value: null })
              })}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('dialog.design_add')}
            </Button>
          </div>

          {error && <p className="text-xs text-destructive break-all">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
