import { invoke } from "@tauri-apps/api/core"

export interface ConnectionConfig {
  id: string
  name: string
  type: 'mysql' | 'postgresql' | 'sqlite' | 'mongodb' | 'oracle' | 'redis' | 'dameng'
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  schema?: string
  filePath?: string
  color?: string
  ssh?: SshConfig
  ssl?: SslConfig
}

export interface SshConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  authType: 'password' | 'key'
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface SslConfig {
  enabled: boolean
  mode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'
  caPath?: string
  certPath?: string
  keyPath?: string
}

export interface ForeignKeyInfo {
  column_name: string
  ref_table: string
  ref_column: string
  constraint_name?: string
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  index_type: string
}

export interface ViewInfo {
  name: string
  definition: string
}

export interface RoutineInfo {
  name: string
  routine_type: string
  definition: string
}

export interface TriggerInfo {
  name: string
  table: string
  definition: string
}

export interface TableSchemaInfo {
  table: string
  columns: {
    name: string
    data_type: string
    nullable: boolean
    key: string
    default_value: string | null
    extra: string
  }[]
  foreign_keys: ForeignKeyInfo[]
  indexes: IndexInfo[]
  views: ViewInfo[]
  routines: RoutineInfo[]
  triggers: TriggerInfo[]
}

export interface DatabaseInfo {
  name: string
}

export interface TableInfo {
  name: string
  object_type: string
  schema?: string
  size_bytes?: number
  row_count?: number
  ttl?: number
}

export interface ColumnInfo {
  name: string
  data_type: string
  nullable: boolean
  key: string
  default_value: string | null
  extra: string
}

export interface TableData {
  columns: {
    name: string
    data_type: string
    nullable: boolean
    key: string
    default_value: string | null
    extra: string
  }[]
  rows: Record<string, unknown>[]
  total: number
  duration: string
  primary_keys: string[]
  row_handles: Record<string, unknown>[]
}

export interface ColumnMapping {
  source_column: string
  target_column: string
  skip: boolean
  default_value: unknown | null
}

export interface TransferOptions {
  source_id: string
  source_database: string
  target_id: string
  target_database: string
  tables: string[]
  mode?: 'structure_and_data' | 'structure_only' | 'data_only'
  conflict_strategy?: 'error' | 'ignore' | 'replace'
  drop_target?: boolean
  truncate_target?: boolean
  where_clause?: string | null
  row_limit?: number | null
  page_size?: number
  parallelism?: number
  transfer_indexes?: boolean
  transfer_foreign_keys?: boolean
  transfer_views?: boolean
  transfer_routines?: boolean
  transfer_triggers?: boolean
  foreign_key_action?: 'preserve' | 'disable' | 'skip'
  column_mappings?: ColumnMapping[]
  checkpoint_id?: string | null
  error_mode?: 'skip' | 'stop' | 'skip_table'
}

export interface TransferStat {
  table: string
  rows: number
  size_bytes: number
  duration_ms: number
  status: string
  error?: string | null
}

export interface TransferResult {
  tables_transferred: string[]
  rows_transferred: number
  errors: string[]
  duration: string
  logs: string[]
  table_stats?: TransferStat[]
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  duration: string
  error?: string
}

export interface ExecResult extends QueryResult {
  id: string
  title: string
  isPlan?: boolean
}

export const COMMON_TYPES = [
  "INT",
  "BIGINT",
  "VARCHAR(255)",
  "TEXT",
  "DECIMAL(10,2)",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "BLOB",
]

export interface ColumnDef {
  name: string
  data_type: string
  nullable: boolean
  primary_key: boolean
  default_value?: string | null
}

export async function createTable(
  id: string,
  database: string,
  table: string,
  columns: ColumnDef[],
): Promise<QueryResult> {
  return invoke<QueryResult>("create_table", { id, database, table, columns })
}

export async function createDatabase(id: string, dbName: string): Promise<void> {
  return invoke("create_database", { id, dbName })
}

export async function dropDatabase(id: string, dbName: string): Promise<void> {
  return invoke("drop_database", { id, dbName })
}

export async function duplicateDatabase(
  id: string,
  sourceDb: string,
  targetDb: string,
  conn?: { host?: string; port?: number; user?: string; password?: string }
): Promise<TransferResult> {
  const payload: Record<string, unknown> = { id, sourceDb, targetDb }
  if (conn) {
    if (conn.host) payload.host = conn.host
    if (conn.port) payload.port = conn.port
    if (conn.user) payload.user = conn.user
    if (conn.password) payload.password = conn.password
  }
  return invoke("duplicate_database", payload)
}

