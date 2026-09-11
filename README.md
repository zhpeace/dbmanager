# Datanex

A cross-platform, multi-database management and migration desktop application built with [Tauri v2](https://v2.tauri.app/).

## Features

- **Multi-Database Support**: MySQL, PostgreSQL, SQLite, MongoDB, Oracle, Redis, Dameng
- **SQL Editor**: Monaco-based editor with multi-tab support and query execution
- **Schema Designer**: Visual table creation and modification (add/drop/modify/rename columns)
- **Data Browser**: Paginated table browsing with scroll-based lazy loading
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
- **Session Monitor**: Live connection session overview
- **Find in Table**: Quick value search across table data
- **Licensing**: Pro activation via offline activation codes; free tier never shows activation dialogs, activated builds show a Pro badge instead of an activate button
- **Secrets Management**: OS keyring integration (macOS Keychain, Linux Secret Service, Windows Credential Vault)
- **Themes**: Dark / Light mode toggle
- **i18n**: English and Chinese locales

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
