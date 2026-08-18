import { Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Serve Monaco from the bundled local copy (node_modules) instead of jsdelivr CDN. */
export async function routeMonaco(page: Page) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const vsDir = path.resolve(here, '../node_modules/monaco-editor/min/vs')
  await page.route('**/*', (route) => {
    const url = route.request().url()
    const marker = '/monaco-editor@0.55.1/min/vs/'
    const idx = url.indexOf(marker)
    if (idx === -1) {
      route.continue()
      return
    }
    const rel = url.slice(idx + marker.length).split('?')[0]
    const local = path.join(vsDir, rel)
    if (fs.existsSync(local)) {
      void route.fulfill({ path: local })
    } else {
      route.abort()
    }
  })
}

export interface StubConn {
  id: string
  name: string
  type: 'mysql' | 'postgresql' | 'sqlite' | 'mongodb' | 'oracle' | 'redis'
  host: string
  port: number
  user: string
  database?: string
}

export interface StubDB {
  /** databases returned per connection id */
  [connId: string]: string[]
}

export interface StubQuery {
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount?: number
}

/** Extend StubState with failure injection for error-path tests. */
export interface StubFail {
  /** connection ids whose connect_* / get_databases should throw */
  failConnect?: string[]
  /** exact SQL strings (after trim/strip ';') whose execute_query should throw */
  failQueries?: string[]
  /** exact SQL strings whose execute_query returns an error result object */
  errorQueries?: Record<string, string>
}

/** Persisted connections written into localStorage before app boots. */
export function savedConnections(conns: StubConn[]): Array<{ id: string; config: Record<string, unknown>; connected: boolean }> {
  return conns.map((c) => ({ id: c.id, config: c as unknown as Record<string, unknown>, connected: true }))
}

/** Guaranteed-per-app-run data. */
export interface StubState {
  connections: StubConn[]
  dbs: StubDB
  tables: Record<string, string[]>
  queries: Record<string, StubQuery>
  /** per-database redis keys (name + object_type + optional ttl) */
  redisKeys?: Record<string, Array<{ name: string; object_type: string; ttl?: number }>>
  /** optional per-table data used by get_table_data */
  tableData?: Record<string, { columns: Array<{ name: string; data_type: string; nullable: boolean; key: string; default_value: string | null; extra: string }>; rows: Array<Record<string, unknown>>; total: number }>
  /** per-database non-table objects (views/functions/procedures/triggers) for get_tables */
  objects?: Record<string, Array<{ name: string; object_type: string }>>
  /** exact EXPLAIN SQL strings whose execute_query result overrides the generic plan stub */
  explainOverrides?: Record<string, StubQuery>
  /** failure injection for error-path tests */
  fail?: StubFail
}

/**
 * Install a fake backend before the app loads.
 * Uses page.addInitScript so __TAURI_INTERNALS__ exists prior to any module
 * evaluation and localStorage is pre-seeded with saved connections.
 */