export async function dropTable(id: string, database: string, schema: string | undefined, table: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_table", { id, database, schema, table })
}

export async function truncateTable(id: string, database: string, schema: string | undefined, table: string): Promise<QueryResult> {
  return invoke<QueryResult>("truncate_table", { id, database, schema, table })
}

export async function renameTable(id: string, database: string, schema: string | undefined, table: string, newName: string): Promise<QueryResult> {
  return invoke<QueryResult>("rename_table", { id, database, schema, table, newName })
}

export async function alterAddColumn(id: string, database: string, table: string, column: ColumnDef): Promise<QueryResult> {
  return invoke<QueryResult>("alter_table_add_column", { id, database, table, column })
}

export async function alterDropColumn(id: string, database: string, table: string, column: string): Promise<QueryResult> {
  return invoke<QueryResult>("alter_table_drop_column", { id, database, table, column })
}

export async function alterModifyColumn(id: string, database: string, table: string, column: ColumnDef): Promise<QueryResult> {
  return invoke<QueryResult>("alter_table_modify_column", { id, database, table, column })
}

export async function alterRenameColumn(id: string, database: string, table: string, column: string, newName: string): Promise<QueryResult> {
  return invoke<QueryResult>("alter_table_rename_column", { id, database, table, column, newName })
}

export async function dropView(id: string, database: string, schema: string | undefined, view: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_view", { id, database, schema, view })
}

export async function dropRoutine(id: string, database: string, schema: string | undefined, routine: string, routineType: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_routine", { id, database, schema, routine, routineType })
}

export async function dropTrigger(id: string, database: string, schema: string | undefined, trigger: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_trigger", { id, database, schema, trigger })
}

export interface IndexDef {
  name: string
  columns: string[]
  unique: boolean
}

export async function createIndex(
  id: string,
  database: string,
  table: string,
  name: string,
  columns: string[],
  unique: boolean
): Promise<QueryResult> {
  return invoke<QueryResult>("create_index", { id, database, table, name, columns, unique })
}

export async function dropIndex(id: string, database: string, table: string, name: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_index", { id, database, table, name })
}

export interface ForeignKeyDef {
  name: string
  column: string
  ref_table: string
  ref_column: string
}

export async function addForeignKey(
  id: string,
  database: string,
  table: string,
  name: string,
  column: string,
  refTable: string,
  refColumn: string
): Promise<QueryResult> {
  return invoke<QueryResult>("add_foreign_key", { id, database, table, name, column, refTable, refColumn })
}

export async function dropForeignKey(id: string, database: string, table: string, name: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_foreign_key", { id, database, table, name })
}

export interface SchemaCache {
  tables: {
    table: string
    columns: {
      name: string
      data_type: string
      nullable: boolean
      key: string
      default_value: string | null
      extra: string
    }[]
    primary_keys: string[]
    foreign_keys: { column_name: string; ref_table: string; ref_column: string; constraint_name?: string }[]
    indexes: IndexInfo[]
    views: ViewInfo[]
    routines: RoutineInfo[]
    triggers: TriggerInfo[]
  }[]
  views: ViewInfo[]
  routines: RoutineInfo[]
  triggers: TriggerInfo[]
}

export async function getSchemaCache(id: string, database: string): Promise<SchemaCache> {
  return invoke<SchemaCache>("get_schema_cache", { id, database })
}

export async function getSchemas(id: string): Promise<DatabaseInfo[]> {
  return invoke<DatabaseInfo[]>("get_schemas", { id })
}

export interface FindMatch {
  table: string
  column: string
  value: string
  row: Record<string, unknown>
}

export async function findInTables(
  id: string,
  database: string,
  search: string,
  maxTables?: number,
  perTableLimit?: number,
): Promise<FindMatch[]> {
  return invoke<FindMatch[]>("find_in_tables", { id, database, search, maxTables, perTableLimit })
}

export async function beginTransaction(id: string): Promise<void> {
  return invoke("begin_transaction", { id })
}

export async function commitTransaction(id: string): Promise<void> {
  return invoke("commit_transaction", { id })
}

export async function rollbackTransaction(id: string): Promise<void> {
  return invoke("rollback_transaction", { id })
}

