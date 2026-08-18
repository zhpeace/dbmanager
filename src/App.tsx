import { useState, useRef, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { invokeWithTimeout } from "@/lib/invoke"
import { open, save } from "@tauri-apps/plugin-dialog"
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
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { CreateTableDialog } from "@/components/connection/CreateTableDialog"
import { DesignTableDialog } from "@/components/connection/DesignTableDialog"
import { FindInTablesDialog } from "@/components/connection/FindInTablesDialog"
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
  ExecResult,
  DatabaseType,
} from "@/lib/db"
import { createObjectTemplate, getConnectionSecret, saveConnectionSecret, deleteConnectionSecret, buildSelectPreview, type LicenseStatus } from "@/lib/db"
import { splitSqlStatements, parseErrorLine, buildExplainSql } from "@/lib/sql"
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
  const [schemas, setSchemas] = useState<Record<string, Record<string, DatabaseInfo[]>>>({})
  const [tables, setTables] = useState<Record<string, Record<string, TableInfo[]>>>({})
  const [redisScanCursor, setRedisScanCursor] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [tabs, setTabs] = useState<{ id: string; title: string; sql: string; filePath: string | null; browse?: { connectionId: string; database: string; table: string } | null; database?: Record<string, string | null> }[]>(
    () => [{ id: crypto.randomUUID(), title: t('editor.tab_query') + " 1", sql: "", filePath: null, database: {} }]
  )
  const backendDbRef = useRef<string | null>(null)
  const [activeTabId, setActiveTabId] = useState<string>(() => "")
  const activeTabIdRef = useRef<string>("")
  const lastTabByConnRef = useRef<Record<string, string>>({})
  const activeConnIdRef = useRef<string>("")
  useEffect(() => {
    activeTabIdRef.current = activeTabId || tabs[0]?.id || ""
    const tb = tabs.find((x) => x.id === (activeTabId || tabs[0]?.id || ""))
    if (tb) {
      const connId = tb.browse?.connectionId
      if (connId) lastTabByConnRef.current[connId] = tb.id
    }

    // Safety invariant: the active connection may never leave a browse tab
    // bound to a *different* connection active, since that renders the other
    // connection's SQL preview in the editor. Applies to every code path that
    // changes activeConnectionId, not just sidebar clicks.
    if (activeConnectionId && activeConnIdRef.current !== activeConnectionId) {
      activeConnIdRef.current = activeConnectionId
      const cur = tabs.find((x) => x.id === (activeTabId || tabs[0]?.id || ""))
      if (cur?.browse?.connectionId && cur.browse.connectionId !== activeConnectionId) {
        const queryTab = tabs.find((t) => !t.browse)
        if (queryTab && queryTab.id !== cur.id) setActiveTabId(queryTab.id)
      }
    }
  }, [activeConnectionId, activeTabId, tabs])
  const tabBarRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  useEffect(() => {
    const bar = tabBarRef.current
    const el = tabRefs.current.get(activeTabId || tabs[0]?.id || "")
    if (!bar || !el) return
    const barRect = bar.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    if (elRect.right > barRect.right - 1) {
      bar.scrollTo({ left: bar.scrollLeft + (elRect.right - barRect.right) + 8, behavior: "smooth" })
    } else if (elRect.left < barRect.left + 1) {
      bar.scrollTo({ left: bar.scrollLeft + (elRect.left - barRect.left) - 8, behavior: "smooth" })
    }
  }, [activeTabId, tabs])
  const [tabOverflow, setTabOverflow] = useState(false)
  const checkTabOverflow = useCallback(() => {
    const el = tabBarRef.current
    setTabOverflow(!!el && el.scrollWidth > el.clientWidth + 1)
  }, [])
  useEffect(() => {
    checkTabOverflow()
    const el = tabBarRef.current
    let ro: ResizeObserver | null = null
    if (el) {
      ro = new ResizeObserver(checkTabOverflow)
      ro.observe(el)
    }
    window.addEventListener("resize", checkTabOverflow)
    return () => {
      ro?.disconnect()
      window.removeEventListener("resize", checkTabOverflow)
    }
  }, [checkTabOverflow, tabs.length])
  const scrollTabs = useCallback((dir: 1 | -1) => {
    tabBarRef.current?.scrollBy({ left: dir * 240, behavior: "smooth" })
  }, [])
  useEffect(() => {
    setActiveTabId((prev) => prev || tabs[0]?.id || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [queryResults, setQueryResults] = useState<ExecResult[]>([])
  const [errorMarker, setErrorMarker] = useState<{ line: number; message: string } | null>(null)
  const [executing, setExecuting] = useState(false)
  const [txActive, setTxActive] = useState<Record<string, boolean>>({})
  const [sqlHistory, setSqlHistory] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dbmanager-sqlhistory") || "[]")
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    localStorage.setItem("dbmanager-sqlhistory", JSON.stringify(sqlHistory))
  }, [sqlHistory])
  const [sqlFavorites, setSqlFavorites] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dbmanager-sqlfavorites") || "[]")
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    localStorage.setItem("dbmanager-sqlfavorites", JSON.stringify(sqlFavorites))
  }, [sqlFavorites])
  const [editingConfig, setEditingConfig] = useState<ConnectionConfig | null>(null)
  const [activeBottomTab, setActiveBottomTab] = useState<"results" | "browse">("results")
  const BOTTOM_PANEL_MIN = 120
  const [bottomPanelHeight, setBottomPanelHeight] = useState<number>(() => {
    const saved = Number(localStorage.getItem("dbmanager-bottomPanelHeight"))
    return Number.isFinite(saved) && saved >= BOTTOM_PANEL_MIN ? saved : Math.round(window.innerHeight / 3)
  })
  const bottomPanelStartHeight = useRef(bottomPanelHeight)
  useEffect(() => {
    localStorage.setItem("dbmanager-bottomPanelHeight", String(bottomPanelHeight))
  }, [bottomPanelHeight])
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [compareDialogOpen, setCompareDialogOpen] = useState(false)
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [schedulerDialogOpen, setSchedulerDialogOpen] = useState(false)
  const [findDialogOpen, setFindDialogOpen] = useState(false)
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
      if (conn.config.type === "mysql" || conn.config.type === "postgresql") {
        backendDbRef.current = conn.config.database || null
      }

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

