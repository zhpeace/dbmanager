# Feature List

DBManager is a cross-platform, multi-database management and migration tool built with Tauri v2.

## Supported Databases

| Database | Connectivity | Features |
|---|---|---|
| MySQL / MariaDB | `sqlx` (Tokio) | Full DDL, queries, indexes, FK, views, routines, triggers |
| PostgreSQL | `sqlx` (Tokio) | Full DDL, queries, indexes, FK, views, routines, triggers |
| SQLite | `sqlx` (Tokio) | Full DDL, queries, indexes, FK, file-based |
| MongoDB | `mongodb` driver | Connection, query execution |
| Oracle | `oracle` crate | Connection, query execution, DDL |
| Redis | `redis-rs` | Connection, query execution |

---

## 1. Connection Management

### Connection Types
- **MySQL** — host, port, user, password, optional database
- **PostgreSQL** — host, port, user, password, optional database
- **SQLite** — file path
- **MongoDB** — host, port, user, password, database
- **Oracle** — host, port, user, password, database (service name / SID)
- **Redis** — host, port, password, database index

### Features
- Create / Edit / Delete connections
- Duplicate connections
- Auto-reconnect on save (test & connect)
- Password stored in OS keyring (via `keyring` crate) + localStorage fallback
- Sidebar with tree view: connection → databases → tables/views
- Connection state badge (connected / disconnected)

---

## 2. SQL Editor

- Monaco Editor integration with SQL syntax highlighting
- Multiple tabs with create/close
- Execute query (Ctrl+Enter / Cmd+Enter)
- Query result displayed in data table below
- Duration display
- Error display inline

---

## 3. Data Browser (Table Browser)

- Paginated data browsing for any table
- Column headers with types
- Scrollable row view
- Auto-pagination on scroll
- Switch between query results and browse view

---

## 4. ER Diagram

- Visual entity-relationship diagram
- Auto-layout using dagre
- Shows tables with columns, keys, and foreign key relationships
- Toggle open/close

---

## 5. Schema Designer

### Create Table
- Visual table creation dialog
- Add / Remove columns
- Column properties: name, type, nullable, default, primary key, auto-increment, unique, comment
- Supported types vary by database (MySQL INT/VARCHAR/TEXT/etc., PG INTEGER/VARCHAR/TEXT/SERIAL/etc., SQLite INTEGER/TEXT/REAL/BLOB)

### Design Table (Alter)
- Add column
- Drop column
- Modify column type
- Rename column
- All operations generate appropriate ALTER TABLE DDL

### Schema Objects
- **Tables**: create, drop, rename, truncate, design
- **Views**: drop
- **Functions / Procedures**: drop
- **Triggers**: drop
- Context menu on sidebar for all object types

---

## 6. Import

- Import data from files into tables
- File format detection and parsing
- Destination table selection
- Cross-database import support

---

## 7. Migration (Transfer)

### Overview
Cross-database data and schema migration engine. Supports moving data and schema objects between any combination of supported databases.

### Transfer Options

| Option | Description |
|---|---|
| **Mode** | `INSERT` — bulk insert only; `CREATE_AND_INSERT` — create table then insert; `CREATE_TABLE_ONLY` — create table structure only |
| **Drop Target** | Drop target table before migration |
| **Truncate Target** | Truncate target table before insert |
| **Where Clause** | Filter source rows (e.g. `status = 'active'`) |
| **Row Limit** | Maximum rows to transfer |
| **Page Size** | Rows per batch (for paginated transfer) |
| **Parallelism** | Number of concurrent batch workers |

### Conflict Strategy
| Strategy | Description |
|---|---|
| `Error` | `INSERT INTO ... VALUES (...)` — fails on conflict |
| `Ignore` | `INSERT IGNORE INTO ... VALUES (...)` (MySQL) / `ON CONFLICT DO NOTHING` (PG) / `INSERT OR IGNORE` (SQLite) |
| `Replace` | `REPLACE INTO ... VALUES (...)` (MySQL) / `ON CONFLICT DO UPDATE SET ...` (PG) / `INSERT OR REPLACE` (SQLite) |

### Schema Objects Migration
- **Indexes** — reads source indexes via `information_schema.STATISTICS` / PG `pg_indexes` / SQLite `PRAGMA index_list` + `PRAGMA index_info`; generates `CREATE INDEX` for target
- **Foreign Keys** — reads FK constraints; generates `ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY` for target
- **Views** — extracts `SHOW CREATE VIEW` / PG `pg_get_viewdef`; recreates on target
- **Routines (Functions/Procedures)** — extracts routine definitions; recreates on target
- **Triggers** — extracts trigger definitions; recreates on target

