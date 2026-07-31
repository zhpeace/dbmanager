import { invoke } from "@tauri-apps/api/core"

export interface ConnectionConfig {
  id: string
  name: string
  type: 'mysql' | 'postgresql' | 'sqlite' | 'mongodb' | 'oracle' | 'redis'
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  filePath?: string
  color?: string
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

export interface TransferResult {
  tables_transferred: string[]
  rows_transferred: number
  errors: string[]
  duration: string
  logs: string[]
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  duration: string
  error?: string
}

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
  targetDb: string
): Promise<TransferResult> {
  return invoke("duplicate_database", { id, sourceDb, targetDb })
}

export async function dropTable(id: string, database: string, table: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_table", { id, database, table })
}

export async function truncateTable(id: string, database: string, table: string): Promise<QueryResult> {
  return invoke<QueryResult>("truncate_table", { id, database, table })
}

export async function renameTable(id: string, database: string, table: string, newName: string): Promise<QueryResult> {
  return invoke<QueryResult>("rename_table", { id, database, table, newName })
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

export async function dropView(id: string, database: string, view: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_view", { id, database, view })
}

export async function dropRoutine(id: string, database: string, routine: string, routineType: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_routine", { id, database, routine, routineType })
}

export async function dropTrigger(id: string, database: string, trigger: string): Promise<QueryResult> {
  return invoke<QueryResult>("drop_trigger", { id, database, trigger })
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

export type DatabaseType = 'mysql' | 'postgresql' | 'sqlite' | 'mongodb' | 'oracle' | 'redis'

export const DB_COLORS: Record<DatabaseType, string> = {
  mysql: '#00758F',
  postgresql: '#336791',
  sqlite: '#003B57',
  mongodb: '#4DB33D',
  oracle: '#F80000',
  redis: '#DC382D',
}

export const DB_DISPLAY_NAMES: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
  oracle: 'Oracle',
  redis: 'Redis',
}

export const DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgresql: 5432,
  sqlite: 0,
  mongodb: 27017,
  oracle: 1521,
  redis: 6379,
}

export interface LicenseStatus {
  activated: boolean
  key: string | null
}

export async function activateLicense(key: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("activate_license", { key })
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("get_license_status")
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