export async function transactionStatus(id: string): Promise<boolean> {
  return invoke<boolean>("transaction_status", { id })
}

export function createObjectTemplate(
  dbType: string,
  objectType: string,
  name: string,
): string {
  const q = (s: string) => (s.includes(" ") ? `\`${s}\`` : s)
  const n = q(name || "new_object")
  switch (objectType) {
    case "VIEW":
      if (dbType === "oracle") return `CREATE OR REPLACE VIEW ${n} AS\nSELECT 1 AS col1 FROM dual;`
      if (dbType === "postgresql") return `CREATE OR REPLACE VIEW ${n} AS\nSELECT 1 AS col1;`
      return `CREATE OR REPLACE VIEW ${n} AS\nSELECT 1 AS col1;`
    case "FUNCTION":
      if (dbType === "mysql") return `CREATE FUNCTION ${n}()\nRETURNS INT\nBEGIN\n  RETURN 1;\nEND;`
      if (dbType === "oracle") return `CREATE OR REPLACE FUNCTION ${n} RETURN NUMBER AS\nBEGIN\n  RETURN 1;\nEND;`
      if (dbType === "postgresql") return `CREATE OR REPLACE FUNCTION ${n}()\nRETURNS integer AS $$\nBEGIN\n  RETURN 1;\nEND;\n$$ LANGUAGE plpgsql;`
      return `CREATE FUNCTION ${n}() BEGIN RETURN 1; END;`
    case "PROCEDURE":
      if (dbType === "mysql") return `CREATE PROCEDURE ${n}()\nBEGIN\n  -- statements\nEND;`
      if (dbType === "oracle") return `CREATE OR REPLACE PROCEDURE ${n} AS\nBEGIN\n  NULL;\nEND;`
      if (dbType === "postgresql") return `CREATE OR REPLACE PROCEDURE ${n}()\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- statements\nEND;\n$$;`
      return `CREATE PROCEDURE ${n}() BEGIN END;`
    case "TRIGGER":
      if (dbType === "mysql") return `CREATE TRIGGER ${n} BEFORE INSERT ON \`table_name\`\nFOR EACH ROW BEGIN\n  -- statements\nEND;`
      if (dbType === "oracle") return `CREATE OR REPLACE TRIGGER ${n}\nBEFORE INSERT ON table_name\nFOR EACH ROW\nBEGIN\n  NULL;\nEND;`
      if (dbType === "postgresql") return `CREATE TRIGGER ${n} BEFORE INSERT ON table_name\nFOR EACH ROW EXECUTE FUNCTION fn_name();`
      if (dbType === "sqlite") return `CREATE TRIGGER ${n} AFTER INSERT ON table_name\nBEGIN\n  -- statements\nEND;`
      return `CREATE TRIGGER ${n} ...;`
    default:
      return ""
  }
}

export interface Connection {
  id: string
  config: ConnectionConfig
  connected: boolean
}

export type DatabaseType = 'mysql' | 'postgresql' | 'sqlite' | 'mongodb' | 'oracle' | 'redis' | 'dameng'

export const DB_COLORS: Record<DatabaseType, string> = {
  mysql: '#00758F',
  postgresql: '#336791',
  sqlite: '#003B57',
  mongodb: '#4DB33D',
  oracle: '#F80000',
  redis: '#DC382D',
  dameng: '#C00000',
}

export const DB_DISPLAY_NAMES: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
  oracle: 'Oracle',
  redis: 'Redis',
  dameng: '达梦数据库',
}

export const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
  mongodb: 27017,
  oracle: 1521,
  redis: 6379,
  dameng: 5236,
}

export interface Entitlements {
  tier: 'free' | 'pro'
  connectors: string[]
  ddl: boolean
  bulk: boolean
  export: boolean
  multi_connection: boolean
}

export interface LicenseStatus {
  activated: boolean
  key: string | null
  tier: 'free' | 'pro'
  entitlements: Entitlements
}

/** Connectors that require a Pro license (everything else is free). */
export const PAID_CONNECTORS: DatabaseType[] = ['oracle', 'dameng', 'mongodb']

export function isPro(status: LicenseStatus | null | undefined): boolean {
  return !!status?.activated && status.tier === 'pro'
}

/** Whether the given connector type is usable under the current license. */
export function isConnectorAvailable(
  type: DatabaseType,
  status: LicenseStatus | null | undefined,
): boolean {
  if (!PAID_CONNECTORS.includes(type)) return true
  return isPro(status)
}

