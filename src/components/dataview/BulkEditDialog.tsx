import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, Wand2 } from "lucide-react"
import type { BulkEditApply, BulkEditMode } from "@/lib/bulkEdit"

interface BulkEditDialogProps {
  open: boolean
  columns: string[]
  columnTypes?: Record<string, string>
  selectedCount: number
  onApply: (apply: BulkEditApply) => void
  onClose: () => void
}

type FnMode = "now" | "uuid" | "null" | "sequence"

export function BulkEditDialog({
  open,
  columns,
  columnTypes,
  selectedCount,
  onApply,
  onClose,
}: BulkEditDialogProps) {
  const { t } = useTranslation()
  const [column, setColumn] = useState(columns[0] ?? "")
  const [mode, setMode] = useState<BulkEditMode>("constant")
  const [value, setValue] = useState("")
  const [fn, setFn] = useState<FnMode>("now")
  const [seqStart, setSeqStart] = useState("1")
  const [seqStep, setSeqStep] = useState("1")

  useEffect(() => {
    if (open) {
      setColumn(columns[0] ?? "")
      setMode("constant")
      setValue("")
      setFn("now")
      setSeqStart("1")
      setSeqStep("1")
    }
  }, [open, columns])

  const handleApply = () => {
    if (!column) return
    const apply: BulkEditApply = {
      column,
      mode,
      value,
      seqStart: Number(seqStart) || 0,
      seqStep: Number(seqStep) || 1,
    }
    onApply(apply)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md w-[92vw]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" />
            {t('bulk_edit.title', { count: selectedCount })}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('bulk_edit.column')}</Label>
            <Select value={column} onValueChange={setColumn}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className="font-mono text-xs">{c}</span>
                    {columnTypes?.[c] ? <span className="ml-2 text-[10px] text-muted-foreground">{columnTypes[c]}</span> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('bulk_edit.mode')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as BulkEditMode)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="constant">{t('bulk_edit.mode_constant')}</SelectItem>
                <SelectItem value="expression">{t('bulk_edit.mode_expression')}</SelectItem>
                <SelectItem value="function">{t('bulk_edit.mode_function')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "constant" && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('bulk_edit.value')}</Label>
              <Input
                className="h-8 text-xs"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('bulk_edit.value_placeholder')}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
              />
            </div>
          )}

          {mode === "expression" && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">{t('bulk_edit.expression')}</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="原值+1"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
              />
              <p className="text-[11px] text-muted-foreground">{t('bulk_edit.expression_hint')}</p>
            </div>
          )}

          {mode === "function" && (
            <>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">{t('bulk_edit.function')}</Label>
                <Select value={fn} onValueChange={(v) => setFn(v as FnMode)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">now()</SelectItem>
                    <SelectItem value="uuid">uuid()</SelectItem>
                    <SelectItem value="null">NULL</SelectItem>
                    <SelectItem value="sequence">{t('bulk_edit.fn_sequence')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {fn === "sequence" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">{t('bulk_edit.seq_start')}</Label>
                    <Input className="h-8 text-xs" value={seqStart} onChange={(e) => setSeqStart(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">{t('bulk_edit.seq_step')}</Label>
                    <Input className="h-8 text-xs" value={seqStep} onChange={(e) => setSeqStep(e.target.value)} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-3 w-3 mr-1" />
            {t('bulk_edit.cancel')}
          </Button>
          <Button size="sm" onClick={handleApply} disabled={!column}>
            <Wand2 className="h-3 w-3 mr-1" />
            {t('bulk_edit.apply', { count: selectedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
