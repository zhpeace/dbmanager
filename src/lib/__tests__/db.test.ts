import { describe, it, expect } from "vitest"
import { buildSelectPreview, quoteIdent } from "@/lib/db"

describe("buildSelectPreview", () => {
  it("uses LIMIT for mysql", () => {
    expect(buildSelectPreview("users", "mysql")).toBe("SELECT * FROM `users` LIMIT 100")
  })

  it("uses LIMIT for postgresql", () => {
    expect(buildSelectPreview("users", "postgresql")).toBe("SELECT * FROM users LIMIT 100")
  })

  it("uses LIMIT for sqlite", () => {
    expect(buildSelectPreview("users", "sqlite")).toBe("SELECT * FROM `users` LIMIT 100")
  })

  it("uses FETCH FIRST for oracle", () => {
    expect(buildSelectPreview("EMP", "oracle")).toBe("SELECT * FROM EMP FETCH FIRST 100 ROWS ONLY")
  })

  it("quotes identifiers containing spaces", () => {
    expect(buildSelectPreview("order items", "mysql")).toBe("SELECT * FROM `order items` LIMIT 100")
  })

  it("quotes mixed-case identifiers for postgres", () => {
    expect(buildSelectPreview("OrderItems", "postgresql")).toBe('SELECT * FROM "OrderItems" LIMIT 100')
  })

  it("supports custom limit", () => {
    expect(buildSelectPreview("users", "mysql", 50)).toBe("SELECT * FROM `users` LIMIT 50")
  })
})

describe("quoteIdent", () => {
  it("quotes schema-qualified names", () => {
    expect(quoteIdent("app.users", "postgresql")).toBe("app.users")
    expect(quoteIdent("Order Table.Items", "postgresql")).toBe('"Order Table"."Items"')
  })
})