export async function installBackend(page: Page, state: StubState, lang = 'en') {
  await page.addInitScript(
    ({ state, lang }) => {
      const conns = state.connections.map((c) => ({
        id: c.id,
        config: { ...c },
        connected: true,
      }))
      localStorage.setItem('dbmanager-connections', JSON.stringify(conns))
      localStorage.setItem('dbmanager-sidebarWidth', '240')
      localStorage.setItem('lang', lang)

      // Runtime-mutable failure state: tests can flip failConnect/failQueries
      // mid-session (e.g. to simulate a recoverable outage) via window.__stubFail.
      window.__stubFail = state.fail || {}

      const dbCalls: string[] = []
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      const databasesFor = (id: string): string[] => state.dbs[id] || []
      const tablesOf = (db: string): string[] => state.tables[db] || []

      let __callbackId = 0
      const __callbacks: Record<number, { cb: (e: any) => void; once: boolean }> = {}
      window.__eventHandlers = {}
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (event: string, id: string) => {
          const handlers = window.__eventHandlers[event] || []
          const idx = handlers.findIndex((h: any) => h.id === id)
          if (idx !== -1) handlers.splice(idx, 1)
        },
      }

      window.__TAURI_INTERNALS__ = {
        transformCallback: (cb: (...args: unknown[]) => void, once = false) => {
          const id = ++__callbackId
          __callbacks[id] = { cb, once }
          return id
        },
        invoke: async (cmd: string, args: any) => {
          switch (cmd) {
            case 'plugin:event|listen': {
              const handlers = (window.__eventHandlers[args.event] = window.__eventHandlers[args.event] || [])
              const eventId = `lsn${handlers.length + 1}`
              handlers.push({ id: eventId, handlerId: args.handler })
              return eventId
            }
            case 'plugin:event|emit': {
              const handlers = window.__eventHandlers[args.event] || []
              for (const h of handlers) {
                const cb = __callbacks[h.handlerId]
                if (cb) cb.cb({ event: args.event, payload: args.payload, id: h.id })
              }
              return null
            }
            case 'plugin:event|unlisten':
              return null
            case 'get_license_status':
              return { activated: true, key: null }
            case 'activate_license':
              return { activated: true, key: args.key }
            case 'connect_mysql':
            case 'connect_postgres':
            case 'connect_sqlite':
            case 'connect_mongo':
            case 'connect_oracle':
            case 'connect_redis':
              if ((window.__stubFail as any)?.failConnect?.includes(args.id)) {
                throw new Error('Connection refused: access denied for user ' + args.user)
              }
              return { ok: true, connection_id: args.id }
            case 'test_connection':
              if ((window.__stubFail as any)?.failConnect?.length) {
                throw new Error('Connection refused')
              }
              return 'OK'
            case 'disconnect':
              return { ok: true }
            case 'get_databases':
              if ((window.__stubFail as any)?.failConnect?.includes(args.id)) {
                throw new Error('Connection lost')
              }
              return databasesFor(args.id).map((name) => ({ name }))
            case 'get_schemas': {
              const conn = state.connections.find((c) => c.id === args.id)
              if (conn && (conn.type === 'postgresql' || conn.type === 'pg')) {
                return [{ name: 'public' }, { name: 'information_schema' }]
              }
              return []
            }
            case 'switch_database': {
              dbCalls.push(args.database)
              if (window.__planCalls) window.__planCalls.push(args.database)
              return { ok: true }
            }
            case 'get_tables': {
              const conn = state.connections.find((c) => c.id === args.id)
              const isPg = conn && (conn.type === 'postgresql' || conn.type === 'pg')
              const dbObjects = state.objects?.[args.database] || []
              const named = dbObjects.reduce((m, o) => ({ ...m, [o.name]: o.object_type }), {})
              const names = Array.from(new Set([...tablesOf(args.database), ...dbObjects.map((o) => o.name)]))
              return names.map((name) => ({
                name,
                object_type: named[name] || 'TABLE',
                schema: isPg ? 'public' : undefined,
                size_bytes: 1024,
                row_count: 100,
              }))
            }
case 'get_table_stats':
               return { row_count: 100, size: '1KB', last_update: '2024-01-01' }
             case 'execute_query': {
              const sql = args.query.trim().replace(/;$/, '')
              window.__executedQueries = (window.__executedQueries || []).concat([sql])
              if ((window.__stubFail as any)?.failQueries?.includes(sql)) {
                throw new Error(`SQL error 1064: syntax near '${sql.slice(0, 20)}'`)
              }
              if ((window.__stubFail as any)?.errorQueries?.[sql]) {
                return { columns: [], rows: [], rowCount: 0, duration: '3ms', error: (window.__stubFail as any).errorQueries[sql] }
              }
              if (state.explainOverrides?.[sql]) {
                return { ...state.explainOverrides[sql], rowCount: state.explainOverrides[sql].rowCount ?? state.explainOverrides[sql].rows.length, duration: '5ms' }
              }
              if (/^INSERT INTO\b/i.test(sql)) {
                window.__importInserts = (window.__importInserts || []).concat([sql])
                return { columns: ['result'], rows: [], rowCount: 1, duration: '2ms' }
              }
              if (/^EXPLAIN\b/i.test(sql)) {
                const m = sql.match(/\bfrom\s+([`"'\w.]+)/i)
                const table = m ? m[1].replace(/[`"']/g, '') : 'users'
                return {
                  columns: ['id', 'select_type', 'table', 'type', 'rows'],
                  rows: [{ id: 1, select_type: 'SIMPLE', table, type: 'ALL', rows: 100 }],
                  rowCount: 1,
                  duration: '5ms',
                }
              }
              const q = state.queries[sql]
              if (!q) return { columns: ['result'], rows: [], rowCount: 0, duration: '1ms', error: 'no stub' }
              return { columns: q.columns, rows: q.rows, rowCount: q.rowCount ?? q.rows.length, duration: '12ms' }
            }
            case 'get_schema_cache': {
              const dbs = state.tables
              const dbTables = Object.entries(dbs).find(([db]) => db === args.database)
              const names = dbTables ? dbTables[1] : []
              const tables = names.map((name) => {
                const td = state.tableData?.[name]
                return {
                  table: name,
                  columns: td ? td.columns.map((c) => ({
                    name: c.name,
                    data_type: c.data_type,
                    nullable: c.nullable,
                    key: c.key,
                    default_value: c.default_value,
                    extra: c.extra || '',
                  })) : [{ name: 'id', data_type: 'int', nullable: false, key: 'PRI', default_value: null, extra: '' }],
                  primary_keys: td ? td.columns.filter((c) => c.key === 'PRI').map((c) => c.name) : ['id'],
                  foreign_keys: [],
                  indexes: td ? [{ name: 'idx_' + name, columns: [td.columns[0]?.name ?? 'id'], unique: false, index_type: '' }] : [],
                  views: [],
                  routines: [],
                  triggers: [],
                }
              })
              return { tables, views: [], routines: [], triggers: [] }
            }
            case 'cancel_query':
              return { ok: true }
            case 'begin_transaction':
            case 'commit_transaction':
            case 'rollback_transaction':
              window.__txCalls = (window.__txCalls || []).concat([{ cmd, args }])
              return { ok: true }
            case 'export_csv':
            case 'export_json':
            case 'export_sql':
            case 'get_er_diagram':
            case 'explain_query':
              return { ok: true, output_path: '/tmp/out', result: '{}' }
            case 'duplicate_database':
              window.__lastTransferOpts = args
              return { tables_transferred: ['users'], rows_transferred: 100, errors: [], duration: '1.2s', logs: [], table_stats: [] }
            case 'compare_schemas':
              return {
                tables: [{
                  table: 'users',
                  status: 'differs',
                  columns: [
                    { name: 'email', source_type: 'varchar', target_type: 'varchar(255)', source_nullable: true, target_nullable: false, source_default: null, target_default: null, source_key: null, target_key: null, status: 'type_mismatch' },
                  ],
                  indexes: [],
                  foreign_keys: [],
                  sync_sql: ['ALTER TABLE `users` MODIFY `email` VARCHAR(255);'],
                }],
                extra_in_source: ['archive'],
                extra_in_target: ['backup'],
                summary: '1 table differs, 1 only in source, 1 only in target',
              }
            case 'create_table':
            case 'alter_table_add_column':
            case 'alter_table_drop_column':
            case 'alter_table_modify_column':
            case 'alter_table_rename_column':
            case 'create_index':
            case 'drop_index':
            case 'add_foreign_key':
            case 'drop_foreign_key':
            case 'drop_table':
            case 'truncate_table':
            case 'rename_table':
            case 'drop_database':
            case 'create_database':
            case 'drop_view':
            case 'drop_routine':
            case 'drop_trigger':
              window.__ddlCalls = (window.__ddlCalls || []).concat({ cmd, args })
              return { ok: true, rowCount: 1 }
            case 'backup_database':
              window.__backupArgs = args
              await sleep(60)
              await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'migration-log', payload: 'Backing up table: users' })
              await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'migration-log', payload: 'Table users: 100 rows dumped' })
              if (window.__backupError) throw new Error(window.__backupError)
              return [5, '2.3s']
            case 'restore_database':
              window.__restoreArgs = args
              await sleep(60)
              await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'migration-log', payload: 'Restoring table: users' })
              await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'migration-log', payload: 'Table users: 100 rows loaded' })
              if (window.__restoreErrors) return [5, window.__restoreErrors]
              return [42, []]
            case 'transfer_table':
            case 'transfer_data':
              window.__lastTransferOpts = args.opts
              return {
                tables_transferred: ['users'],
                rows_transferred: 100,
                errors: [],
                duration: '1.2s',
                logs: window.__transferLogs || ['Transferring table users...', 'Table users: 100/100 rows'],
                table_stats: [],
                ...(window.__transferOverrides || {}),
              }
            case 'get_checkpoint':
              return window.__checkpoint || null
            case 'get_connection_secret':
              return null
            case 'save_checkpoint':
              window.__savedCheckpoint = args
              return { ok: true }
            case 'clear_checkpoint':
              window.__clearedCheckpoint = args
              return { ok: true }
            case 'delete_connection_secret':
            case 'save_connection_secret':
              return { ok: true }
            case 'find_in_tables':
              return [
                { table: 'users', column: 'email', value: 'alice@x.com', row: { id: 1 } },
                { table: 'orders', column: 'note', value: 'alice order', row: { id: 9 } },
              ]
            case 'get_table_data': {
              const conn = state.connections.find((c) => c.id === args.id)
              if (conn?.type === 'redis') {
                const dbKeys = state.redisKeys?.[args.database] || []
                const k = dbKeys.find((x) => x.name === args.table)
                if (k?.object_type === 'hash') {
                  return {
                    columns: [{ name: 'field', data_type: 'hash', nullable: false, key: '', default_value: null, extra: '' }, { name: 'value', data_type: 'hash', nullable: false, key: '', default_value: null, extra: '' }],
                    rows: [{ field: 'email', value: 'alice@x.com' }, { field: 'name', value: 'Alice' }],
                    total: 2,
                    duration: '1ms',
                    primary_keys: [],
                    row_handles: [],
                  }
                }
                return {
                  columns: [{ name: 'key', data_type: k?.object_type || 'string', nullable: false, key: '', default_value: null, extra: '' }, { name: 'value', data_type: k?.object_type || 'string', nullable: false, key: '', default_value: null, extra: '' }],
                  rows: [{ key: args.table, value: 'hello' }],
                  total: 1,
                  duration: '1ms',
                  primary_keys: [],
                  row_handles: [],
                }
              }
              const t = state.tableData?.[args.table]
              window.__lastTableArgs = args
              if (!t) return { columns: [], rows: [], total: 0, duration: '1ms', primary_keys: [], row_handles: [] }
              let rows = t.rows
              if (args.whereClause) {
                rows = rows.filter((r) => args.whereClause.split(/\s+AND\s+/i).every((c: string) => {
                  const m = c.match(/`?(\w+)`?\s*(>=|<=|<>|!=|>|<|=)\s*('(?:[^']|'')*'|-?\d+(?:\.\d+)?)/)
                  if (!m) return true
                  const [, col, op, raw] = m
                  const val = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw
                  const cell = String(r[col] ?? '')
                  if (op === '=') return cell === val
                  if (op === '<>' || op === '!=') return cell !== val
                  const n = Number(val)
                  const cn = Number(cell)
                  if (op === '>') return cn > n
                  if (op === '<') return cn < n
                  if (op === '>=') return cn >= n
                  if (op === '<=') return cn <= n
                  return false
                }))
              }
              if (args.sortColumn) {
                rows = [...rows].sort((a, b) => {
                  const av = String(a[args.sortColumn] ?? '')
                  const bv = String(b[args.sortColumn] ?? '')
                  const cmp = av < bv ? -1 : av > bv ? 1 : 0
                  return args.sortOrder === 'desc' ? -cmp : cmp
                })
              }
              const start = ((args.page || 1) - 1) * (args.pageSize || 100)
              const slice = rows.slice(start, start + (args.pageSize || 100))
              return {
                ...t,
                columns: t.columns,
                rows: slice,
                total: t.total ?? rows.length,
                duration: '3ms',
                primary_keys: t.columns.filter((c) => c.key === 'PRI').map((c) => c.name),
                row_handles: slice.map((r) => ({ ...r })),
              }
            }
            case 'get_table_ddl':
              return `CREATE TABLE \`${args.table}\` (\n  \`id\` INT\n);`
            case 'redis_scan_keys': {
              const conn = state.connections.find((c) => c.id === args.id)
              const dbKeys = (conn && state.redisKeys?.[args.database]) || []
              const pat = (args.pattern as string) || '*'
              const typeFilter = (args.typeFilter as string) || ''
              const rx = new RegExp('^' + pat.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
              const filtered = dbKeys.filter((k) => rx.test(k.name))
                .filter((k) => !typeFilter || k.object_type.toLowerCase() === typeFilter.toLowerCase())
              const start = (args.cursor || 0)
              const slice = filtered.slice(start, start + (args.pageSize || 100))
              return {
                keys: slice,
                cursor: start + slice.length >= filtered.length ? 0 : start + slice.length,
              }
            }
            case 'redis_key_info': {
              const conn = state.connections.find((c) => c.id === args.id)
              const dbKeys = (conn && state.redisKeys?.[args.database]) || []
              const k = dbKeys.find((x) => x.name === args.key)
              return { key_type: k?.object_type || 'string', ttl: k?.ttl ?? -1, size: 128, length: 1 }
            }
            case 'redis_command':
              return { ok: true }
            case 'execute_batch':
              window.__batchQueries = (window.__batchQueries || []).concat(args.queries || [])
              return 1
            case 'list_scheduled_tasks':
              return (window as any).__scheduledTasks || []
            case 'create_scheduled_task': {
              window.__scheduledArgs = args
              const task = {
                id: 'task-' + (window as any).__taskSeq,
                name: args.name,
                cron_expr: args.cronExpr,
                enabled: true,
                config: args.config,
                created_at: '2024-01-01T00:00:00.000Z',
                last_run: null,
                next_run: null,
                last_result: null,
              }
              window.__taskSeq = ((window as any).__taskSeq || 0) + 1
              window.__scheduledTasks = ((window as any).__scheduledTasks || []).concat([task])
              return task
            }
            case 'update_scheduled_task':
              window.__scheduledArgs = args
              window.__scheduledTasks = ((window as any).__scheduledTasks || []).map((x: any) =>
                x.id === args.id ? { ...x, name: args.name, cron_expr: args.cronExpr, config: args.config, enabled: args.enabled } : x)
              return (window as any).__scheduledTasks.find((x: any) => x.id === args.id) || null
            case 'delete_scheduled_task':
              window.__scheduledTasks = ((window as any).__scheduledTasks || []).filter((x: any) => x.id !== args.id)
              return null
            case 'toggle_scheduled_task':
              window.__scheduledTasks = ((window as any).__scheduledTasks || []).map((x: any) =>
                x.id === args.id ? { ...x, enabled: !x.enabled } : x)
              return (window as any).__scheduledTasks.find((x: any) => x.id === args.id) || null
            case 'plugin:dialog|save':
            case 'plugin:dialog|open':
              return '/tmp/stub-export.csv'
            case 'plugin:dialog|message':
            case 'plugin:dialog|ask':
            case 'plugin:dialog|confirm':
              return true
            case 'plugin:fs|write_text_file':
            case 'write_text_file':
              window.__writtenFiles = (window.__writtenFiles || []).concat({ path: args.path, content: args.content })
              return null
            case 'write_binary_file':
              window.__writtenFiles = (window.__writtenFiles || []).concat({ path: args.path, data: args.data })
              return null
            case 'write_file':
              window.__writtenFiles = (window.__writtenFiles || []).concat({ path: args.path, content: args.content })
              return null
            default:
              return {}
          }
        },
      }
    },
    { state, lang },
  )
}

/** Opens the app (react app served by vite dev) and waits for the UI shell. */
export async function openApp(page: Page) {
  await routeMonaco(page)
  await page.goto('/')
  await page.waitForSelector('header', { timeout: 15_000 })
  // wait for license check to settle
  await page.waitForSelector('header >> text=DBManager', { timeout: 15_000 })
}