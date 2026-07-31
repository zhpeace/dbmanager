import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ChevronDown,
  ChevronRight,
  Database,
  Table,
  Eye,
  Layers,
  Unplug,
  Loader2,
  Box,
  Copy,
  ExternalLink,
  PenLine,
  Trash2,
  RefreshCw,
  Pencil,
  CopyPlus,
  Plug,
  PlugZap,
  FunctionSquare,
  Zap,
  Workflow,
  Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import type { Connection, DatabaseInfo, TableInfo } from "@/lib/db"
import { DB_DISPLAY_NAMES } from "@/lib/db"

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  TABLE: Table,
  VIEW: Eye,
  "BASE TABLE": Table,
  FUNCTION: FunctionSquare,
  PROCEDURE: Workflow,
  TRIGGER: Zap,
  COLLECTION: Layers,
  default: Box,
}

const TYPE_COLORS: Record<string, string> = {
  TABLE: "text-blue-400",
  VIEW: "text-emerald-400",
  "BASE TABLE": "text-blue-400",
  FUNCTION: "text-purple-400",
  PROCEDURE: "text-orange-400",
  TRIGGER: "text-pink-400",
  COLLECTION: "text-green-400",
}

function getTypeLabel(t: (key: string) => string, type: string): string {
  switch (type) {
    case "TABLE": case "BASE TABLE": return t('sidebar.group_tables')
    case "VIEW": return t('sidebar.group_views')
    case "FUNCTION": return t('sidebar.group_functions')
    case "PROCEDURE": return t('sidebar.group_procedures')
    case "TRIGGER": return t('sidebar.group_triggers')
    case "COLLECTION": return t('sidebar.group_collections')
    default: return t('sidebar.group_other')
  }
}

interface SidebarProps {
  connections: Connection[]
  activeConnectionId: string | null
  onSelectConnection: (id: string) => void
  onDisconnect: (id: string) => void
  onRefresh: (id: string) => void
  onEditConnection: (id: string) => void
  onDuplicateConnection: (id: string) => void
  onDeleteConnection: (id: string) => void
  onLoadTables: (id: string, database: string) => void
  onTableClick: (sql: string, database?: string, table?: string) => void
  onDatabaseClick: (database: string) => void
  onInsertSql: (sql: string) => void
  databases: Record<string, DatabaseInfo[]>
  tables: Record<string, Record<string, TableInfo[]>>
  loading: Record<string, boolean>
  onNewTable: (database: string) => void
  onNewDatabase: (connectionId: string) => void
  onDuplicateDatabase: (connectionId: string, database: string) => void
  onDesignTable: (database: string, table: string) => void
  onDropObject: (type: string, name: string, database: string) => void
  onTruncateTable: (database: string, table: string) => void
  onRenameTable: (database: string, table: string) => void
  onNewObject: (type: string, database: string) => void
}

