import { Database, Plus, Moon, Sun, GitBranch, Upload, ArrowLeftRight, Diff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme"
import { useTranslation } from "react-i18next"

interface TopBarProps {
  onNewConnection: () => void
  connectionId?: string | null
  connectionName?: string | null
  currentDatabase?: string | null
  onOpenErDiagram?: () => void
  onOpenImport?: () => void
  onOpenTransfer?: () => void
  onOpenCompare?: () => void
}

export function TopBar({
  onNewConnection,
  connectionId,
  connectionName,
  currentDatabase,
  onOpenErDiagram,
  onOpenImport,
  onOpenTransfer,
  onOpenCompare,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme()
  const { t, i18n } = useTranslation()

  return (
    <header className="flex h-12 items-center justify-between border-b bg-sidebar px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Database className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold">{t('app.title')}</span>
        {connectionId && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-2 border-l">
            {connectionName && <span className="font-medium text-foreground">{connectionName}</span>}
            {connectionName && currentDatabase && <span>/</span>}
            {currentDatabase && (
              <span className="font-medium text-foreground">{currentDatabase}</span>
            )}
            {!currentDatabase && (
              <span>{t('topbar.no_database')}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = i18n.language === 'en' ? 'zh' : 'en'
            i18n.changeLanguage(next)
            localStorage.setItem('lang', next)
          }}
        >
          {t('topbar.lang_toggle')}
        </Button>
        {connectionId && (
          <>
            <Button size="sm" variant="ghost" onClick={onOpenErDiagram}>
              <GitBranch className="h-4 w-4 mr-1" />
              {t('topbar.er_diagram')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenImport}>
              <Upload className="h-4 w-4 mr-1" />
              {t('topbar.import')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenTransfer}>
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              {t('topbar.transfer')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenCompare}>
              <Diff className="h-4 w-4 mr-1" />
              {t('topbar.compare')}
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button size="sm" onClick={onNewConnection}>
          <Plus className="h-4 w-4" />
          {t('topbar.new_connection')}
        </Button>
      </div>
    </header>
  )
}
