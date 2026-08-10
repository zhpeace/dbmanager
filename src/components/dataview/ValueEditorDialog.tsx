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
import { X, Save } from "lucide-react"

interface ValueEditorDialogProps {
  open: boolean
  tableName: string
  column: string
  rowIndex: number
  value: unknown
  onSave: (value: string) => void
  onClose: () => void
}

export function ValueEditorDialog({
  open,
  tableName,
  column,
  rowIndex,
  value,
  onSave,
  onClose,
}: ValueEditorDialogProps) {
  const { t } = useTranslation()
  const [text, setText] = useState("")

  useEffect(() => {
    if (open) {
      if (value === null || value === undefined) setText("")
      else if (typeof value === "object") setText(JSON.stringify(value))
      else setText(String(value))
    }
  }, [open, value])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl w-[90vw] max-h-[80vh] overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {t('value_editor.title', { column, table: tableName })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col min-h-0 gap-2 h-[55vh]">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {t('value_editor.row', { row: rowIndex + 1 })}
            </span>
            <span className="text-muted-foreground/50">•</span>
            <span className="font-mono">{column}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="tabular-nums">{text.length} {t('value_editor.chars')}</span>
          </div>
          <textarea
            className="w-full flex-1 min-h-[120px] resize-none rounded-md border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onClose()
              } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                onSave(text)
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-3 w-3 mr-1" />
            {t('datatable.cancel')}
          </Button>
          <Button size="sm" onClick={() => onSave(text)}>
            <Save className="h-3 w-3 mr-1" />
            {t('value_editor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