export async function activateLicense(key: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("activate_license", { key })
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("get_license_status")
}

export async function loadLicenseStatus(): Promise<LicenseStatus> {
  try {
    return await getLicenseStatus()
  } catch {
    return {
      activated: false,
      key: null,
      tier: 'free',
      entitlements: {
        tier: 'free',
        connectors: [],
        ddl: false,
        bulk: false,
        export: false,
        multi_connection: false,
      },
    }
  }
}

export interface CheckpointState {
  completed_tables: string[]
  failed_tables: string[]
  rows_transferred: number
}

export interface ColumnDiff {
  name: string
  source_type: string | null
  target_type: string | null
  source_nullable: boolean | null
  target_nullable: boolean | null
  source_default: string | null
  target_default: string | null
  source_key: string | null
  target_key: string | null
  status: string
}

export interface IndexDiff {
  name: string
  source_columns: string[]
  target_columns: string[]
  source_unique: boolean
  target_unique: boolean
  status: string
}

export interface FkDiff {
  column_name: string
  source_ref: string | null
  target_ref: string | null
  status: string
}

export interface TableDiff {
  table: string
  status: string
  columns: ColumnDiff[]
  indexes: IndexDiff[]
  foreign_keys: FkDiff[]
  sync_sql: string[]
}

export interface CompareResult {
  tables: TableDiff[]
  extra_in_source: string[]
  extra_in_target: string[]
  summary: string
}

export async function compareSchemas(
  sourceId: string, sourceDb: string, targetId: string, targetDb: string,
): Promise<CompareResult> {
  return invoke<CompareResult>("compare_schemas", { sourceId, sourceDatabase: sourceDb, targetId, targetDatabase: targetDb })
}

export async function saveCheckpoint(
  sourceId: string, sourceDb: string, targetId: string, targetDb: string,
  completedTables: string[], rowsTransferred: number,
): Promise<void> {
  return invoke("save_checkpoint", { sourceId, sourceDatabase: sourceDb, targetId, targetDatabase: targetDb, completedTables, rowsTransferred })
}

export async function getCheckpoint(sourceId: string, sourceDb: string, targetId: string, targetDb: string): Promise<CheckpointState | null> {
  return invoke<CheckpointState | null>("get_checkpoint", { sourceId, sourceDatabase: sourceDb, targetId, targetDatabase: targetDb })
}

export async function clearCheckpoint(sourceId: string, sourceDb: string, targetId: string, targetDb: string): Promise<void> {
  return invoke("clear_checkpoint", { sourceId, sourceDatabase: sourceDb, targetId, targetDatabase: targetDb })
}

export async function saveConnectionSecret(id: string, password: string): Promise<void> {
  await invoke("save_connection_secret", { id, password })
}

export async function getConnectionSecret(id: string): Promise<string | null> {
  return invoke<string | null>("get_connection_secret", { id })
}

export async function deleteConnectionSecret(id: string): Promise<void> {
  await invoke<string | null>("delete_connection_secret", { id })
}

export type ExportFormat = 'csv' | 'json' | 'sql' | 'xlsx'

export async function exportData(
  id: string,
  query: string,
  format: ExportFormat,
  filePath: string,
  table?: string,
): Promise<void> {
  return invoke("export_data", { id, query, format, filePath, table: table ?? null })
}

export interface ProcessInfo {
  id: string
  user: string
  host: string
  db: string
  command: string
  state: string
  info: string
  duration: string
}

export async function listProcesses(id: string): Promise<ProcessInfo[]> {
  return invoke("list_processes", { id })
}

export async function killProcess(id: string, pid: string): Promise<void> {
  return invoke("kill_process", { id, pid })
}

export type TaskConfig =
  | { type: "Backup"; source_id: string; database: string; tables: string[]; output_path: string }
  | {
      type: "Transfer"
      source_id: string
      source_database: string
      target_id: string
      target_database: string
      tables: string[]
      mode?: "structure_and_data" | "structure_only" | "data_only"
      conflict_strategy?: "error" | "ignore" | "replace"
      drop_target?: boolean
      truncate_target?: boolean
      where_clause?: string | null
      row_limit?: number | null
      page_size?: number
      parallelism?: number
      transfer_indexes?: boolean
      transfer_foreign_keys?: boolean
      transfer_views?: boolean
      transfer_routines?: boolean
      transfer_triggers?: boolean
      foreign_key_action?: "preserve" | "disable" | "skip"
      column_mappings?: { source_column: string; target_column: string; skip: boolean; default_value: unknown | null }[]
      error_mode?: "skip" | "stop" | "skip_table"
    }