async function handleSelectConnection(id: string, restoreBrowse = false) {
  setActiveConnectionId(id)
  if (id !== activeConnectionId) {
    setActiveBottomTab("results")
  }
  const conn = connectionsRef.current.find((c) => c.id === id)

  // Only a direct sidebar connection click should restore that connection's
  // last browse tab; opening a table or switching via the tab bar sets its own
  // active tab explicitly. Run before the (possibly slow) connect so a stale
  // browse tab from another connection can never render its SQL preview.
  if (restoreBrowse) {
    const lastId = lastTabByConnRef.current[id]
    const tab = lastId ? tabs.find((t) => t.id === lastId && t.browse?.connectionId === id) : undefined
    if (tab) {
      setActiveTabId(tab.id)
      setActiveBottomTab("browse")
    } else {
      // No browse tab for this connection yet - don't leave another
      // connection's stale browse tab active (it would render its SQL
      // preview in the editor). Fall back to a plain query tab, creating
      // one if every open tab is a browse tab.
      const queryTab = tabs.find((t) => !t.browse)
      if (queryTab) {
        setActiveTabId(queryTab.id)
      } else {
        openInNewTab("")
      }
    }
  }

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
    setSchemas((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setTables((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setQueryResults([])
    setErrorMarker(null)
    setTxActive((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeConnectionId === id) {
      setActiveConnectionId(null)
    }
  }

function handleDatabaseClick(database: string, connectionId: string) {
  const tb = activeTab()
  if (!tb) return
  const currentId = activeTabIdRef.current || tabs[0]?.id || ""
  if (tb.browse?.table) return
  setTabs((prev) =>
    prev.map((t2) =>
      t2.id === currentId ? { ...t2, browse: { connectionId, database, table: "" } } : t2
    )
  )
}

  async function handleLoadTables(id: string, database: string) {
    setLoading((prev) => ({ ...prev, [`${id}:${database}`]: true }))
    try {
      const conn = connectionsRef.current.find((c) => c.id === id)
      const needSwitch =
        (conn?.config.type === "mysql" && !conn.config.database) ||
        (conn?.config.type === "postgresql" && conn.config.database !== database)
      if (needSwitch && conn) {
        const password = await resolvePassword(conn)
        await invoke("switch_database", {
          id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database,
          databaseType: conn.config.type,
        })
        backendDbRef.current = database
      }
      if (conn?.config.type === "redis") {
        const tabKey = `${id}:${database}`
        const page = await invokeWithTimeout<{ keys: TableInfo[]; cursor: number }>("redis_scan_keys", {
          id,
          database,
          pattern: "*",
          cursor: 0,
          count: 200,
          typeFilter: null,
        })
        setTables((prev) => ({
          ...prev,
          [id]: { ...(prev[id] || {}), [database]: page.keys },
        }))
        setRedisScanCursor((prev) => ({ ...prev, [tabKey]: page.cursor }))
      } else {
        const result: TableInfo[] = await invoke("get_tables", { id, database })
        setTables((prev) => ({
          ...prev,
          [id]: { ...(prev[id] || {}), [database]: result },
        }))
      }
      if (conn?.config.type === "postgresql") {
        const schemasResult: DatabaseInfo[] = await invoke("get_schemas", { id })
        setSchemas((prev) => ({
          ...prev,
          [id]: { ...(prev[id] || {}), [database]: schemasResult },
        }))
      }
    } catch (e: any) {
      alert(t('app.load_tables_failed', { error: String(e) }))
    }
    setLoading((prev) => ({ ...prev, [`${id}:${database}`]: false }))
  }

  async function redisScan(tabKey: string, conn: Connection, database: string, pattern: string, typeFilter: string) {
    try {
      const page = await invokeWithTimeout<{ keys: TableInfo[]; cursor: number }>("redis_scan_keys", {
        id: conn.id,
        database,
        pattern: pattern || "*",
        cursor: 0,
        count: 200,
        typeFilter: typeFilter || null,
      })
      setTables((prev) => ({ ...prev, [conn.id]: { ...(prev[conn.id] || {}), [database]: page.keys } }))
      setRedisScanCursor((prev) => ({ ...prev, [tabKey]: page.cursor }))
    } catch (e: any) {
      setErrorBanner(t('app.load_tables_failed', { error: String(e) }))
    }
  }

  async function handleRedisSearch(connectionId: string, database: string, pattern: string, typeFilter: string) {
    const conn = connectionsRef.current.find((c) => c.id === connectionId)
    if (!conn || conn.config.type !== "redis") return
    const tabKey = `${connectionId}:${database}`
    setLoading((prev) => ({ ...prev, [tabKey]: true }))
    try {
      await redisScan(tabKey, conn, database, pattern, typeFilter)
    } finally {
      setLoading((prev) => ({ ...prev, [tabKey]: false }))
    }
  }

  async function handleRedisLoadMore(connectionId: string, database: string) {
    const conn = connectionsRef.current.find((c) => c.id === connectionId)
    if (!conn || conn.config.type !== "redis") return
    const tabKey = `${connectionId}:${database}`
    const cursor = redisScanCursor[tabKey] ?? 0
    if (cursor <= 0) return
    try {
      const page = await invokeWithTimeout<{ keys: TableInfo[]; cursor: number }>("redis_scan_keys", {
        id: conn.id,
        database,
        pattern: "*",
        cursor,
        count: 200,
        typeFilter: null,
      })
      setTables((prev) => ({
        ...prev,
        [conn.id]: { ...(prev[conn.id] || {}), [database]: [...(prev[conn.id]?.[database] || []), ...page.keys] },
      }))
      setRedisScanCursor((prev) => ({ ...prev, [tabKey]: page.cursor }))
    } catch (e: any) {
      setErrorBanner(t('app.load_tables_failed', { error: String(e) }))
    }
  }

  function handleRedisKeyPrompt(action: string, database: string, key: string) {
    if (action === "rename") {
      const newKey = window.prompt(t('sidebar.redis_rename_key'), key)
      if (newKey && newKey !== key) {
        runRedisAction("rename", database, key, [newKey])
      }
    } else if (action === "duplicate") {
      const newKey = window.prompt(t('sidebar.redis_duplicate_key'), `${key}_copy`)
      if (newKey && newKey !== key) {
        runRedisAction("duplicate", database, key, [newKey])
      }
    } else if (action === "expire") {
      const secs = window.prompt(t('sidebar.redis_set_ttl'), "300")
      const n = Number(secs)
      if (secs !== null && !Number.isNaN(n) && n > 0) {
        runRedisAction("expire", database, key, [String(Math.floor(n))])
      }
    } else if (action === "persist") {
      runRedisAction("persist", database, key, [])
    } else if (action === "delete") {
      if (window.confirm(t('sidebar.redis_delete_key'))) {
        runRedisAction("delete", database, key, [key])
      }
    }
  }

  async function runRedisAction(action: string, database: string, key: string, args: string[]) {
    if (!activeConnectionId) return
    const id = activeConnectionId
    const cmd = action === "rename"
      ? "RENAME"
      : action === "duplicate"
        ? "COPY"
        : action === "expire"
          ? "EXPIRE"
          : action === "persist"
            ? "PERSIST"
            : "DEL"
    try {
      if (action === "delete") {
        await invokeWithTimeout("redis_command", { id, database, command: "DEL", args: [key] })
      } else {
        await invokeWithTimeout("redis_command", { id, database, command: cmd, args: [key, ...args] })
      }
      const conn = connectionsRef.current.find((c) => c.id === id)
      if (conn?.config.type === "redis") {
        const cur = activeConnection?.config.database ? [currentDatabase || ""] : databases[id]?.map((d) => d.name) || []
        for (const db of cur) {
          const fullPattern = redisScanCursor[`${id}:${db}`] !== undefined ? "*" : null
          if (db) await redisScan(`${id}:${db}`, conn, db, fullPattern ?? "*", "")
        }
      }
    } catch (e: any) {
      setErrorBanner(t('dialog.failed', { error: String(e) }))
    }
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

  function pushHistory(sql: string) {
    const s = sql.trim()
    if (!s) return
    setSqlHistory((prev) => {
      const next = prev.filter((h) => h !== s)
      return [s, ...next].slice(0, 30)
    })
  }

  async function runSql(sql: string, opts?: { startLine?: number; plan?: boolean }) {
    if (!activeConnectionId) return
    const conn = connectionsRef.current.find((c) => c.id === activeConnectionId)
    const tabDbs = activeTab()?.database
    const tabDb = tabDbs ? tabDbs[activeConnectionId] : null
    const targetDb = tabDb ?? conn?.config.database ?? null
    if (
      conn && targetDb &&
      (conn.config.type === "mysql" || conn.config.type === "postgresql") &&
      backendDbRef.current !== targetDb
    ) {
      try {
        const password = await resolvePassword(conn)
        await invoke("switch_database", {
          id: conn.id,
          host: conn.config.host,
          port: conn.config.port,
          user: conn.config.user,
          password,
          database: targetDb,
          databaseType: conn.config.type,
        })
        backendDbRef.current = targetDb
      } catch (e: any) {
        setErrorBanner(t('app.connection_failed', { error: String(e) }))
        return
      }
    }
    setActiveBottomTab("results")
    setErrorMarker(null)
    const statements = splitSqlStatements(sql)
      .map((s) => s.text)
      .filter(Boolean)
    if (statements.length === 0) return
    const results: ExecResult[] = []
    const dbType = connDbType(activeConnectionId)
    setExecuting(true)
    try {
      for (let i = 0; i < statements.length; i++) {
        const title = opts?.plan
          ? t('resultpanel.plan', { n: i + 1 })
          : t('resultpanel.result', { n: i + 1 })
        try {
          const r: QueryResult = await invoke("execute_query", {
            id: activeConnectionId,
            query: statements[i],
          })
          results.push({ id: crypto.randomUUID(), title, isPlan: opts?.plan, ...r })
        } catch (e: any) {
          const err = String(e)
          results.push({
            id: crypto.randomUUID(),
            title,
            columns: [],
            rows: [],
            rowCount: 0,
            duration: "",
            error: err,
          })
          const relLine = parseErrorLine(err, dbType)
          if (relLine) {
            setErrorMarker({ line: (opts?.startLine || 1) + relLine - 1, message: err })
          }
          break
        }
      }
    } finally {
      setExecuting(false)
    }
    if (results.length > 0) {
      setQueryResults(results)
      pushHistory(sql)
    }
  }

  function handleExecute(sql: string, startLine?: number) {
    runSql(sql, { startLine })
  }

  function handleRunAll(sql: string) {
    runSql(sql, { startLine: 1 })
  }

  async function handleCancel() {
    if (!activeConnectionId) return
    try {
      await invoke("cancel_query", { id: activeConnectionId })
    } catch {}
  }

  async function handleBeginTransaction() {
    if (!activeConnectionId) return
    try {
      await invoke("begin_transaction", { id: activeConnectionId })
      setTxActive((prev) => ({ ...prev, [activeConnectionId!]: true }))
    } catch (e: any) {
      setQueryResults([
        {
          id: crypto.randomUUID(),
          title: t('resultpanel.result', { n: 1 }),
          columns: [],
          rows: [],
          rowCount: 0,
          duration: "",
          error: t('editor.tx_begin_failed') + ": " + String(e),
        },
      ])
    }
  }

  async function handleCommitTransaction() {
    if (!activeConnectionId) return
    try {
      await invoke("commit_transaction", { id: activeConnectionId })
      setTxActive((prev) => ({ ...prev, [activeConnectionId!]: false }))
    } catch (e: any) {
      setQueryResults([
        {
          id: crypto.randomUUID(),
          title: t('resultpanel.result', { n: 1 }),
          columns: [],
          rows: [],
          rowCount: 0,
          duration: "",
          error: t('editor.tx_commit_failed') + ": " + String(e),
        },
      ])
    }
  }

  async function handleRollbackTransaction() {
    if (!activeConnectionId) return
    try {
      await invoke("rollback_transaction", { id: activeConnectionId })
      setTxActive((prev) => ({ ...prev, [activeConnectionId!]: false }))
    } catch (e: any) {
      setQueryResults([
        {
          id: crypto.randomUUID(),
          title: t('resultpanel.result', { n: 1 }),
          columns: [],
          rows: [],
          rowCount: 0,
          duration: "",
          error: t('editor.tx_rollback_failed') + ": " + String(e),
        },
      ])
    }
  }

  function handleExplain(sql: string) {
    if (!activeConnectionId) return
    const planSql = buildExplainSql(connDbType(activeConnectionId), sql)
    if (!planSql) {
      setQueryResults([
        {
          id: crypto.randomUUID(),
          title: t('resultpanel.plan', { n: 1 }),
          columns: [],
          rows: [],
          rowCount: 0,
          duration: "",
          error: t('editor.explain_unsupported'),
        },
      ])
      return
    }
    runSql(planSql, { startLine: 1, plan: true })
  }

  function fileBasename(path: string): string {
    return path.split(/[\\/]/).pop() || path
  }

  async function handleSave() {
    const tab = activeTab()
    if (!tab) return
    let path = tab.filePath
    if (!path) {
      const res = await save({ defaultPath: "query.sql", filters: [{ name: "SQL", extensions: ["sql"] }] })
      if (!res) return
      path = res
    }
    try {
      await invoke("write_text_file", { path, content: tab.sql })
      setTabs((prev) =>
        prev.map((tb) =>
          tb.id === activeTabIdRef.current ? { ...tb, filePath: path, title: fileBasename(path) } : tb
        )
      )
    } catch (e: any) {
      setErrorBanner(String(e))
    }
  }

  async function handleOpen() {
    const res = await open({ multiple: false, filters: [{ name: "SQL", extensions: ["sql"] }] })
    if (!res) return
    try {
      const content = await invoke<string>("read_text_file", { path: res })
      const id = crypto.randomUUID()
      const connId = activeConnectionId
      setTabs((prev) => [...prev, {
        id,
        title: fileBasename(res),
        sql: content,
        filePath: res,
        browse: null,
        database: connId ? { [connId]: activeConnection?.config.database || null } : {},
      }])
      setActiveTabId(id)
    } catch (e: any) {
      setErrorBanner(String(e))
    }
  }

  function handleHistoryRun(sql: string) {
    setActiveTabSql(sql)
    runSql(sql, { startLine: 1 })
  }

  function handleToggleFavorite(sql: string) {
    setSqlFavorites((prev) =>
      prev.includes(sql) ? prev.filter((s) => s !== sql) : [sql, ...prev]
    )
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

  function handleOpenFind() {
    setFindDialogOpen(true)
  }

  function handleOpenFoundRow(table: string) {
    if (!activeConnection) return
    openTableTab(buildSelectPreview(table, activeConnection.config.type), activeConnection.id, currentDatabase || undefined, table)
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

  async function handleExportTable(database: string, table: string, format: "csv" | "json" | "insert") {
    if (!activeConnectionId) return
    const { invoke } = await import("@tauri-apps/api/core")
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { toCsv, toJson, toInsert } = await import("@/lib/sql")
    const { quoteIdent } = await import("@/lib/db")
    try {
      const dbType = connDbType(activeConnectionId) as DatabaseType
      const qualified = database ? quoteIdent(`${database}.${table}`, dbType) : quoteIdent(table, dbType)
      const result = await invoke<QueryResult>("execute_query", {
        id: activeConnectionId,
        query: `SELECT * FROM ${qualified}`,
      })
      if (result.error) throw new Error(result.error)
      if (!result.columns.length) return
      const ext = format === "csv" ? "csv" : format === "json" ? "json" : "sql"
      const defaultPath = `${table}_export_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.${ext}`
      const path = await save({ defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
      if (!path) return
      const content =
        format === "csv"
          ? toCsv(result.columns, result.rows)
          : format === "json"
            ? toJson(result.rows)
            : toInsert(table, result.columns, result.rows)
      await invoke("write_text_file", { path, content })
    } catch (e: any) {
      setErrorBanner(t('dialog.failed', { error: String(e) }))
    }
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

  function setActiveTabBrowse(browse: { connectionId: string; database: string; table: string } | null) {
    const id = activeTabIdRef.current || tabs[0]?.id
    if (!id) return
    setTabs((prev) => prev.map((tb) => (tb.id === id ? { ...tb, browse } : tb)))
  }

  function setActiveTabDatabase(database: string | null) {
    const id = activeTabIdRef.current || tabs[0]?.id
    const connId = activeConnectionId
    if (!id || !connId) return
    setTabs((prev) =>
      prev.map((tb) =>
        tb.id === id ? { ...tb, database: { ...(tb.database || {}), [connId]: database } } : tb
      )
    )
    backendDbRef.current = database
  }

  async function handleDatabaseChange(database: string) {
    const conn = connectionsRef.current.find((c) => c.id === activeConnectionId)
    if (!conn) return
    setActiveTabDatabase(database)
    try {
      const password = await resolvePassword(conn)
      await invoke("switch_database", {
        id: conn.id,
        host: conn.config.host,
        port: conn.config.port,
        user: conn.config.user,
        password,
        database,
        databaseType: conn.config.type,
      })
    } catch (e: any) {
      setErrorBanner(t('app.connection_failed', { error: String(e) }))
    }
  }

  function openTableTab(sql: string, connectionId: string, database?: string, table?: string) {
    if (!connectionId || !database || !table) return
    if (connectionId !== activeConnectionId) {
      handleSelectConnection(connectionId)
    }
    const existing = tabs.find((tb) => tb.browse?.connectionId === connectionId && tb.browse?.database === database && tb.browse?.table === table)
    if (existing) {
      setActiveTabId(existing.id)
      setActiveBottomTab("browse")
      return
    }
    const id = crypto.randomUUID()
    setTabs((prev) => [...prev, { id, title: table, sql, filePath: null, browse: { connectionId, database, table } }])
    setActiveTabId(id)
    setActiveBottomTab("browse")
  }

  function openInNewTab(sql: string) {
    const id = crypto.randomUUID()
    const n = tabs.length + 1
    const connId = activeConnectionId
    setTabs((prev) => [...prev, {
      id,
      title: t('editor.tab_query') + " " + n,
      sql,
      filePath: null,
      database: connId ? { [connId]: activeConnection?.config.database || null } : {},
    }])
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
        return [{ id: nid, title: t('editor.tab_query') + " 1", sql: "", filePath: null, database: {} }]
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
  const activeBrowse = activeTab()?.browse
  const tabDbs = activeTab()?.database
  const currentDatabase = (activeConnectionId && tabDbs ? tabDbs[activeConnectionId] : undefined) ?? activeConnection?.config.database ?? null
  const connectionMeta = activeConnection?.config && activeConnection.config.type !== "sqlite"
    ? `${activeConnection.config.user || ""}@${activeConnection.config.host || ""}:${activeConnection.config.port ?? ""}`
    : null
  const currentTables = (activeConnectionId && tables[activeConnectionId] && currentDatabase)
    ? tables[activeConnectionId][currentDatabase] || []
    : []
  const lastExec = queryResults.length > 0
    ? {
        duration: queryResults[queryResults.length - 1].duration || "0ms",
        count: queryResults.reduce((s, r) => s + r.rowCount, 0),
      }
    : null

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
        connectionMeta={connectionMeta}
        dbType={activeConnection?.config.type || undefined}
        onOpenErDiagram={handleOpenErDiagram}
        onOpenImport={handleOpenImport}
        onOpenTransfer={handleOpenTransfer}
        onOpenCompare={handleOpenCompare}
        onOpenBackup={handleOpenBackup}
        onOpenRestore={handleOpenRestore}
        onOpenSchedule={handleOpenSchedule}
        onOpenFind={handleOpenFind}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          connections={connections}
          activeConnectionId={activeConnectionId}
          onSelectConnection={(id) => handleSelectConnection(id, true)}
          onDisconnect={handleDisconnect}
          onRefresh={handleRefresh}
          onEditConnection={handleEditConnection}
          onDuplicateConnection={handleDuplicateConnection}
          onDeleteConnection={handleDeleteConnection}
          onLoadTables={handleLoadTables}
          onDatabaseClick={handleDatabaseClick}
          onTableClick={(sql, connectionId, database, table) => {
            openTableTab(sql, connectionId, database, table)
          }}
          onInsertSql={(sql) => openInNewTab(sql)}
          databases={databases}
          schemas={schemas}
          tables={tables}
          loading={loading}
          onNewTable={handleNewTable}
          onNewDatabase={handleNewDatabase}
          onDuplicateDatabase={handleDuplicateDatabase}
          onDesignTable={handleDesignTable}
          onExportTable={handleExportTable}
          onDropObject={handleDropObject}
          onTruncateTable={handleTruncate}
          onRenameTable={handleRename}
          onNewObject={handleNewObject}
          redisScanCursor={redisScanCursor}
          onRedisSearch={handleRedisSearch}
          onRedisLoadMore={handleRedisLoadMore}
          onRedisKeyAction={handleRedisKeyPrompt}
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
                <div className="flex items-center border-b bg-muted/30">
                  {tabOverflow && (
                    <button
                      className="h-7 w-6 flex items-center justify-center shrink-0 text-muted-foreground hover:bg-background/60"
                      onClick={() => scrollTabs(-1)}
                      title={t('editor.scroll_tabs_left')}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  )}
                  <div ref={tabBarRef} className="flex-1 flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {tabs.map((tb) => (
                      <div
                        key={tb.id}
                        ref={(el) => {
                          if (el) tabRefs.current.set(tb.id, el)
                          else tabRefs.current.delete(tb.id)
                        }}
                        className={cn(
                          "flex items-center gap-1 pl-3 pr-2 py-1.5 text-xs border-r cursor-pointer w-[170px] shrink-0 overflow-hidden",
                          tb.id === (activeTabId || tabs[0]?.id)
                            ? "bg-background text-foreground font-medium"
                            : "text-muted-foreground hover:bg-background/60",
                        )}
                        onClick={() => {
                          if (tb.browse?.connectionId && tb.browse.connectionId !== activeConnectionId) {
                            handleSelectConnection(tb.browse.connectionId)
                          }
                          setActiveTabId(tb.id)
                        }}
                        title={tb.title}
                      >
                        <span className="flex-1 truncate">{tb.title}</span>
                        <button
                          className="ml-1 h-4 w-4 flex items-center justify-center rounded hover:bg-muted-foreground/20 shrink-0"
                          onClick={(e) => { e.stopPropagation(); closeTab(tb.id) }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {tabOverflow && (
                    <button
                      className="h-7 w-6 flex items-center justify-center shrink-0 text-muted-foreground hover:bg-background/60"
                      onClick={() => scrollTabs(1)}
                      title={t('editor.scroll_tabs_right')}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-7 w-7 flex items-center justify-center shrink-0 text-muted-foreground hover:bg-background/60"
                        title={t('editor.list_tabs')}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                      {tabs.map((tb) => (
                        <DropdownMenuItem
                          key={tb.id}
                          onClick={() => {
                            if (tb.browse?.connectionId && tb.browse.connectionId !== activeConnectionId) {
                              handleSelectConnection(tb.browse.connectionId)
                            }
                            setActiveTabId(tb.id)
                          }}
                          className={cn(
                            "truncate",
                            tb.id === (activeTabId || tabs[0]?.id) && "bg-accent font-medium",
                          )}
                        >
                          {tb.title}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {activeBrowse?.table && activeBrowse?.connectionId === activeConnectionId ? (
                  <div className="flex-1 min-h-0">
                    <TableBrowser
                      connectionId={activeBrowse.connectionId}
                      database={activeBrowse.database}
                      table={activeBrowse.table}
                      dbType={activeConnection!.config.type}
                      embedded
                      onClose={() => closeTab(activeTabId)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-h-0 border-b">
                      <SqlEditor
                        onExecute={(sql, startLine) => handleExecute(sql, startLine)}
                        onRunAll={handleRunAll}
                        onExplain={handleExplain}
                        onCancel={handleCancel}
                        onSave={handleSave}
                        onOpen={handleOpen}
                        onHistoryRun={handleHistoryRun}
                        onToggleFavorite={handleToggleFavorite}
                        favorites={sqlFavorites}
                        onNewTab={newTab}
                        onBeginTransaction={handleBeginTransaction}
                        onCommitTransaction={handleCommitTransaction}
                        onRollbackTransaction={handleRollbackTransaction}
                        txActive={activeConnectionId ? !!txActive[activeConnectionId] : false}
                        executing={executing}
                        lastExec={lastExec}
                        value={activeTab()?.sql || ""}
                        onChange={setActiveTabSql}
                        connectionId={activeConnectionId}
                        currentDatabase={currentDatabase}
                        databases={databases[activeConnectionId || ""] || []}
                        onChangeDatabase={handleDatabaseChange}
                        dbType={connDbType(activeConnectionId)}
                        history={sqlHistory}
                        errorMarker={errorMarker}
                      />
                    </div>
                    <ResizeHandle
                      orientation="horizontal"
                      onDragStart={() => { bottomPanelStartHeight.current = bottomPanelHeight }}
                      onDelta={(delta) => {
                        setBottomPanelHeight(() =>
                          Math.min(
                            Math.max(bottomPanelStartHeight.current - delta, BOTTOM_PANEL_MIN),
                            Math.round(window.innerHeight * 0.8)
                          )
                        )
                      }}
                      className="-mb-1 -mt-1"
                    />
                    <div className="min-h-0 flex flex-col" style={{ height: bottomPanelHeight }}>
                      {activeBottomTab === "browse" && activeBrowse?.table && activeBrowse?.connectionId === activeConnectionId ? (
                        <TableBrowser
                          connectionId={activeBrowse.connectionId}
                          database={activeBrowse.database}
                          table={activeBrowse.table}
                          dbType={activeConnection!.config.type}
                          onClose={() => { setActiveTabBrowse(null); setActiveBottomTab("results") }}
                        />
                      ) : (
                        <ResultPanel results={queryResults} />
                      )}
                    </div>
                  </>
                )}
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
      <FindInTablesDialog
        open={findDialogOpen}
        onOpenChange={setFindDialogOpen}
        connectionId={activeConnectionId}
        database={currentDatabase}
        onOpenRow={handleOpenFoundRow}
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
          dbType={connDbType(duplicateDb.connectionId)}
          connConfig={connections.find((c) => c.id === duplicateDb.connectionId)?.config}
          onCreated={() => handleRefresh(duplicateDb.connectionId)}
          onDone={() => setDuplicateDb(null)}
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