export function Sidebar({
  connections,
  activeConnectionId,
  onSelectConnection,
  onDisconnect,
  onRefresh,
  onEditConnection,
  onDuplicateConnection,
  onDeleteConnection,
  onLoadTables,
  onTableClick,
  onDatabaseClick,
  onInsertSql,
  databases,
  tables,
  loading,
  onNewTable,
  onNewDatabase,
  onDuplicateDatabase,
  onDesignTable,
  onDropObject,
  onTruncateTable,
  onRenameTable,
  onNewObject,
}: SidebarProps) {
  const { t } = useTranslation()
  return (
    <aside className="flex w-60 flex-col border-r bg-sidebar">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('sidebar.connections')}</span>
        <span className="text-xs text-muted-foreground">{connections.length}</span>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {connections.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Database className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">{t('sidebar.no_connections')}</p>
              <p className="text-xs text-muted-foreground/60">{t('sidebar.no_connections_hint')}</p>
            </div>
          )}
          {connections.map((conn) => (
            <ConnectionItem
              key={conn.id}
              connection={conn}
              isActive={conn.id === activeConnectionId}
              onSelect={() => onSelectConnection(conn.id)}
              onDisconnect={() => onDisconnect(conn.id)}
               onRefresh={() => onRefresh(conn.id)}
               onEditConnection={() => onEditConnection(conn.id)}
               onDuplicateConnection={() => onDuplicateConnection(conn.id)}
               onDeleteConnection={() => onDeleteConnection(conn.id)}
                onLoadTables={(db) => onLoadTables(conn.id, db)}
                 onTableClick={(sql, db, table) => onTableClick(sql, db, table)}
                 onDatabaseClick={(db) => onDatabaseClick(db)}
                onInsertSql={(sql) => onInsertSql(sql)}
                 onNewTable={(db) => onNewTable(db)}
                 onNewDatabase={(connId) => onNewDatabase(connId)}
                onDuplicateDatabase={(connId, db) => onDuplicateDatabase(connId, db)}
                onDesignTable={(db, tbl) => onDesignTable(db, tbl)}
               onDropObject={(type, name, db) => onDropObject(type, name, db)}
               onTruncateTable={(db, tbl) => onTruncateTable(db, tbl)}
               onRenameTable={(db, tbl) => onRenameTable(db, tbl)}
               onNewObject={(type, db) => onNewObject(type, db)}
              databases={databases[conn.id] || []}
              tables={tables[conn.id] || {}}
              isLoading={loading[conn.id] || false}
              tableLoading={loading}
              connId={conn.id}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

function ConnectionItem({
  connection,
  isActive,
  onSelect,
  onDisconnect,
  onRefresh,
  onEditConnection,
  onDuplicateConnection,
  onDeleteConnection,
  onLoadTables,
  onTableClick,
  onDatabaseClick,
  onInsertSql,
  databases,
  tables,
  isLoading,
  tableLoading,
  connId,
  onNewTable,
  onNewDatabase,
  onDuplicateDatabase,
  onDesignTable,
  onDropObject,
  onTruncateTable,
  onRenameTable,
  onNewObject,
}: {
  connection: Connection
  isActive: boolean
  onSelect: () => void
  onDisconnect: () => void
  onRefresh: () => void
  onEditConnection: () => void
  onDuplicateConnection: () => void
  onDeleteConnection: () => void
  onLoadTables: (database: string) => void
  onTableClick: (sql: string, database?: string, table?: string) => void
  onDatabaseClick: (database: string) => void
  onInsertSql: (sql: string) => void
  databases: DatabaseInfo[]
  tables: Record<string, TableInfo[]>
  isLoading: boolean
  tableLoading: Record<string, boolean>
  connId: string
  onNewTable: (database: string) => void
  onNewDatabase: (connectionId: string) => void
  onDuplicateDatabase: (connectionId: string, database: string) => void
  onDesignTable: (database: string, table: string) => void
  onDropObject: (type: string, name: string, database: string) => void
  onTruncateTable: (database: string, table: string) => void
  onRenameTable: (database: string, table: string) => void
  onNewObject: (type: string, database: string) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set())
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())

  function toggleDb(dbName: string) {
    setExpandedDbs((prev) => {
      const next = new Set(prev)
      if (next.has(dbName)) {
        next.delete(dbName)
      } else {
        next.add(dbName)
      }
      return next
    })
    // Selecting a database name switches the active database immediately.
    onDatabaseClick(dbName)
    if (!expandedDbs.has(dbName) && !tables[dbName] && !tableLoading[`${connId}:${dbName}`]) {
      onLoadTables(dbName)
    }
  }

  function groupByType(objects: TableInfo[]): [string, TableInfo[]][] {
    const groups = new Map<string, TableInfo[]>()
    const order = ["TABLE", "BASE TABLE", "VIEW", "FUNCTION", "PROCEDURE", "TRIGGER", "COLLECTION"]
    for (const obj of objects) {
      const key = obj.object_type.toUpperCase()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(obj)
    }
    const result: [string, TableInfo[]][] = []
    for (const key of order) {
      if (groups.has(key)) result.push([key, groups.get(key)!])
    }
    for (const [key, value] of groups) {
      if (!order.includes(key)) result.push([key, value])
    }
    return result
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer group",
              isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"
            )}
            onClick={() => {
              setExpanded(!expanded)
              onSelect()
            }}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : connection.connected ? (
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")} />
            ) : (
              <span className="w-3.5" />
            )}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <div className={cn(
                "h-2 w-2 rounded-full shrink-0",
                isLoading ? "bg-yellow-400" : connection.connected ? "bg-green-500" : "bg-gray-400"
              )} />
              <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{connection.config.name}</span>
            </div>
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
              {DB_DISPLAY_NAMES[connection.config.type]}
            </Badge>
            {connection.connected && (
              <div className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRefresh}>
                  <Loader2 className={cn("h-3 w-3", isLoading && "animate-spin")} />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={onDisconnect}>
                  <Unplug className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {connection.connected ? (
            <ContextMenuItem onClick={onDisconnect}>
              <PlugZap className="h-3 w-3 mr-2" />
              {t('sidebar.disconnect')}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={onSelect}>
              <Plug className="h-3 w-3 mr-2" />
              {t('sidebar.connect')}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onEditConnection}>
            <Pencil className="h-3 w-3 mr-2" />
            {t('sidebar.edit_connection')}
          </ContextMenuItem>
          <ContextMenuItem onClick={onDuplicateConnection}>
            <CopyPlus className="h-3 w-3 mr-2" />
            {t('sidebar.duplicate_connection')}
          </ContextMenuItem>
          <ContextMenuItem onClick={onDeleteConnection} className="text-destructive">
            <Trash2 className="h-3 w-3 mr-2" />
            {t('sidebar.delete_connection')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRefresh}>
            <RefreshCw className="h-3 w-3 mr-2" />
            {t('sidebar.refresh')}
          </ContextMenuItem>
          {["mysql", "postgresql", "mongo", "oracle"].includes(connection.config.type) && (
          <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onNewDatabase(connId)}>
            <Database className="h-3 w-3 mr-2" />
            {t('sidebar.new_database')}
          </ContextMenuItem>
          </>
          )}
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(connection.config.name)}>
            <Copy className="h-3 w-3 mr-2" />
            {t('sidebar.copy_name')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {connection.connected && expanded && (
        <div className="ml-4 mt-1 space-y-0.5">
          {databases.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground px-2 py-1">{t('sidebar.no_databases')}</p>
          )}
          {isLoading && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('sidebar.loading')}
            </div>
          )}
          {databases.map((db) => {
            const dbTables = tables[db.name]
            const dbLoading = tableLoading[`${connId}:${db.name}`]
            const isDbExpanded = expandedDbs.has(db.name)

            return (
              <div key={db.name}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn(
                        "flex items-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer hover:bg-sidebar-accent/50",
                        isDbExpanded && "bg-sidebar-accent/30"
                      )}
                      onClick={() => toggleDb(db.name)}
                    >
                      {dbLoading ? (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      ) : isDbExpanded ? (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      )}
                      <Database className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="truncate">{db.name}</span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => onNewTable(db.name)}>
                      <Table className="h-3 w-3 mr-2" />
                      {t('sidebar.new_table')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => { if (!tables[db.name]) onLoadTables(db.name); toggleDb(db.name) }}>
                      <RefreshCw className="h-3 w-3 mr-2" />
                      {t('sidebar.refresh')}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => onInsertSql(`USE \`${db.name}\`;`)}>
                      <PenLine className="h-3 w-3 mr-2" />
                      {t('sidebar.open_in_editor')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => navigator.clipboard.writeText(db.name)}>
                      <Copy className="h-3 w-3 mr-2" />
                      {t('sidebar.copy_name')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {["mysql", "postgresql", "mongo", "oracle"].includes(connection.config.type) && (
                    <ContextMenuItem onClick={() => onDropObject("DATABASE", db.name, db.name)} className="text-destructive">
                      <Trash2 className="h-3 w-3 mr-2" />
                      {t('sidebar.drop_database')}
                    </ContextMenuItem>
                    )}
                    {["mysql", "postgresql", "mongo", "oracle"].includes(connection.config.type) && (
                    <ContextMenuItem onClick={() => onDuplicateDatabase(connId, db.name)}>
                      <Copy className="h-3 w-3 mr-2" />
                      {t('sidebar.duplicate_database')}
                    </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
                {isDbExpanded && dbTables && (
                  <div className="ml-3 mt-0.5 space-y-0">
                    {groupByType(dbTables).map(([type, objects]) => {
                      const Icon = TYPE_ICONS[type] || TYPE_ICONS.default
                      const color = TYPE_COLORS[type] || "text-muted-foreground"
                      const label = getTypeLabel(t, type)
                      const isCollapsed = collapsedTypes.has(`${db.name}:${type}`)

                      const toggleType = (e: React.MouseEvent) => {
                        e.stopPropagation()
                        setCollapsedTypes((prev) => {
                          const next = new Set(prev)
                          const key = `${db.name}:${type}`
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }

                      return (
                        <div key={type} className="mb-1">
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <div
                                className="flex items-center gap-1 px-2 py-1 rounded bg-sidebar-accent/40 cursor-pointer sticky top-0 z-10"
                                onClick={toggleType}
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                                )}
                                <Icon className={cn("h-3 w-3 shrink-0", color)} />
                                <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wide">
                                  {label}
                                </span>
                                <span className="text-[10px] text-muted-foreground/60">({objects.length})</span>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => {
                                if (type === "TABLE" || type === "BASE TABLE") onNewTable(db.name)
                                else onNewObject(type, db.name)
                              }}>
                                <Plus className="h-3 w-3 mr-2" />
                                {t('sidebar.new_object', { type: label })}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                          {!isCollapsed && (
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border/50 pl-1">
                              {objects.map((obj) => {
                                const q = (s: string) => s.includes(" ") ? `\`${s}\`` : s
                                const qualified = obj.schema ? `${q(obj.schema)}.${q(obj.name)}` : q(obj.name)
                                const isRoutine = obj.object_type === "FUNCTION" || obj.object_type === "PROCEDURE" || obj.object_type === "TRIGGER"
                                let defSql = ""
                                if (isRoutine) {
                                  const dbType = connection.config.type
                                  const owner = obj.schema ? q(obj.schema) : ""
                                  if (dbType === "mysql") {
                                    if (obj.object_type === "TRIGGER") defSql = `SHOW CREATE TRIGGER ${qualified};`
                                    else defSql = `SHOW CREATE ${obj.object_type} ${qualified};`
                                  } else if (dbType === "oracle") {
                                    defSql = `SELECT TEXT FROM ALL_SOURCE WHERE OWNER = ${owner} AND NAME = '${obj.name.toUpperCase()}' ORDER BY LINE;`
                                  } else if (dbType === "postgresql") {
                                    if (obj.object_type === "TRIGGER") defSql = `SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = '${obj.name}';`
                                    else defSql = `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = '${obj.name}';`
                                  } else if (dbType === "sqlite") {
                                    defSql = `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = '${obj.name}';`
                                  }
                                }
                                return (
                                <ContextMenu key={obj.name}>
                                  <ContextMenuTrigger asChild>
                                    <div
                                      className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs cursor-pointer hover:bg-sidebar-accent/50"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (isRoutine && defSql) onInsertSql(defSql)
                                        else onTableClick(`SELECT * FROM ${q(obj.name)} LIMIT 100`, db.name, obj.name)
                                      }}
                                    >
                                      <Icon className={cn("h-3 w-3 shrink-0", color)} />
                                      <span className="truncate">{obj.name}</span>
                                    </div>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent>
                                    {obj.object_type === "TABLE" || obj.object_type === "BASE TABLE" ? (
                                      <>
                                        <ContextMenuItem onClick={() => onDesignTable(db.name, obj.name)}>
                                          <Pencil className="h-3 w-3 mr-2" />
                                          {t('sidebar.design_table')}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => onTableClick(`SELECT * FROM ${q(obj.name)} LIMIT 100`, db.name, obj.name)}>
                                          <ExternalLink className="h-3 w-3 mr-2" />
                                          {t('sidebar.browse_data')}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => onInsertSql(`SELECT * FROM ${q(obj.name)} LIMIT 100`)}>
                                          <PenLine className="h-3 w-3 mr-2" />
                                          {t('sidebar.open_in_editor')}
                                        </ContextMenuItem>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem onClick={() => onTruncateTable(db.name, obj.name)}>
                                          <Trash2 className="h-3 w-3 mr-2" />
                                          {t('sidebar.truncate_table')}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => onRenameTable(db.name, obj.name)}>
                                          <Pencil className="h-3 w-3 mr-2" />
                                          {t('sidebar.rename_table')}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          className="text-destructive"
                                          onClick={() => onDropObject("TABLE", obj.name, db.name)}
                                        >
                                          <Trash2 className="h-3 w-3 mr-2" />
                                          {t('sidebar.drop_table')}
                                        </ContextMenuItem>
                                      </>
                                    ) : isRoutine ? (
                                      <>
                                        <ContextMenuItem onClick={() => defSql && onInsertSql(defSql)}>
                                          <PenLine className="h-3 w-3 mr-2" />
                                          {t('sidebar.view_definition')}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => onNewObject(obj.object_type, db.name)}>
                                          <Plus className="h-3 w-3 mr-2" />
                                          {t('sidebar.new_object', { type: obj.object_type })}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          className="text-destructive"
                                          onClick={() => onDropObject(obj.object_type, obj.name, db.name)}
                                        >
                                          <Trash2 className="h-3 w-3 mr-2" />
                                          {t('sidebar.drop_' + obj.object_type.toLowerCase())}
                                        </ContextMenuItem>
                                      </>
                                    ) : (
                                      <>
                                        <ContextMenuItem onClick={() => onTableClick(`SELECT * FROM ${q(obj.name)} LIMIT 100`, db.name, obj.name)}>
                                          <ExternalLink className="h-3 w-3 mr-2" />
                                          {t('sidebar.browse_data')}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          className="text-destructive"
                                          onClick={() => onDropObject(obj.object_type, obj.name, db.name)}
                                        >
                                          <Trash2 className="h-3 w-3 mr-2" />
                                          {t('sidebar.drop_view')}
                                        </ContextMenuItem>
                                      </>
                                    )}
                                    <ContextMenuSeparator />
                                    <ContextMenuItem onClick={() => navigator.clipboard.writeText(obj.name)}>
                                      <Copy className="h-3 w-3 mr-2" />
                                      {t('sidebar.copy_name')}
                                    </ContextMenuItem>
                                    <ContextMenuItem onClick={() => navigator.clipboard.writeText(qualified)}>
                                      <Copy className="h-3 w-3 mr-2" />
                                      {t('sidebar.copy_qualified_name')}
                                    </ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {dbTables.length === 0 && (
                      <p className="text-xs text-muted-foreground px-2 py-0.5">{t('sidebar.no_objects')}</p>
                    )}
                  </div>
                )}
                {isDbExpanded && dbLoading && (
                  <div className="ml-4 flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('sidebar.loading')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
