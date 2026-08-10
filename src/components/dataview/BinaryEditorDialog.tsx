import { useState, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { X, Save, Braces, Text } from "lucide-react"

function valueToHex(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value !== "string") return ""
  if (/^0x[0-9a-fA-F]+$/.test(value)) return value.slice(2).toUpperCase()
  const bytes = new TextEncoder().encode(value)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "")
  const out = new Uint8Array(Math.ceil(clean.length / 2))
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0
  }
  return out
}

function hexDump(hex: string, maxBytes = 16384): { text: string; truncated: boolean } {
  const bytes = hexToBytes(hex)
  const total = bytes.length
  const shown = bytes.slice(0, maxBytes)
  const lines: string[] = []
  for (let off = 0; off < shown.length; off += 16) {
    const chunk = shown.slice(off, off + 16)
    const offset = off.toString(16).padStart(8, "0")
    const hexCols = Array.from(chunk).map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    while (hexCols.length < 16) hexCols.push("  ")
    const ascii = Array.from(chunk).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("")
    lines.push(`${offset}  ${hexCols.slice(0, 8).join(" ")}  ${hexCols.slice(8).join(" ")}  |${ascii}|`)
  }
  return { text: lines.join("\n"), truncated: total > maxBytes }
}

interface BinaryEditorDialogProps {
  open: boolean
  tableName: string
  column: string
  rowIndex: number
  value: unknown
  onSave: (hexValue: string) => void
  onClose: () => void
}

export function BinaryEditorDialog({
  open,
  tableName,
  column,
  rowIndex,
  value,
  onSave,
  onClose,
}: BinaryEditorDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<"hex" | "text">("hex")
  const [hex, setHex] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setHex(valueToHex(value))
      setError(null)
      const original = value
      setMode(typeof original === "string" && !/^0x[0-9a-fA-F]+$/.test(original) ? "text" : "hex")
    }
  }, [open, value])

  const bytesLen = useMemo(() => Math.ceil(hex.length / 2), [hex])
  const dump = useMemo(() => hexDump(hex), [hex])

  const save = () => {
    const clean = hex.replace(/[^0-9a-fA-F]/g, "").toUpperCase()
    if (clean.length % 2 !== 0) {
      setError(t('value_editor.hex_odd'))
      return
    }
    onSave(`0x${clean}`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[92vw] max-h-[85vh] overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">
            {t('value_editor.binary_title', { column, table: tableName })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col min-h-0 gap-2 h-[55vh]">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{t('value_editor.row', { row: rowIndex + 1 })}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="font-mono">{column}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="tabular-nums">{bytesLen} {t('value_editor.bytes')}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant={mode === "hex" ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => setMode("hex")}
              >
                <Braces className="h-3 w-3 mr-1" />
                Hex
              </Button>
              <Button
                size="sm"
                variant={mode === "text" ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                onClick={() => setMode("text")}
              >
                <Text className="h-3 w-3 mr-1" />
                Text
              </Button>
            </div>
          </div>

          {mode === "hex" ? (
            <div className="flex flex-col min-h-0 flex-1 gap-2">
              <pre className="flex-1 min-h-0 overflow-auto rounded-md border bg-background p-2 text-[10px] font-mono leading-4">
                {dump.text}
                {dump.truncated && (
                  <div className="text-muted-foreground">
                    … {t('value_editor.truncated', { bytes: bytesLen - 16384 })}
                  </div>
                )}
              </pre>
              <textarea
                className="w-full h-28 shrink-0 resize-none rounded-md border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
                value={hex}
                onChange={(e) => {
                  setHex(e.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase())
                  setError(null)
                }}
                spellCheck={false}
                placeholder="00 01 02 …"
              />
            </div>
          ) : (
            <textarea
              className="w-full flex-1 min-h-[120px] resize-none rounded-md border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
              value={(() => {
                try {
                  return new TextDecoder("utf-8", { fatal: false }).decode(hexToBytes(hex))
                } catch {
                  return ""
                }
              })()}
              onChange={(e) => {
                const bytes = new TextEncoder().encode(e.target.value)
                setHex(Array.from(bytes).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(""))
                setError(null)
              }}
            spellCheck={false}
          />
        )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            <X className="h-3 w-3 mr-1" />
            {t('datatable.cancel')}
          </Button>
          <Button size="sm" onClick={save}>
            <Save className="h-3 w-3 mr-1" />
            {t('value_editor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
