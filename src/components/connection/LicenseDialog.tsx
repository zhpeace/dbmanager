import { useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRound, CheckCircle2, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { activateLicense, type LicenseStatus } from "@/lib/db"

export function LicenseDialog({
  open,
  onActivated,
}: {
  open: boolean
  onActivated: (status: LicenseStatus) => void
}) {
  const { t } = useTranslation()
  const [key, setKey] = useState("")
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle")
  const [message, setMessage] = useState("")

  async function handleActivate() {
    try {
      const res = await activateLicense(key)
      if (res.activated) {
        setStatus("ok")
        setMessage(t('license.activated'))
        setTimeout(() => onActivated(res), 600)
      } else {
        setStatus("err")
        setMessage(t('license.invalid'))
      }
    } catch (e) {
      setStatus("err")
      setMessage(String(e))
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" hideClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('license.title')}
          </DialogTitle>
          <DialogDescription>
            {t('license.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            placeholder={t('license.placeholder')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleActivate()}
            autoFocus
          />
          {status === "ok" && (
            <p className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" /> {message}
            </p>
          )}
          {status === "err" && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {message}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={handleActivate} disabled={key.trim().length === 0}>
            {t('license.activate')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
