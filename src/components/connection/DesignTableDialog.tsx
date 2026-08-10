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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ColumnDef, ColumnInfo, DatabaseType, ForeignKeyInfo, IndexInfo } from "@/lib/db"

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
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [fks, setFks] = useState<ForeignKeyInfo[]>([])
  const [otherTables, setOtherTables] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newCol, setNewCol] = useState<ColumnDef>({ name: "", data_type: "VARCHAR(255)", nullable: true, primary_key: false, default_value: null })
  const [newIdx, setNewIdx] = useState<{ name: string; columns: string; unique: boolean }>({ name: "", columns: "", unique: false })
  const [newFk, setNewFk] = useState<{ name: string; column: string; refTable: string; refColumn: string }>({ name: "", column: "", refTable: "", refColumn: "" })

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
          setIndexes(tbl.indexes ?? [])
          setFks(tbl.foreign_keys ?? [])
          setOtherTables(cache.tables.map((x) => x.table).filter((x) => x !== table))
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
        <Tabs defaultValue="columns">
          <TabsList>
            <TabsTrigger value="columns">{t('dialog.design_tab_columns')}</TabsTrigger>
            <TabsTrigger value="indexes">{t('dialog.design_tab_indexes')}</TabsTrigger>
            <TabsTrigger value="fks">{t('dialog.design_tab_fks')}</TabsTrigger>
          </TabsList>

          <TabsContent value="columns" className="space-y-3">
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
          </TabsContent>

          <TabsContent value="indexes" className="space-y-3">
            <div className="border rounded max-h-[30vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80">
                  <tr className="border-b">
                    <th className="text-left px-2 py-1.5 font-medium">{t('dialog.idx_name')}</th>
                    <th className="text-left px-2 py-1.5 font-medium">{t('dialog.idx_columns')}</th>
                    <th className="text-center px-2 py-1.5 font-medium w-16">{t('dialog.idx_unique')}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {indexes.map((idx, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-2 py-1">{idx.name}</td>
                      <td className="px-2 py-1">{idx.columns.join(", ")}</td>
                      <td className="px-2 py-1 text-center">{idx.unique ? "✓" : ""}</td>
                      <td className="px-2 py-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title={t('dialog.idx_drop')}
                          disabled={busy}
                          onClick={() => runDdl(async () => {
                            const { dropIndex } = await import("@/lib/db")
                            await dropIndex(connectionId, database, table, idx.name)
                            setIndexes((prev) => prev.filter((_, x) => x !== i))
                          })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {indexes.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">{t('dialog.no_indexes')}</p>
              )}
            </div>

            <div className="flex items-end gap-2 border rounded p-2">
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.idx_name')}</label>
                <Input
                  value={newIdx.name}
                  onChange={(e) => setNewIdx((p) => ({ ...p, name: e.target.value }))}
                  className="h-7 text-xs"
                  placeholder={`idx_${table}_`}
                />
              </div>
              <div className="flex-[2]">
                <label className="text-[10px] text-muted-foreground">{t('dialog.idx_columns')}</label>
                <Input
                  value={newIdx.columns}
                  onChange={(e) => setNewIdx((p) => ({ ...p, columns: e.target.value }))}
                  className="h-7 text-xs"
                  placeholder="col1, col2"
                />
              </div>
              <div className="flex items-center gap-1 pb-1.5">
                <Checkbox
                  checked={newIdx.unique}
                  onCheckedChange={(v) => setNewIdx((p) => ({ ...p, unique: v === true }))}
                  id="new-idx-unique"
                />
                <label htmlFor="new-idx-unique" className="text-xs">{t('dialog.idx_unique')}</label>
              </div>
              <Button
                size="sm"
                className="text-xs"
                disabled={!newIdx.name.trim() || !newIdx.columns.trim() || busy}
                onClick={() => runDdl(async () => {
                  const { createIndex } = await import("@/lib/db")
                  const name = newIdx.name.trim()
                  const cols = newIdx.columns.split(",").map((c) => c.trim()).filter(Boolean)
                  await createIndex(connectionId, database, table, name, cols, newIdx.unique)
                  setIndexes((prev) => [...prev, { name, columns: cols, unique: newIdx.unique, index_type: "" }])
                  setNewIdx({ name: "", columns: "", unique: false })
                })}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('dialog.idx_add')}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="fks" className="space-y-3">
            <div className="border rounded max-h-[30vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80">
                  <tr className="border-b">
                    <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_name')}</th>
                    <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_column')}</th>
                    <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_ref_table')}</th>
                    <th className="text-left px-2 py-1.5 font-medium">{t('dialog.fk_ref_column')}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {fks.map((fk, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-2 py-1">{fk.constraint_name ?? fk.column_name}</td>
                      <td className="px-2 py-1">{fk.column_name}</td>
                      <td className="px-2 py-1">{fk.ref_table}</td>
                      <td className="px-2 py-1">{fk.ref_column}</td>
                      <td className="px-2 py-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title={t('dialog.fk_drop')}
                          disabled={busy}
                          onClick={() => runDdl(async () => {
                            const { dropForeignKey } = await import("@/lib/db")
                            await dropForeignKey(connectionId, database, table, fk.constraint_name ?? fk.column_name)
                            setFks((prev) => prev.filter((_, x) => x !== i))
                          })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fks.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">{t('dialog.no_fks')}</p>
              )}
            </div>

            <div className="flex items-end gap-2 border rounded p-2">
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.fk_name')}</label>
                <Input
                  value={newFk.name}
                  onChange={(e) => setNewFk((p) => ({ ...p, name: e.target.value }))}
                  className="h-7 text-xs"
                  placeholder={`fk_${table}_`}
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.fk_column')}</label>
                <Select
                  value={newFk.column}
                  onValueChange={(v) => setNewFk((p) => ({ ...p, column: v }))}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder={t('dialog.fk_column')} />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.filter((c) => !c.primary_key).map((c) => (
                      <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.fk_ref_table')}</label>
                <Select
                  value={newFk.refTable}
                  onValueChange={(v) => setNewFk((p) => ({ ...p, refTable: v, refColumn: "" }))}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder={t('dialog.fk_ref_table')} />
                  </SelectTrigger>
                  <SelectContent>
                    {otherTables.map((tb) => (
                      <SelectItem key={tb} value={tb}>{tb}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">{t('dialog.fk_ref_column')}</label>
                <Input
                  value={newFk.refColumn}
                  onChange={(e) => setNewFk((p) => ({ ...p, refColumn: e.target.value }))}
                  className="h-7 text-xs"
                  placeholder="id"
                />
              </div>
              <Button
                size="sm"
                className="text-xs"
                disabled={!newFk.name.trim() || !newFk.column || !newFk.refTable || !newFk.refColumn.trim() || busy}
                onClick={() => runDdl(async () => {
                  const { addForeignKey } = await import("@/lib/db")
                  const name = newFk.name.trim()
                  await addForeignKey(connectionId, database, table, name, newFk.column, newFk.refTable, newFk.refColumn.trim())
                  setFks((prev) => [...prev, {
                    constraint_name: name,
                    column_name: newFk.column,
                    ref_table: newFk.refTable,
                    ref_column: newFk.refColumn.trim(),
                  }])
                  setNewFk({ name: "", column: "", refTable: "", refColumn: "" })
                })}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('dialog.fk_add')}
              </Button>
            </div>
            {_dbType === "sqlite" && (
              <p className="text-[11px] text-muted-foreground">{t('dialog.fk_unsupported')}</p>
            )}
          </TabsContent>
        </Tabs>

        {error && <p className="text-xs text-destructive break-all">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
