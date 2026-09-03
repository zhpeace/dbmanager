import { Plus, Moon, Sun, GitBranch, Upload, ArrowLeftRight, Diff, Download, Upload as RestoreIcon, Clock, Search, KeyRound, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme"
import { useTranslation } from "react-i18next"

interface TopBarProps {
  onNewConnection: () => void
  connectionId?: string | null
  connectionName?: string | null
  currentDatabase?: string | null
  connectionMeta?: string | null
  dbType?: string
  onOpenErDiagram?: () => void
  onOpenImport?: () => void
  onOpenTransfer?: () => void
  onOpenCompare?: () => void
  onOpenBackup?: () => void
  onOpenRestore?: () => void
  onOpenSchedule?: () => void
  onOpenFind?: () => void
  onOpenLicense?: () => void
  onOpenSessions?: () => void
  isPro?: boolean
}

export function TopBar({
  onNewConnection,
  connectionId,
  connectionName,
  currentDatabase,
  connectionMeta,
  dbType,
  onOpenErDiagram,
  onOpenImport,
  onOpenTransfer,
  onOpenCompare,
  onOpenBackup,
  onOpenRestore,
  onOpenSchedule,
  onOpenFind,
  onOpenLicense,
  onOpenSessions,
  isPro,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme()
  const { t, i18n } = useTranslation()
  const isRedis = dbType === "redis"

  return (
    <header className="flex h-12 items-center justify-between border-b bg-sidebar px-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
              const rad = (a * Math.PI) / 180
              return (
                <line key={a} x1={12 + 2.8 * Math.cos(rad)} y1={12 + 2.8 * Math.sin(rad)} x2={12 + 8 * Math.cos(rad)} y2={12 + 8 * Math.sin(rad)} />
              )
            })}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
              const rad = (a * Math.PI) / 180
              return (
                <circle key={`n${a}`} cx={12 + 8 * Math.cos(rad)} cy={12 + 8 * Math.sin(rad)} r="1.5" fill="currentColor" stroke="none" />
              )
            })}
          </svg>
        </div>
        <span className="text-sm font-semibold">{t('app.title')}</span>
        {connectionId && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-2 border-l min-w-0">
            {connectionName && <span className="font-medium text-foreground truncate">{connectionName}</span>}
            {connectionMeta && connectionName && <span className="text-muted-foreground/70 whitespace-nowrap">{connectionMeta}</span>}
            {connectionName && currentDatabase && <span>/</span>}
            {currentDatabase && (
              <span className="font-medium text-foreground truncate">{currentDatabase}</span>
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
        {onOpenLicense && (
          <Button size="sm" variant="ghost" onClick={onOpenLicense} title={t('topbar.activate_license')}>
            <KeyRound className="h-4 w-4 mr-1" />
            {t('topbar.activate_license')}
          </Button>
        )}
        {connectionId && !isRedis && (
          <>
            <Button size="sm" variant="ghost" onClick={onOpenErDiagram}>
              <GitBranch className="h-4 w-4 mr-1" />
              {t('topbar.er_diagram')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (isPro ? onOpenImport?.() : onOpenLicense?.())}>
              <Upload className="h-4 w-4 mr-1" />
              {t('topbar.import')}{!isPro ? " (Pro)" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (isPro ? onOpenTransfer?.() : onOpenLicense?.())}>
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              {t('topbar.transfer')}{!isPro ? " (Pro)" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (isPro ? onOpenCompare?.() : onOpenLicense?.())}>
              <Diff className="h-4 w-4 mr-1" />
              {t('topbar.compare')}{!isPro ? " (Pro)" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (isPro ? onOpenBackup?.() : onOpenLicense?.())}>
              <Download className="h-4 w-4 mr-1" />
              {t('topbar.backup')}{!isPro ? " (Pro)" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (isPro ? onOpenRestore?.() : onOpenLicense?.())}>
              <RestoreIcon className="h-4 w-4 mr-1" />
              {t('topbar.restore')}{!isPro ? " (Pro)" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (isPro ? onOpenSchedule?.() : onOpenLicense?.())}>
              <Clock className="h-4 w-4 mr-1" />
              {t('topbar.schedule')}{!isPro ? " (Pro)" : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenFind}>
              <Search className="h-4 w-4 mr-1" />
              {t('topbar.find')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenSessions}>
              <Activity className="h-4 w-4 mr-1" />
              {t('topbar.sessions')}
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
