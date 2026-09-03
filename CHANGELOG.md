# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-09-03

### Added

- Dameng (DM8) 数据库支持与完整结构维护。
- SSH 隧道、SSL/TLS 连接与通用数据导出（CSV/JSON/SQL/XLSX）。
- 会话监控与 PG schema 语义改进。

### Changed

- 品牌更名 **DBManager → Datanex**：productName、窗口标题、bundle identifier（`com.datanex.desktop`）、本地化文案（标题/欢迎语/许可证/Pro 文案）及全平台应用图标（icns/ico/png/android/ios）全部更新；前端 TopBar 品牌位替换为 Datanex 数据枢纽图形。
- `COMMON_TYPES` 由 `CreateTableDialog` 迁至 `@/lib/db`（与 `ColumnDef`/`DatabaseType` 同处），消除混合导出告警。

### Fixed

- 清理全部 lint 告警（现为 0 warnings / 0 errors）：`highlight.ts` JSON 高亮正则多余转义、`CreateTableDialog` 常量与组件同文件导出。
- e2e `contextmenu` truncate 断言偶发 flake：改为 `expect.poll` 轮询等待 DDL 调用，消除菜单点击后的竞态。

### Testing

- lint 0 errors / 0 warnings；单测 vitest 312/312；Playwright e2e 160/160 全绿（覆盖连接、浏览、表设计、数据操作、迁移、收藏、工具栏等 16 个 spec）。

## [0.1.1] - 2026-08-18

### Fixed

- Cross-connection browse tab handling: switching between Redis and MySQL (or Oracle) connections no longer renders the other connection's SQL preview (e.g. `SELECT * FROM "<redis key>"`). Clicking a connection now restores its last browse tab, falls back to a clean SQL editor when none exists, and a safety invariant guarantees a browse tab bound to a different connection can never remain active.

### Changed

- `loadLicenseStatus()` moved from `LicenseDialog` into `@/lib/db`.
- Excluded Playwright `e2e/*.spec.ts` from vitest collection (unit test run is now ~10s and green).
- CI now runs `npm run lint` and unit tests before the Tauri build.
- Cleaned up all lint warnings (react-hooks exhaustive-deps, unused imports, control-character regex).

### Packaging

- Applications built for macOS (Apple Silicon), Windows x64 (MSI), and Linux (deb + AppImage) are published on the GitHub release page.

## [0.1.0] - 2026-08-10

### Added

- Initial release.