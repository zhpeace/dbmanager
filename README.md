# Datanex

A cross-platform, multi-database management and migration desktop application built with [Tauri v2](https://v2.tauri.app/).

## Features

- **Multi-Database Support**: MySQL, PostgreSQL, SQLite, MongoDB, Oracle, Redis, Dameng
- **SQL Editor**: Monaco-based editor with multi-tab support and query execution; a query tab ("查询 1") and the editor are visible immediately on startup even before any connection is active — the editor renders unbound with a "无连接" connection picker, so you can start typing right away and bind a connection when ready (the welcome page is only a fallback if the tab list is ever empty)
- **Editor–Connection Binding**: every query tab is bound to a connection (DBeaver/DataGrip-style); the editor toolbar shows the bound connection and a database selector, the connection can be switched per tab via the toolbar switcher (including "None" to unbind). A *single* sidebar click on a connection only expands/highlights it (connect-if-needed) and never touches the active tab, the editor binding or the query results; a *double* click performs the full context restore (reopens that connection's last browse tab, or binds an unbound query tab). Switching the sidebar selection never redirects an already-bound editor, so a query always runs against the connection shown in its toolbar
- **Toolbar & Feedback UX**: the top navigation groups low-frequency actions (Import / Backup / Restore / Scheduled Tasks / Find in Table / Session Monitor) under a compact "More" menu; the connection selector shows the friendly name with a type color dot; the editor toolbar is visually grouped (files/history | execute | transaction) with a prominent Run button; transient errors are cleared when switching tabs or connections, and error hints (with a folded "Help doc" link for URLs such as Oracle's ORA-xxx pages) render inside the result panel instead of a persistent top banner, with an em-dash for missing run times; the error text appears once per panel (info tab block / data-grid state), and the status bar shows only row count and duration
- **Editor Tabs**: the "+ new query" entry lives at the end of the tab bar (browser-style), with Cmd/Ctrl+T to open a new query tab, Cmd/Ctrl+W to close the active one and Cmd/Ctrl+1..9 to jump to a tab; tabs shrink from 170px down to 90px when many are open, middle-click closes a tab, double-click on the empty tab-bar area opens a new tab, and right-clicking a tab offers Close / Close Others / Close Tabs to the Right
- **Session Restore (Navicat-style)**: query tabs — their titles, SQL text, open file and connection/database binding — are persisted (debounced) and restored on next launch, so the SQL editors you had open come back exactly as you left them. Browse tabs and query results are intentionally not persisted (results are re-run). Restored bindings are validated on startup: connections that were deleted fall back to "unbound" (SQL is kept), and databases removed from the server are cleared for re-selection; a corrupt/empty session falls back to a fresh "查询 1". Persistence is debounce-only: no `beforeunload`/close-time flush is registered, because macOS WKWebView blocks the native window close button when the page installs a `beforeunload` handler
- **Top bar cleanup**: the redundant `user@host:port` segment is removed from the top connection strip (host/user are already in the sidebar); the strip now shows only the connection name and current database
- **Sidebar selection model (mainstream-aligned)**: a *single* click on a connection, database, or object in the sidebar is **pure selection** — it highlights the row and updates the global selection context, but never mutates any open tab's binding, never clears results, and never switches the top strip (Navicat/DataGrip/DBeaver behavior). The top strip always reflects the *active tab's* real context (connection + database of the query/browse tab you're looking at) and follows tab switches, double-clicking a table to open its data browser, and manual picks in the editor selectors. A *double* click on a table opens its data browser tab (browse tabs keep their own connection/database binding). A new query tab inherits the sidebar's current selection (connection + last-selected database), so the "click something, then open a new query" flow stays convenient without any open tab being rewritten. This eliminates the previous class of bugs where a single click could rebind the active browse tab and produce "Table 'db.x' doesn't exist" errors
- **Schema Designer**: Visual table creation and modification (add/drop/modify/rename columns)
- **Data Browser**: Paginated table browsing with scroll-based lazy loading; single-clicking a cell selects (highlights) it, Cmd/Ctrl+C copies the selected cell, and Cmd/Ctrl+V pastes the clipboard into it by entering edit mode (DataGrip/Navicat-style); inside the inline editor the system copy/paste works natively with stable cursor behavior. Sidebar single clicks never rebind or clear the currently browsed table (only double-click opens a browse tab)
- **List-level (bulk) editing (Navicat-aligned)**: rows are multi-selectable via checkboxes (header checkbox selects all, row-number click toggles), then "Bulk edit" opens a dialog to set a target column by *constant*, *expression* (`原值+1`, `原值*0.9` — references the current cell value, numeric columns only), or *function* (`now()`, `uuid()`, `NULL`, or a start/step *sequence*). Applied values join the normal dirty buffer and are submitted with the Save button; identical column/value edits across multiple rows are collapsed into a single merged `UPDATE … WHERE cond1 OR cond2 …` instead of one statement per row
- **Result Grid Performance**: result tables virtualize rows (≥500 rows render only the visible window, small results render fully for stability); switching between multiple query-result tabs keeps each result mounted and toggles visibility instead of remounting, so multi-statement runs with large result sets switch instantly; the row-count readout is sourced directly from the result set (no more blank "行数" on executed queries)
- **ER Diagram**: Auto-layout entity-relationship visualization; large schemas (>120 tables) render only foreign-key-related tables by default with a "show all" toggle
- **Migration Engine**: Cross-database data and schema transfer with:
  - Conflict strategies (Error / Ignore / Replace)
  - Index, foreign key, view, routine, and trigger migration
  - Column mapping (rename, skip, default values)
  - Auto-increment / sequence translation
  - Checkpoint & resume on partial failure
  - **Background execution + Task Center**: starting a migration closes the dialog immediately and runs in the background, so the app stays fully usable; the Task Center (top bar) tracks progress (x/y tables, current table, elapsed time), supports cancel, and keeps a history of finished tasks with per-task logs and errors; source/target connections are locked against concurrent transfers while a task is running
  - **Cancel & resume**: cancelling a running migration saves a checkpoint of completed tables; reopening the transfer dialog with the same source/target shows a resume banner ("N tables completed — continue?") with Continue / Restart actions, so an interrupted migration can be resumed from where it stopped
  - **Task Center interactions**: clicking Start fires a flight animation that "tosses" the task into the Task Center button (badge pops + panel opens); cancelled tasks with a checkpoint show a one-click Resume action that pre-fills the transfer dialog; running tasks expand to show live stats and a streaming log with All / Errors-only / By-table views
  - Real-time log streaming; result page drops redundant table-name chips (per-table stats cover them), groups per-table logs with failed tables expanded by default, and offers a failed-only stats filter
  - PostgreSQL/openGauss targets create tables under the target connection's schema (default `public`) instead of the source database name
- **Compare & Sync**: Schema comparison between databases, diff viewer, sync SQL generation
- **Import**: File-based data import into tables
- **Redis Tooling**: Binary-safe value browsing (HEX/ASCII/BASE64 views), wildcard key search (`*` `?` — plain text auto-matches as substring), type-filtered loading with pagination
- **Backup & Restore**: Full database backup and restore flows
- **Scheduled Tasks**: Recurring backup/sync jobs with a scheduler
- **Default Database / Schema Focus**: connections can carry a default database (and schema for PostgreSQL/Oracle/Dameng); expanding the connection auto-expands and star-marks the configured context
- **Oracle Schema Filtering**: the Oracle sidebar filters out built-in system schemas (SYS, SYSTEM, XDB, ...) and lists only business schemas; the default schema is matched by the connection username
- **Session Monitor**: Live connection session overview for MySQL / PostgreSQL / Oracle / Redis — lists active sessions (ID, user, host, database, state, duration, current query) with per-session terminate; MySQL uses `information_schema.PROCESSLIST` + `KILL`, PostgreSQL uses `pg_stat_activity` + `pg_terminate_backend`, Oracle uses `v$session` + `ALTER SYSTEM KILL SESSION`, Redis uses `CLIENT LIST` + `CLIENT KILL ID`
- **Find in Table**: Quick value search across table data
- **Licensing**: Pro activation via offline activation codes; free tier never shows activation dialogs, activated builds show a Pro badge instead of an activate button
- **Secrets Management**: OS keyring integration (macOS Keychain, Linux Secret Service, Windows Credential Vault)
- **Themes**: Dark / Light mode toggle
- **i18n**: English and Chinese locales
- **Minimal macOS menu bar**: only the app menu (About / Quit) plus the standard Edit menu (Undo / Redo / Cut / Copy / Paste / Select All) remain; the File/View/Window/Help menus are removed. The Edit menu is required on macOS because WKWebView routes Cmd+C/V/X/A in native inputs through the menu's first-responder chain — without it, inline grid editing loses native copy/paste

## Quick Start

```bash
# Install dependencies
npm install

# Development mode
npm run tauri dev

# Production build
npm run tauri build
```

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (edition 2021)
- [Node.js](https://nodejs.org/) >= 18
- Tauri v2 system dependencies: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Documentation

- [Full Feature List](FEATURES.md) — detailed breakdown of all features

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Tauri v2 |
| Frontend | React 19 + TypeScript 6 + Vite |
| Styling | Tailwind CSS v4 + shadcn/ui |
| SQL Editor | Monaco Editor |
| Backend | Rust with sqlx, mongodb, oracle, redis-rs |
| Async | Tokio |
| Secrets | keyring (OS native credential storage) |

## License

Commercial license. See [LICENSE](LICENSE).

## Repository

- Gitee: https://gitee.com/YOUR_REPO
- GitHub: https://github.com/YOUR_REPO
