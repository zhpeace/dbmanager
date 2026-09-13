import { describe, it, expect, beforeEach } from "vitest"
import {
  loadPersistedTabs,
  saveTabs,
  serializeTabsForSave,
  TABS_STORAGE_KEY,
} from "../session"

describe("session persistence", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const queryTab = (over: Partial<{ id: string; title: string; sql: string; browse: unknown }> = {}) => ({
    id: over.id ?? "t1",
    title: over.title ?? "查询 1",
    sql: over.sql ?? "SELECT 1",
    filePath: null,
    connectionId: "c1",
    database: { c1: "app" },
    browse: over.browse,
  })

  it("drops browse tabs and keeps query-tab fields on save", () => {
    const tabs = [
      queryTab(),
      queryTab({
        id: "t2",
        title: "表数据",
        browse: { connectionId: "c1", database: "app", table: "users" },
      }),
    ]
    const persisted = serializeTabsForSave(tabs)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toEqual({
      id: "t1",
      title: "查询 1",
      sql: "SELECT 1",
      filePath: null,
      connectionId: "c1",
      database: { c1: "app" },
    })
  })

  it("round-trips through localStorage", () => {
    saveTabs([queryTab()])
    const loaded = loadPersistedTabs()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe("t1")
    expect(loaded[0].sql).toBe("SELECT 1")
    expect(loaded[0].connectionId).toBe("c1")
    expect(loaded[0].database).toEqual({ c1: "app" })
  })

  it("returns [] when nothing is stored", () => {
    expect(loadPersistedTabs()).toEqual([])
  })

  it("tolerates corrupt JSON", () => {
    localStorage.setItem(TABS_STORAGE_KEY, "{not json")
    expect(loadPersistedTabs()).toEqual([])
  })

  it("tolerates non-array storage", () => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ foo: 1 }))
    expect(loadPersistedTabs()).toEqual([])
  })

  it("sanitizes malformed entries and drops empty ones", () => {
    localStorage.setItem(
      TABS_STORAGE_KEY,
      JSON.stringify([
        null,
        { id: "ok", title: "T", sql: "x", filePath: null },
        { id: "no-title-no-sql", title: "", sql: "" },
      ])
    )
    const loaded = loadPersistedTabs()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe("ok")
  })

  it("defaults missing connectionId/database to null/empty", () => {
    localStorage.setItem(
      TABS_STORAGE_KEY,
      JSON.stringify([{ id: "a", title: "t", sql: "s", filePath: "f.sql" }])
    )
    const loaded = loadPersistedTabs()
    expect(loaded[0].connectionId).toBeNull()
    expect(loaded[0].database).toEqual({})
    expect(loaded[0].filePath).toBe("f.sql")
  })
})
