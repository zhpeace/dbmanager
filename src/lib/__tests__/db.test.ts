import { describe, it, expect } from "vitest"
import { buildSelectPreview, quoteIdent, temporalKind, isStructuredTextType } from "@/lib/db"

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

describe("temporalKind", () => {
  it("classifies date/time/timestamp columns", () => {
    expect(temporalKind("date")).toBe("date")
    expect(temporalKind("datetime")).toBe("datetime")
    expect(temporalKind("timestamp")).toBe("datetime")
    expect(temporalKind("TIME")).toBe("time")
    expect(temporalKind("timestamptz")).toBe("datetime")
  })
  it("returns null for non-temporal types", () => {
    expect(temporalKind("varchar")).toBeNull()
    expect(temporalKind("bigint")).toBeNull()
    expect(temporalKind(undefined)).toBeNull()
  })
})

describe("isStructuredTextType", () => {
  it("detects CLOB / long text / xml / json family by type", () => {
    expect(isStructuredTextType("longtext")).toBe(true)
    expect(isStructuredTextType("mediumtext")).toBe(true)
    expect(isStructuredTextType("clob")).toBe(true)
    expect(isStructuredTextType("nclob")).toBe(true)
    expect(isStructuredTextType("xml")).toBe(true)
    expect(isStructuredTextType("json")).toBe(true)
    expect(isStructuredTextType("jsonb")).toBe(true)
  })
  it("does not force ordinary string types into the editor", () => {
    expect(isStructuredTextType("varchar")).toBe(false)
    expect(isStructuredTextType("text")).toBe(false)
    expect(isStructuredTextType("char")).toBe(false)
    expect(isStructuredTextType(undefined)).toBe(false)
  })
})
