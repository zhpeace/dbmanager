import { SQL_SNIPPETS } from "../snippets"

describe("SQL_SNIPPETS", () => {
  it("defines common snippets with names", () => {
    expect(SQL_SNIPPETS.length).toBeGreaterThanOrEqual(10)
    const names = SQL_SNIPPETS.map((s) => s.name)
    expect(names).toContain("SELECT * FROM")
    expect(names).toContain("INSERT INTO")
    expect(names).toContain("UPDATE")
    expect(names).toContain("DELETE FROM")
  })

  it("every snippet has a non-empty description and sql", () => {
    for (const s of SQL_SNIPPETS) {
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.sql.length).toBeGreaterThan(0)
    }
  })
})
