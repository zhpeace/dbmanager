import { describe, it, expect } from "vitest"
import {
  splitSqlStatements,
  statementAtOffset,
  formatSql,
  buildExplainSql,
  parseErrorLine,
  toCsv,
  toJson,
  toInsert,
  toUpdate,
  toggleComment,
} from "@/lib/sql"

describe("splitSqlStatements", () => {
  it("splits on semicolons", () => {
    const stmts = splitSqlStatements("SELECT 1; SELECT 2;")
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 1", "SELECT 2"])
  })

  it("ignores semicolons inside string literals", () => {
    const stmts = splitSqlStatements("SELECT 'a;b'; SELECT 2")
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 'a;b'", "SELECT 2"])
  })

  it("ignores semicolons inside comments", () => {
    const stmts = splitSqlStatements("SELECT 1; -- foo;bar\nSELECT 2 /* ; */;")
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 1", "-- foo;bar\nSELECT 2 /* ; */"])
  })

  it("handles escaped quotes", () => {
    const stmts = splitSqlStatements("SELECT 'it''s; ok'; SELECT 2")
    expect(stmts.map((s) => s.text)).toEqual(["SELECT 'it''s; ok'", "SELECT 2"])
  })

  it("keeps BEGIN...END routines intact", () => {
    const sql =
      "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END; SELECT 3;"
    const stmts = splitSqlStatements(sql)
    expect(stmts).toHaveLength(2)
    expect(stmts[0].text).toContain("BEGIN")
    expect(stmts[0].text).toContain("END")
    expect(stmts[1].text).toBe("SELECT 3")
  })

  it("reports startLine correctly", () => {
    const stmts = splitSqlStatements("SELECT 1;\n\nSELECT 2;")
    expect(stmts.map((s) => s.startLine)).toEqual([1, 3])
  })
})

describe("statementAtOffset", () => {
  const sql = "SELECT 1;\nSELECT 2;\nSELECT 3;"
  it("finds the statement under an offset", () => {
    expect(statementAtOffset(sql, 12)?.text).toBe("SELECT 2")
    expect(statementAtOffset(sql, 0)?.text).toBe("SELECT 1")
    expect(statementAtOffset(sql, sql.length)?.text).toBe("SELECT 3")
  })
})

describe("formatSql", () => {
  it("formats basic select with sql-formatter", () => {
    const out = formatSql("select id from users where id=1", "mysql")
    expect(out).toContain("SELECT")
    expect(out).toContain("FROM")
  })

  it("uses plsql language for oracle", () => {
    const out = formatSql("select * from emp", "oracle")
    expect(out).toContain("FROM")
  })

  it("falls back gracefully on bad input", () => {
    expect(() => formatSql("", "mysql")).not.toThrow()
  })
})

describe("buildExplainSql", () => {
  it("prepends EXPLAIN for mysql/pg", () => {
    expect(buildExplainSql("mysql", "SELECT 1")).toBe("EXPLAIN SELECT 1")
    expect(buildExplainSql("postgresql", "SELECT 1")).toBe("EXPLAIN SELECT 1")
  })

  it("uses EXPLAIN QUERY PLAN for sqlite", () => {
    expect(buildExplainSql("sqlite", "SELECT 1")).toBe("EXPLAIN QUERY PLAN SELECT 1")
  })

  it("uses EXPLAIN PLAN FOR + dbms_xplan for oracle", () => {
    const out = buildExplainSql("oracle", "SELECT 1")
    expect(out).toContain("EXPLAIN PLAN FOR SELECT 1")
    expect(out).toContain("DBMS_XPLAN.DISPLAY")
  })

  it("returns empty for unsupported types", () => {
    expect(buildExplainSql("redis", "SELECT 1")).toBe("")
  })
})

describe("parseErrorLine", () => {
  it("parses mysql 'at line N'", () => {
    expect(parseErrorLine("syntax error near 'x' at line 3", "mysql")).toBe(3)
  })

  it("parses postgres 'LINE N'", () => {
    expect(parseErrorLine("ERROR: syntax error at or near \"x\"\nLINE 2: select from", "postgresql")).toBe(2)
  })

  it("returns null when no line info", () => {
    expect(parseErrorLine("ORA-00933: SQL command not properly ended", "oracle")).toBeNull()
  })
})

describe("toCsv", () => {
  it("escapes commas and quotes", () => {
    const csv = toCsv(["a", "b"], [{ a: 'x,y', b: 'say "hi"' }])
    expect(csv).toContain('"x,y"')
    expect(csv).toContain('"say ""hi"""')
  })

  it("handles nulls as empty", () => {
    const csv = toCsv(["a"], [{ a: null }])
    expect(csv).toBe("a\n")
  })
})

describe("toJson", () => {
  it("serializes rows", () => {
    const json = toJson([{ a: 1 }])
    expect(JSON.parse(json)).toEqual([{ a: 1 }])
  })
})

describe("toInsert", () => {
  it("generates insert statement with escaped values", () => {
    const sql = toInsert("users", ["id", "name"], [{ id: 1, name: "O'Brien" }, { id: 2, name: null }])
    expect(sql).toContain("INSERT INTO `users` (`id`, `name`) VALUES")
    expect(sql).toContain("(1, 'O''Brien')")
    expect(sql).toContain("(2, NULL)")
    expect(sql.endsWith(";")).toBe(true)
  })

  it("chunks batches of rows into multiple inserts", () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: i }))
    const sql = toInsert("t", ["id"], rows)
    expect(sql.match(/INSERT INTO/g)?.length).toBe(2)
  })

  it("returns empty string when no columns", () => {
    expect(toInsert("t", [], [{}])).toBe("")
  })
})

describe("toUpdate", () => {
  it("generates update statement with all columns in set", () => {
    const sql = toUpdate("users", ["id", "name"], { id: 1, name: "O'Brien" }, ["id"])
    expect(sql).toBe(
      "UPDATE `users` SET `id` = 1, `name` = 'O''Brien' WHERE `id` = 1;"
    )
  })

  it("falls back to all columns when no primary keys given", () => {
    const sql = toUpdate("t", ["a", "b"], { a: 1, b: 2 })
    expect(sql).toContain("WHERE `a` = 1 AND `b` = 2")
  })

  it("escapes nulls as NULL", () => {
    const sql = toUpdate("t", ["a"], { a: null }, ["a"])
    expect(sql).toContain("SET `a` = NULL")
    expect(sql).toContain("WHERE `a` = NULL")
  })
})

describe("toggleComment", () => {
  it("adds comments to lines", () => {
    expect(toggleComment("SELECT 1")).toBe("-- SELECT 1")
  })

  it("removes comments when all lines are commented", () => {
    expect(toggleComment("-- SELECT 1")).toBe("SELECT 1")
  })
})
