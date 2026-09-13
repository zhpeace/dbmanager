// Session persistence: remember the user's query tabs (title, SQL text and
// connection/database binding) across app restarts — Navicat-style "restore
// last session". Browse tabs, query results and transient error fields are
// intentionally NOT persisted (results are re-run, not restored).

export interface PersistedTab {
  id: string
  title: string
  sql: string
  filePath: string | null
  connectionId?: string | null
  database?: Record<string, string | null>
}

/** Minimal structural shape accepted by the serializer (App's tab objects). */
export interface SessionTabInput {
  id: string
  title: string
  sql: string
  filePath: string | null
  browse?: unknown
  connectionId?: string | null
  database?: Record<string, string | null>
}

export const TABS_STORAGE_KEY = "dbmanager-tabs"

/** Load persisted query tabs; tolerant of missing/corrupt storage. */
export function loadPersistedTabs(): PersistedTab[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        id: typeof t.id === "string" && t.id ? t.id : crypto.randomUUID(),
        title: typeof t.title === "string" ? t.title : "",
        sql: typeof t.sql === "string" ? t.sql : "",
        filePath: typeof t.filePath === "string" ? t.filePath : null,
        connectionId: typeof t.connectionId === "string" ? t.connectionId : null,
        database:
          t.database && typeof t.database === "object"
            ? (t.database as Record<string, string | null>)
            : {},
      }))
      .filter((t) => t.title !== "" || t.sql !== "")
  } catch {
    return []
  }
}

/** Reduce live tabs to the persisted shape (browse tabs are dropped). */
export function serializeTabsForSave(tabs: SessionTabInput[]): PersistedTab[] {
  return tabs
    .filter((tb) => !tb.browse)
    .map((tb) => ({
      id: tb.id,
      title: tb.title,
      sql: tb.sql,
      filePath: tb.filePath ?? null,
      connectionId: tb.connectionId ?? null,
      database: tb.database ?? {},
    }))
}

/** Persist query tabs to localStorage (best-effort). */
export function saveTabs(tabs: SessionTabInput[]): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(serializeTabsForSave(tabs)))
  } catch {
    // storage full / unavailable: session restore silently degrades to default
  }
}
