import { describe, it, expect } from "vitest"
import { computeBulkValue, evalBulkExpression, parseTsvGrid, buildTsvGrid, type BulkEditApply } from "../bulkEdit"

function spec(partial: Partial<BulkEditApply>): BulkEditApply {
  return { column: "name", mode: "constant", value: "", seqStart: 1, seqStep: 1, ...partial }
}

describe("computeBulkValue", () => {
  it("constant keeps the literal value", () => {
    expect(computeBulkValue("old", spec({ mode: "constant", value: "new" }), 0)).toEqual({ value: "new" })
  })

  it("expression computes against the original numeric value", () => {
    expect(computeBulkValue(10, spec({ mode: "expression", value: "原值+1" }), 0)).toEqual({ value: 11 })
    expect(computeBulkValue(100, spec({ mode: "expression", value: "原值*0.9" }), 0)).toEqual({ value: 90 })
    expect(computeBulkValue("50", spec({ mode: "expression", value: "原值*2" }), 0)).toEqual({ value: 100 })
  })

  it("expression tolerates a leading =", () => {
    expect(evalBulkExpression(5, "=原值+2")).toBe(7)
  })

  it("expression rejects non-numeric original and reports an error", () => {
    const res = computeBulkValue("abc", spec({ mode: "expression", value: "原值+1" }), 0)
    expect(res.error).toBeTruthy()
  })

  it("expression rejects arbitrary code", () => {
    expect(() => evalBulkExpression(1, "原值; window.x=1")).toThrow()
    expect(() => evalBulkExpression(1, "process.exit()")).toThrow()
  })

  it("now returns a local datetime string", () => {
    const res = computeBulkValue(null, spec({ mode: "now" }), 0)
    expect(typeof res.value).toBe("string")
    expect(res.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it("uuid returns a UUID-like string", () => {
    const res = computeBulkValue(null, spec({ mode: "uuid" }), 0)
    expect(typeof res.value).toBe("string")
    expect(String(res.value)).toMatch(/^[0-9a-f-]{8,36}$/i)
  })

  it("null mode returns null", () => {
    expect(computeBulkValue("x", spec({ mode: "null" }), 0)).toEqual({ value: null })
  })

  it("sequence starts at seqStart and steps per position", () => {
    expect(computeBulkValue(null, spec({ mode: "sequence", seqStart: 10, seqStep: 5 }), 0)).toEqual({ value: 10 })
    expect(computeBulkValue(null, spec({ mode: "sequence", seqStart: 10, seqStep: 5 }), 2)).toEqual({ value: 20 })
  })
})

describe("TSV grid helpers", () => {
  it("parses Excel-style TSV (rows newline, cols tab)", () => {
    expect(parseTsvGrid("张三\tactive\n李四\tinactive")).toEqual([
      ["张三", "active"],
      ["李四", "inactive"],
    ])
  })

  it("handles CRLF and trailing empty line", () => {
    expect(parseTsvGrid("a\tb\r\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
      [""],
    ])
  })

  it("builds TSV with null/undefined as empty cells", () => {
    expect(buildTsvGrid([[1, null], ["x", undefined]])).toBe("1\t\nx\t")
  })
})
