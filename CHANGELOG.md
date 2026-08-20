# Changelog

All notable changes to this project are documented in this file.

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