import { parsePlanResult } from "../PlanView"

describe("parsePlanResult", () => {
  it("parses indented tree plans (PostgreSQL/MySQL FORMAT=TREE)", () => {
    const rows = [
      { "QUERY PLAN": "Nested Loop  (cost=0.00..1.00 rows=1 width=8)" },
      { "QUERY PLAN": "  -> Seq Scan on a  (cost=0.00..1.00 rows=1 width=4)" },
      { "QUERY PLAN": "  -> Index Scan using b_pkey on b  (cost=0.00..0.00 rows=1 width=4)" },
    ]
    const nodes = parsePlanResult(["QUERY PLAN"], rows)!
    expect(nodes.length).toBe(1)
    expect(nodes[0].label).toContain("Nested Loop")
    expect(nodes[0].children.length).toBe(2)
    expect(nodes[0].children[0].label).toContain("Seq Scan on a")
  })

  it("parses SQLite EXPLAIN QUERY PLAN by parent", () => {
    const rows = [
      { id: 3, parent: 0, notused: 0, detail: "SCAN TABLE users" },
      { id: 4, parent: 0, notused: 0, detail: "SEARCH t USING INDEX t_pk (id=?)" },
      { id: 0, parent: -1, notused: 0, detail: "MERGE (co-routine?)" },
    ]
    const nodes = parsePlanResult(["id", "parent", "notused", "detail"], rows)!
    expect(nodes.length).toBe(1)
    expect(nodes[0].label).toContain("MERGE")
    expect(nodes[0].children.length).toBe(2)
  })

  it("parses MySQL classic EXPLAIN grouping by id", () => {
    const rows = [
      { id: 1, select_type: "PRIMARY", table: "users", type: "ALL", key: null, rows: 10, extra: "Using where" },
      { id: 1, select_type: "SUBQUERY", table: "orders", type: "index", key: "idx", rows: 5, extra: "Using index" },
      { id: 2, select_type: "DERIVED", table: "items", type: "eq_ref", key: "PRIMARY", rows: 1, extra: "" },
    ]
    const nodes = parsePlanResult(
      ["id", "select_type", "table", "type", "key", "rows", "extra"],
      rows,
    )!
    expect(nodes.length).toBe(2)
    expect(nodes[0].label).toContain("users")
    expect(nodes[0].label).toContain("ALL")
    expect(nodes[0].children.length).toBe(1)
    expect(nodes[0].children[0].label).toContain("orders")
    expect(nodes[1].label).toContain("items")
  })

  it("returns null for empty rows", () => {
    expect(parsePlanResult(["a"], [])).toBeNull()
  })

  it("returns null for non-plan tabular data", () => {
    const nodes = parsePlanResult(["a", "b"], [{ a: 1, b: 2 }])
    expect(nodes).toBeNull()
  })
})
