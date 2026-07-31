import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Loader2, XCircle } from "lucide-react"
import { createDatabase } from "@/lib/db"

interface NewDatabaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  onCreated: () => void
}

export function NewDatabaseDialog({ open, onOpenChange, connectionId, onCreated }: NewDatabaseDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createDatabase(connectionId, name.trim())
      onCreated()
      onOpenChange(false)
      setName("")
    } catch (e: any) {
      setError(e.toString())
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.new_database')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('dialog.database_name')}</Label>
            <Input
              className="h-8 text-xs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dialog.database_name_placeholder')}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <XCircle className="h-3 w-3" />
              {error}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('dialog.cancel')}</Button>
          <Button size="sm" onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
