# DBManager

A cross-platform, multi-database management and migration desktop application built with [Tauri v2](https://v2.tauri.app/).

## Features

- **Multi-Database Support**: MySQL, PostgreSQL, SQLite, MongoDB, Oracle, Redis
- **SQL Editor**: Monaco-based editor with multi-tab support and query execution
- **Schema Designer**: Visual table creation and modification (add/drop/modify/rename columns)
- **Data Browser**: Paginated table browsing with scroll-based lazy loading
- **ER Diagram**: Auto-layout entity-relationship visualization
- **Migration Engine**: Cross-database data and schema transfer with:
  - Conflict strategies (Error / Ignore / Replace)
  - Index, foreign key, view, routine, and trigger migration
  - Column mapping (rename, skip, default values)
  - Auto-increment / sequence translation
  - Checkpoint & resume on partial failure
  - Real-time log streaming
- **Compare & Sync**: Schema comparison between databases, diff viewer, sync SQL generation
- **Import**: File-based data import into tables
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