export interface ScheduledTask {
  id: string
  name: string
  cron_expr: string
  enabled: boolean
  config: TaskConfig
  created_at: string
  last_run: string | null
  next_run: string | null
  last_result: string | null
}

export async function createScheduledTask(name: string, cronExpr: string, config: TaskConfig): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("create_scheduled_task", { name, cronExpr, config })
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  return invoke<ScheduledTask[]>("list_scheduled_tasks")
}

export async function updateScheduledTask(id: string, name: string, cronExpr: string, config: TaskConfig, enabled: boolean): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("update_scheduled_task", { id, name, cronExpr, config, enabled })
}

export async function deleteScheduledTask(id: string): Promise<void> {
  return invoke("delete_scheduled_task", { id })
}

export async function toggleScheduledTask(id: string): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("toggle_scheduled_task", { id })
}

export function quoteIdent(s: string, type: DatabaseType): string {
  const parts = s.split(".")
  if (parts.length > 1) {
    return parts.map((p) => quoteIdent(p, type)).join(".")
  }
  if (type === "mysql" || type === "sqlite") {
    return "`" + s.replace(/`/g, "``") + "`"
  }
  if (type === "oracle" && /^[a-zA-Z0-9_$#]+$/.test(s)) {
    return s
  }
  if (s.toLowerCase() !== s || /[^a-zA-Z0-9_]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function buildSelectPreview(table: string, type: DatabaseType, limit = 100): string {
  const q = quoteIdent(table, type)
  if (type === "oracle" || type === "dameng") return `SELECT * FROM ${q} FETCH FIRST ${limit} ROWS ONLY`
  return `SELECT * FROM ${q} LIMIT ${limit}`
}

// --- Column type classification (for bigint-safe editing and date/time pickers) ---

export function isNumericType(type?: string): boolean {
  if (!type) return false
  return /int|decimal|numeric|float|double|real|number|serial|money/i.test(type)
}

export function isTemporalType(type?: string): boolean {
  if (!type) return false
  return /date|time|timestamp/i.test(type)
}

// 字符型大字段 / 结构化文本列：DBeaver 这类会直接打开独立值编辑器（而非在网格内行内编辑）。
// 与后端 data_type 字符串匹配（clob/nclob/longtext/mediumtext/xml/json/jsonb 等）。
export function isStructuredTextType(type?: string): boolean {
  if (!type) return false
  return /longtext|mediumtext|clob|nclob|xml|json/i.test(type)
}

export type TemporalKind = "date" | "time" | "datetime"

export function temporalKind(type?: string): TemporalKind | null {
  if (!type || !isTemporalType(type)) return null
  const t = type.toLowerCase()
  if (t.includes("datetime") || t.includes("timestamp")) return "datetime"
  if (t === "date") return "date"
  if (t === "time") return "time"
  if (t.includes("time")) return "time"
  return "datetime"
}

// Convert a DB value string into a value usable by <input type="date|time|datetime-local">.
export function toInputValue(type: string | undefined, value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = typeof value === "object" ? JSON.stringify(value) : String(value)
  const kind = temporalKind(type)
  if (kind === "date") {
    const m = s.match(/^\d{4}-\d{2}-\d{2}/)
    return m ? m[0] : ""
  }
  if (kind === "time") {
    const m = s.match(/\d{2}:\d{2}(:\d{2})?/)
    return m ? m[0].slice(0, 8) : ""
  }
  // datetime
  let v = s.trim()
  v = v.replace(/Z$/, "").replace(/\s*(UTC|[A-Z]{2,4})$/, "").replace(/[+-]\d{2}:?\d{2}$/, "")
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) {
    return v.replace(" ", "T").slice(0, 19)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + "T00:00:00"
  return ""
}

// Convert a value from a <input type="date|time|datetime-local"> back to a DB literal string.
export function fromInputValue(type: string | undefined, input: string): string {
  const kind = temporalKind(type)
  if (kind === "date") return input
  if (kind === "time") return input
  return input.replace("T", " ")
}

// True when a string holds exactly an integer or decimal number (used to decide
// whether a numeric column value should be emitted unquoted in SQL).
export function isNumericLiteral(s: string): boolean {
  return /^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(s.trim())
}
