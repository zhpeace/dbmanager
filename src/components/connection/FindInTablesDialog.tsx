import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Loader2, Table2 } from "lucide-react"
import { findInTables, type FindMatch } from "@/lib/db"

interface FindInTablesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string | null
  database: string | null
  onOpenRow: (table: string) => void
}

export function FindInTablesDialog({ open, onOpenChange, connectionId, database, onOpenRow }: FindInTablesDialogProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [matches, setMatches] = useState<FindMatch[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSearch = !!connectionId && !!database

  const handleSearch = async () => {
    if (!connectionId || !database) return
    if (!search.trim()) return
    setSearching(true)
    setError(null)
    setMatches([])
    try {
      const result = await findInTables(connectionId, database, search.trim())
      setMatches(result)
      setSearched(true)
    } catch (e: any) {
      setError(String(e))
    } finally {
      setSearching(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSearch()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4" />
            {t('find.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('find.placeholder')}
            className="text-sm"
          />
          <Button size="sm" onClick={handleSearch} disabled={!canSearch || searching || !search.trim()}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {t('find.search')}
          </Button>
        </div>
        {!canSearch && (
          <p className="text-xs text-muted-foreground">{t('find.need_connection')}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="max-h-80 overflow-auto border rounded-md">
          {searched && matches.length === 0 && !searching && (
            <div className="p-4 text-center text-xs text-muted-foreground">{t('find.no_results')}</div>
          )}
          {matches.map((m, i) => (
            <button
              key={i}
              className="w-full text-left px-3 py-2 border-b border-border/50 last:border-b-0 hover:bg-muted/60 flex items-start gap-2"
              onClick={() => {
                onOpenRow(m.table)
                onOpenChange(false)
              }}
            >
              <Table2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">
                  <span className="text-muted-foreground">{m.table}</span>
                  <span className="text-muted-foreground/60"> · </span>
                  <span>{m.column}</span>
                </div>
                <div className="text-xs font-mono text-muted-foreground truncate mt-0.5">{m.value}</div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
