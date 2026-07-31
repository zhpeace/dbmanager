import { useState, useRef, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import { TopBar } from "@/components/layout/TopBar"
import { Sidebar } from "@/components/layout/Sidebar"
import { ConnectionDialog } from "@/components/connection/ConnectionDialog"
import { SqlEditor } from "@/components/editor/SqlEditor"
import { ResultPanel } from "@/components/dataview/ResultPanel"
import { TableBrowser } from "@/components/dataview/TableBrowser"
import { ErDiagram } from "@/components/dataview/ErDiagram"
import { ImportDialog } from "@/components/connection/ImportDialog"
import { TransferDialog } from "@/components/connection/TransferDialog"
import { CompareDialog } from "@/components/connection/CompareDialog"
import { BackupDialog } from "@/components/connection/BackupDialog"
import { RestoreDialog } from "@/components/connection/RestoreDialog"
import { SchedulerDialog } from "@/components/connection/SchedulerDialog"
import { NewDatabaseDialog } from "@/components/connection/NewDatabaseDialog"
import { DuplicateDatabaseDialog } from "@/components/connection/DuplicateDatabaseDialog"
import { cn } from "@/lib/utils"
import { CreateTableDialog } from "@/components/connection/CreateTableDialog"
import { DesignTableDialog } from "@/components/connection/DesignTableDialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeProvider } from "@/lib/theme"
import type {
  ConnectionConfig,
  Connection,
  DatabaseInfo,
  TableInfo,
  QueryResult,
} from "@/lib/db"
import { createObjectTemplate, getConnectionSecret, saveConnectionSecret, deleteConnectionSecret, type LicenseStatus } from "@/lib/db"
import { LicenseDialog, loadLicenseStatus } from "@/components/connection/LicenseDialog"

const STORAGE_KEY = "dbmanager-connections"

function loadConnections(): Connection[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch {
    return []
  }
}

function AppContent() {
  const { t } = useTranslation()
  const [connections, setConnections] = useState<Connection[]>(loadConnections)
  const connectionsRef = useRef(connections)
  connectionsRef.current = connections

  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [databases, setDatabases] = useState<Record<string, DatabaseInfo[]>>({})
  const [tables, setTables] = useState<Record<string, Record<string, TableInfo[]>>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [tabs, setTabs] = useState<{ id: string; title: string; sql: string }[]>(
    () => [{ id: crypto.randomUUID(), title: t('editor.tab_query') + " 1", sql: "" }]
  )
  const [activeTabId, setActiveTabId] = useState<string>(() => "")
  const activeTabIdRef = useRef<string>("")
  useEffect(() => {
    activeTabIdRef.current = activeTabId || tabs[0]?.id || ""
  }, [activeTabId, tabs])
  useEffect(() => {
    setActiveTabId((prev) => prev || tabs[0]?.id || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [executing, setExecuting] = useState(false)
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(null)
  const [browsingTable, setBrowsingTable] = useState<{ database: string; table: string } | null>(null)
  const [activeBottomTab, setActiveBottomTab] = useState<"results" | "browse">("results")
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [compareDialogOpen, setCompareDialogOpen] = useState(false)
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [schedulerDialogOpen, setSchedulerDialogOpen] = useState(false)
  const [newDatabaseConnId, setNewDatabaseConnId] = useState<string | null>(null)
  const [duplicateDb, setDuplicateDb] = useState<{ connectionId: string; database: string } | null>(null)
  const [showErDiagram, setShowErDiagram] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const [createDialog, setCreateDialog] = useState<{ database: string } | null>(null)
  const [designDialog, setDesignDialog] = useState<{ database: string; table: string } | null>(null)
  const [pendingDrop, setPendingDrop] = useState<{ type: string; name: string; database: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ database: string; table: string } | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [checkingLicense, setCheckingLicense] = useState(true)
  useEffect(() => {
    loadLicenseStatus().then((st) => {
      setLicense(st)
      setCheckingLicense(false)
    })
  }, [])

  useEffect(() => {
    const saved = loadConnections()
    // Migrate any legacy plaintext password from localStorage into the OS keyring
    // so the keyring remains the single source of truth after we stop persisting
    // passwords to localStorage.
    saved.forEach((c) => {
      if (c.config.password) {
        saveConnectionSecret(c.id, c.config.password).catch(() => {})
      }
    })
    const connected = saved.filter((c) => c.connected)
    if (connected.length > 0) {
      Promise.all(connected.map((c) => connectToDatabase(c)))
        .catch(() => {})
    }
  }, [])

  function saveConnections(conns: Connection[]) {
    setConnections(conns)
    connectionsRef.current = conns
    // Keep the password in localStorage as a fallback so connections are never
    // silently lost. The OS keyring (written on save) remains the preferred store.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conns))
  }

  async function resolvePassword(conn: Connection): Promise<string> {
    if (conn.config.password) return conn.config.password
    try {
      const secret = await getConnectionSecret(conn.id)
      if (secret) return secret
    } catch {
      // ignore
    }
    return ""
  }

  async function connectToDatabase(conn: Connection) {
    setLoading((prev) => ({ ...prev, [conn.id]: true }))
    const password = await resolvePassword(conn)
    try {
      if (conn.config.type === "sqlite") {
        await invoke("connect_sqlite", {
          id: conn.id,
          filePath: conn.config.filePath,
        })
      } else if (conn.config.type === "mysql") {
        await invoke("connect_mysql", {
          id: conn.id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database: conn.config.database || null,
        })
      } else if (conn.config.type === "postgresql") {
        await invoke("connect_postgres", {
          id: conn.id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database: conn.config.database || null,
        })
      } else if (conn.config.type === "mongodb") {
        await invoke("connect_mongo", {
          id: conn.id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database: conn.config.database || null,
        })
      } else if (conn.config.type === "oracle") {
        await invoke("connect_oracle", {
          id: conn.id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database: conn.config.database,
        })
      } else if (conn.config.type === "redis") {
        await invoke("connect_redis", {
          id: conn.id,
          host: conn.config.host,
          port: conn.config.port,
          password: password || null,
          database: String(conn.config.database ?? "0"),
        })
      }

      const dbs: DatabaseInfo[] = await invoke("get_databases", { id: conn.id })
      setDatabases((prev) => ({ ...prev, [conn.id]: dbs }))

      const current = connectionsRef.current
      const updated = current.map((c) =>
        c.id === conn.id ? { ...c, connected: true } : c
      )
      saveConnections(updated)
    } catch (e: any) {
      const msg = String(e?.message || e)
      setErrorBanner(t('app.connection_failed', { error: msg }))
    } finally {
      setLoading((prev) => ({ ...prev, [conn.id]: false }))
    }
  }

  async function handleSaveConnection(config: ConnectionConfig) {
    const current = connectionsRef.current
    const existing = current.find((c) => c.id === config.id)
    const connection: Connection = {
      id: config.id,
      config,
      connected: existing?.connected || false,
    }

    const updated = existing
      ? current.map((c) => (c.id === config.id ? { ...c, config } : c))
      : [...current, connection]

    if (config.password) {
      saveConnectionSecret(config.id, config.password).catch(() => {})
    }
    saveConnections(updated)
    setActiveConnectionId(connection.id)
    await connectToDatabase(connection)
  }

  async function handleSelectConnection(id: string) {
    setActiveConnectionId(id)
    setBrowsingTable(null)
    const conn = connectionsRef.current.find((c) => c.id === id)
    if (!conn) return

    if (!conn.connected) {
      await connectToDatabase(conn)
    }
  }

  async function handleDisconnect(id: string) {
    try {
      await invoke("disconnect", { id })
    } catch {}
    const current = connectionsRef.current
    const updated = current.map((c) =>
      c.id === id ? { ...c, connected: false } : c
    )
    saveConnections(updated)
    setDatabases((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTables((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setQueryResult(null)
    if (activeConnectionId === id) {
      setActiveConnectionId(null)
    }
  }

  function handleDatabaseClick(database: string) {
    setBrowsingTable({ database, table: "" })
  }

  async function handleLoadTables(id: string, database: string) {
    setLoading((prev) => ({ ...prev, [`${id}:${database}`]: true }))
    try {
      const conn = connectionsRef.current.find((c) => c.id === id)
      if (conn?.config.type === "mysql" && !conn.config.database) {
        const password = await resolvePassword(conn)
        await invoke("switch_database", {
          id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database,
        })
      }
      const result: TableInfo[] = await invoke("get_tables", { id, database })
      setTables((prev) => ({
        ...prev,
        [id]: { ...(prev[id] || {}), [database]: result },
      }))
    } catch (e: any) {
      alert(t('app.load_tables_failed', { error: String(e) }))
    }
    setLoading((prev) => ({ ...prev, [`${id}:${database}`]: false }))
  }

  async function handleRefresh(id: string) {
    setLoading((prev) => ({ ...prev, [id]: true }))
    try {
      const dbs: DatabaseInfo[] = await invoke("get_databases", { id })
      setDatabases((prev) => ({ ...prev, [id]: dbs }))
    } catch (e: any) {
      alert(t('app.refresh_failed', { error: String(e) }))
    }
    setLoading((prev) => ({ ...prev, [id]: false }))
  }

  async function handleExecute(sql: string) {
    if (!activeConnectionId) return
    setActiveBottomTab("results")
    setExecuting(true)
    try {
      const result: QueryResult = await invoke("execute_query", {
        id: activeConnectionId,
        query: sql,
      })
      setQueryResult(result)
    } catch (e: any) {
      setQueryResult({
        columns: [],
        rows: [],
        rowCount: 0,
        duration: "0ms",
        error: String(e),
      })
    } finally {
      setExecuting(false)
    }
  }

  function handleNewConnection() {
    setEditingConfig(null)
    setDialogOpen(true)
  }

  function handleEditConnection(id: string) {
    const conn = connectionsRef.current.find((c) => c.id === id)
    if (conn) {
      setEditingConfig(conn.config)
      setDialogOpen(true)
    }
  }

  function handleDuplicateConnection(id: string) {
    const conn = connectionsRef.current.find((c) => c.id === id)
    if (conn) {
      const newId = crypto.randomUUID()
      const dup: Connection = {
        id: newId,
        config: { ...conn.config, id: newId, name: `${conn.config.name} (Copy)` },
        connected: false,
      }
      saveConnections([...connectionsRef.current, dup])
    }
  }

  function handleOpenImport() {
    setImportDialogOpen(true)
  }

  function handleOpenTransfer() {
    setTransferDialogOpen(true)
  }

  function handleOpenCompare() {
    setCompareDialogOpen(true)
  }

  function handleOpenBackup() {
    setBackupDialogOpen(true)
  }

  function handleOpenRestore() {
    setRestoreDialogOpen(true)
  }

  function handleOpenSchedule() {
    setSchedulerDialogOpen(true)
  }

  function handleNewDatabase(connectionId: string) {
    setNewDatabaseConnId(connectionId)
  }

  function handleDuplicateDatabase(connectionId: string, database: string) {
    setDuplicateDb({ connectionId, database })
  }

  function handleDatabaseCreated() {
    if (newDatabaseConnId) {
      handleRefresh(newDatabaseConnId)
    }
  }

  function handleOpenErDiagram() {
    setShowErDiagram((prev) => !prev)
  }

  function connDbType(id: string | null): string {
    return connections.find((c) => c.id === id)?.config.type || "mysql"
  }

  function refreshTables(id: string, database: string) {
    handleLoadTables(id, database)
  }

  async function runDdlAndRefresh(fn: () => Promise<unknown>, id: string, database: string) {
    try {
      await fn()
      refreshTables(id, database)
    } catch (e: any) {
      setErrorBanner(t('dialog.failed', { error: String(e) }))
    }
  }

  function handleNewTable(database: string) {
    setCreateDialog({ database })
  }

  function handleDesignTable(database: string, table: string) {
    setDesignDialog({ database, table })
  }

  function handleDropObject(type: string, name: string, database: string) {
    setPendingDrop({ type, name, database })
  }

  async function confirmDrop() {
    if (!pendingDrop || !activeConnectionId) return
    const { type, name, database } = pendingDrop
    const id = activeConnectionId
    if (type === "DATABASE") {
      try {
        const db = await import("@/lib/db")
        await db.dropDatabase(id, name)
        setPendingDrop(null)
        handleRefresh(id)
      } catch (e: any) {
        setErrorBanner(t('dialog.failed', { error: String(e) }))
        setPendingDrop(null)
      }
      return
    }
    await runDdlAndRefresh(async () => {
      const db = await import("@/lib/db")
      if (type === "TABLE") await db.dropTable(id, database, name)
      else if (type === "VIEW") await db.dropView(id, database, name)
      else if (type === "FUNCTION") await db.dropRoutine(id, database, name, "FUNCTION")
      else if (type === "PROCEDURE") await db.dropRoutine(id, database, name, "PROCEDURE")
      else if (type === "TRIGGER") await db.dropTrigger(id, database, name)
      else if (type === "DATABASE") await db.dropDatabase(id, name)
    }, id, database)
    setPendingDrop(null)
  }

  async function handleTruncate(database: string, table: string) {
    if (!activeConnectionId) return
    const id = activeConnectionId
    await runDdlAndRefresh(async () => {
      const { truncateTable } = await import("@/lib/db")
      await truncateTable(id, database, table)
    }, id, database)
  }

  function handleRename(database: string, table: string) {
    setRenameTarget({ database, table })
    setRenameValue(table)
  }

  async function confirmRename() {
    if (!renameTarget || !activeConnectionId || !renameValue.trim()) {
      setRenameTarget(null)
      return
    }
    const { database, table } = renameTarget
    const id = activeConnectionId
    await runDdlAndRefresh(async () => {
      const { renameTable } = await import("@/lib/db")
      await renameTable(id, database, table, renameValue.trim())
    }, id, database)
    setRenameTarget(null)
  }

  function handleNewObject(type: string, _database: string) {
    if (!activeConnectionId) return
    const tpl = createObjectTemplate(connDbType(activeConnectionId), type, "")
    openInNewTab(tpl)
  }

  function activeTab() {
    return tabs.find((tb) => tb.id === activeTabId) || tabs[0]
  }

  function setActiveTabSql(sql: string) {
    const id = activeTabIdRef.current || tabs[0]?.id
    if (!id) return
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, sql } : tb)))
  }

  function openInNewTab(sql: string) {
    const id = crypto.randomUUID()
    const n = tabs.length + 1
    setTabs((prev) => [...prev, { id, title: t('editor.tab_query') + " " + n, sql }])
    setActiveTabId(id)
  }

  function newTab() {
    openInNewTab("")
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const next = prev.filter((tb) => tb.id !== id)
      if (next.length === 0) {
        const nid = crypto.randomUUID()
        setActiveTabId(nid)
        return [{ id: nid, title: t('editor.tab_query') + " 1", sql: "" }]
      }
      if (id === activeTabId) {
        const idx = prev.findIndex((tb) => tb.id === id)
        const fallback = prev[idx - 1] || prev[idx + 1]
        setActiveTabId(fallback?.id || next[0].id)
      }
      return next
    })
  }

  function handleDeleteConnection(id: string) {
    deleteConnectionSecret(id).catch(() => {})
    const updated = connectionsRef.current.filter((c) => c.id !== id)
    saveConnections(updated)
    setDatabases((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTables((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeConnectionId === id) {
      setActiveConnectionId(null)
    }
  }

  const activeConnection = connections.find((c) => c.id === activeConnectionId)
  const currentDatabase = browsingTable?.database || activeConnection?.config.database || null
  const currentTables = (activeConnectionId && tables[activeConnectionId] && currentDatabase)
    ? tables[activeConnectionId][currentDatabase] || []
    : []

  if (checkingLicense) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground">
        {t('app.loading')}
      </div>
    )
  }

  return (
    <>
      {!license?.activated && (
        <LicenseDialog
          open={!license?.activated}
          onActivated={(st) => setLicense(st)}
        />
      )}
      <div className="h-screen flex flex-col overflow-hidden">
      <TopBar
        onNewConnection={handleNewConnection}
        connectionId={activeConnectionId}
        connectionName={activeConnection?.config.name || null}
        currentDatabase={currentDatabase}
        onOpenErDiagram={handleOpenErDiagram}
        onOpenImport={handleOpenImport}
        onOpenTransfer={handleOpenTransfer}
        onOpenCompare={handleOpenCompare}
        onOpenBackup={handleOpenBackup}
        onOpenRestore={handleOpenRestore}
        onOpenSchedule={handleOpenSchedule}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          connections={connections}
          activeConnectionId={activeConnectionId}
          onSelectConnection={handleSelectConnection}
          onDisconnect={handleDisconnect}
          onRefresh={handleRefresh}
          onEditConnection={handleEditConnection}
          onDuplicateConnection={handleDuplicateConnection}
          onDeleteConnection={handleDeleteConnection}
          onLoadTables={handleLoadTables}
          onDatabaseClick={handleDatabaseClick}
          onTableClick={(sql, database, table) => {
            setActiveTabSql(sql)
            if (database && table) {
              setBrowsingTable({ database, table })
              setActiveBottomTab("browse")
            }
          }}
          onInsertSql={(sql) => setActiveTabSql(sql)}
          databases={databases}
          tables={tables}
          loading={loading}
          onNewTable={handleNewTable}
          onNewDatabase={handleNewDatabase}
          onDuplicateDatabase={handleDuplicateDatabase}
          onDesignTable={handleDesignTable}
          onDropObject={handleDropObject}
          onTruncateTable={handleTruncate}
          onRenameTable={handleRename}
          onNewObject={handleNewObject}
        />
        <main className="flex-1 flex flex-col min-w-0">
          {errorBanner && (
            <div className="bg-red-600 text-white text-sm px-4 py-2 flex items-center justify-between">
              <span className="break-all">{errorBanner}</span>
              <button
                className="ml-4 shrink-0 underline"
                onClick={() => setErrorBanner(null)}
              >
                ✕
              </button>
            </div>
          )}
          {activeConnection?.connected ? (
            showErDiagram ? (
              <ErDiagram connectionId={activeConnectionId!} database={currentDatabase || ""} />
            ) : (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center border-b bg-muted/30 overflow-x-auto">
                  {tabs.map((tb) => (
                    <div
                      key={tb.id}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 text-xs border-r cursor-pointer whitespace-nowrap",
                        tb.id === (activeTabId || tabs[0]?.id)
                          ? "bg-background text-foreground font-medium"
                          : "text-muted-foreground hover:bg-background/60",
                      )}
                      onClick={() => setActiveTabId(tb.id)}
                    >
                      <span>{tb.title}</span>
                      <button
                        className="ml-1 h-4 w-4 flex items-center justify-center rounded hover:bg-muted-foreground/20"
                        onClick={(e) => { e.stopPropagation(); closeTab(tb.id) }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-h-0 border-b">
                  <SqlEditor
                    onExecute={handleExecute}
                    result={queryResult}
                    executing={executing}
                    value={activeTab()?.sql || ""}
                    onChange={setActiveTabSql}
                    onNewTab={newTab}
                    connectionId={activeConnectionId}
                    currentDatabase={currentDatabase}
                  />
                </div>
                <div className="h-1/3 min-h-[120px] flex flex-col">
                  {activeBottomTab === "browse" && browsingTable && activeConnectionId ? (
                    <TableBrowser
                      connectionId={activeConnectionId}
                      database={browsingTable.database}
                      table={browsingTable.table}
                      dbType={activeConnection!.config.type}
                      onClose={() => { setBrowsingTable(null); setActiveBottomTab("results") }}
                    />
                  ) : (
                    <ResultPanel result={queryResult} />
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-5xl mb-4 opacity-20">🗄️</div>
                <h2 className="text-lg font-semibold mb-1">{t('app.welcome')}</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {t('app.welcome_desc')}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveConnection}
        editingConfig={editingConfig}
      />
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        connectionId={activeConnectionId || ""}
        tables={currentTables}
      />
      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        connections={connections}
      />
      <CompareDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        connections={connections}
      />
      <BackupDialog
        open={backupDialogOpen}
        onOpenChange={setBackupDialogOpen}
        connections={connections}
      />
      <RestoreDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        connections={connections}
      />
      <SchedulerDialog
        open={schedulerDialogOpen}
        onOpenChange={setSchedulerDialogOpen}
        connections={connections}
      />
      {newDatabaseConnId && (
        <NewDatabaseDialog
          open={true}
          onOpenChange={() => setNewDatabaseConnId(null)}
          connectionId={newDatabaseConnId}
          onCreated={handleDatabaseCreated}
        />
      )}
      {duplicateDb && (
        <DuplicateDatabaseDialog
          open={true}
          onOpenChange={() => setDuplicateDb(null)}
          connectionId={duplicateDb.connectionId}
          sourceDb={duplicateDb.database}
          onDone={() => { handleRefresh(duplicateDb.connectionId); setDuplicateDb(null) }}
        />
      )}
      {createDialog && activeConnectionId && (
        <CreateTableDialog
          open={true}
          onOpenChange={(o) => { if (!o) setCreateDialog(null) }}
          connectionId={activeConnectionId}
          database={createDialog.database}
          dbType={connDbType(activeConnectionId) as any}
          onCreated={() => refreshTables(activeConnectionId!, createDialog.database)}
        />
      )}
      {designDialog && activeConnectionId && (
        <DesignTableDialog
          open={true}
          onOpenChange={(o) => { if (!o) setDesignDialog(null) }}
          connectionId={activeConnectionId}
          database={designDialog.database}
          table={designDialog.table}
          dbType={connDbType(activeConnectionId) as any}
          onChanged={() => refreshTables(activeConnectionId!, designDialog.database)}
        />
      )}
      <Dialog open={!!pendingDrop} onOpenChange={(o) => { if (!o) setPendingDrop(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pendingDrop?.type === "DATABASE" ? t('sidebar.drop_database') : t('sidebar.drop_table')}</DialogTitle>
          </DialogHeader>
          {pendingDrop && (
            <p className="text-sm break-all">{t('dialog.drop_confirm', { type: pendingDrop.type === "DATABASE" ? t('dialog.database') : pendingDrop.type.toLowerCase(), name: pendingDrop.name })}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDrop(null)}>
              {t('datatable.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDrop}>
              {pendingDrop?.type === "DATABASE" ? t('sidebar.drop_database') : t('sidebar.drop_table')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialog.rename')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground w-20 shrink-0">{t('dialog.new_name')}</label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t('datatable.cancel')}
            </Button>
            <Button onClick={confirmRename}>
              {t('dialog.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

export default App