### Column Mapping
- Source column → Target column rename
- Skip columns (exclude from transfer)
- Default value for target columns (when source is NULL)

### Auto-Increment / Sequence
- **MySQL source**: detects `extra == "auto_increment"`
- **PostgreSQL source**: detects `nextval` in default or `serial` types
- **SQLite source**: detects INTEGER PRIMARY KEY
- **MySQL target**: adds `AUTO_INCREMENT`
- **PostgreSQL target**: uses `SERIAL` / `BIGSERIAL` pseudo-types
- **SQLite target**: implicit auto-increment on INTEGER PRIMARY KEY

### Checkpoint & Resume
- Auto-saves checkpoint on partial failure (tracks last transferred page)
- Resume banner appears when re-opening transfer dialog with same source/target
- Checkpoint stored in `AppState.checkpoints`, keyed by connection pair
- Commands: `save_checkpoint`, `get_checkpoint`, `clear_checkpoint`

### Real-Time Logging
- Live log panel during transfer
- Events emitted via Tauri `"migration-log"` event
- Frontend subscribes with `listen("migration-log")` using `@tauri-apps/api/event`

---

## 8. Compare & Sync

### Schema Comparison
- Compares tables, columns, indexes, and foreign keys between source and target databases
- Column diff: type, nullable, default value, key mismatches
- Index diff: columns, uniqueness mismatches
- FK diff: referenced table/column mismatches
- Generates sync SQL for missing columns
- Highlights: `match`, `differs`, `only_in_source`, `only_in_target`, `missing_in_target`

### Sync
- `compare_schemas` Tauri command returns structured `CompareResult`
- Sync SQL displayed per table for manual execution or future auto-sync

---

## 9. Licensing

- License activation dialog
- License status persisted and checked on startup
- Graceful blocking of unlicensed usage

---

## 10. Internationalization

- English (en) and Chinese (zh) locales
- `react-i18next` integration
- Language toggle in top bar
- All UI strings externalized to JSON locale files

---

## 11. Theme

- Dark / Light mode toggle
- Tailwind CSS v4 with CSS variables
- Theme persisted in localStorage

---

## 12. Secrets Management

- Passwords stored in OS keyring (macOS Keychain, Linux Secret Service, Windows Credential Vault)
- `keyring` crate integration
- Fallback to localStorage for backwards compatibility
- Commands: `save_connection_secret`, `get_connection_secret`, `delete_connection_secret`

---

## 13. Security

- No plaintext password in logs
- Password isolation via OS keyring
- No hardcoded credentials

---

## Architecture

```
dbmanager/
├── src/                          # Frontend (React + TypeScript + Vite)
│   ├── App.tsx                   # Main app component, state management
│   ├── main.tsx                  # Entry point
│   ├── components/
│   │   ├── connection/           # Connection, Import, Transfer, Compare, Schema dialogs
│   │   ├── dataview/             # Result panel, Table browser, ER diagram
│   │   ├── editor/               # SQL editor (Monaco)
│   │   ├── layout/               # TopBar, Sidebar
│   │   ├── schema/               # Schema-related components
│   │   └── ui/                   # shadcn/ui primitives
│   └── lib/
│       ├── db.ts                 # TypeScript API wrappers + types
│       ├── i18n.ts               # i18n config
│       ├── locales/              # en.json, zh.json
│       ├── theme.tsx             # Theme provider
│       └── utils.ts              # cn() utility
├── src-tauri/                    # Backend (Rust + Tauri)
│   └── src/
│       ├── lib.rs                # Tauri commands / app entry
│       ├── main.rs               # Binary entry
│       ├── db/
│       │   ├── mod.rs            # Core DB logic (connect, query, transfer, compare)
│       │   ├── types.rs          # Shared types (TransferOptions, CompareResult, etc.)
│       │   └── ddl.rs            # DDL generation utilities
│       ├── license.rs            # License verification
│       └── secrets.rs            # OS keyring integration
└── package.json                  # Frontend dependencies
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript 6 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| SQL Editor | Monaco Editor |
| Icons | Lucide React |
| i18n | i18next + react-i18next |
| ORM / DB Driver | sqlx (MySQL, PG, SQLite), mongodb, oracle, redis-rs |
| Async Runtime | Tokio |
| Secret Storage | keyring (OS native) |

## Build & Run

```bash
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```
