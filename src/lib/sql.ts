import { format } from "sql-formatter"

export interface SqlStatement {
  text: string
  start: number
  end: number
  startLine: number
}

const QUOTES = ["'", '"', "`"]

function isQuote(c: string): boolean {
  return QUOTES.includes(c)
}

function maskQuotesAndComments(sql: string): string {
  let masked = ""
  const n = sql.length
  let k = 0
  while (k < n) {
    const c = sql[k]
    const next = sql[k + 1]
    if (isQuote(c)) {
      masked += c
      k++
      while (k < n) {
        const qc = sql[k]
        const qn = sql[k + 1]
        if (qc === "\\") {
          masked += "  "
          k += 2
          continue
        }
        if (qc === c) {
          if (qn === c) {
            masked += "  "
            k += 2
            continue
          }
          masked += c
          k++
          break
        }
        masked += qc === "\n" ? "\n" : " "
        k++
      }
      continue
    }
    if (c === "-" && next === "-") {
      masked += "  "
      k += 2
      while (k < n && sql[k] !== "\n") {
        masked += " "
        k++
      }
      continue
    }
    if (c === "#") {
      masked += " "
      k++
      while (k < n && sql[k] !== "\n") {
        masked += " "
        k++
      }
      continue
    }
    if (c === "/" && next === "*") {
      masked += "  "
      k += 2
      while (k + 1 < n) {
        if (sql[k] === "*" && sql[k + 1] === "/") {
          masked += "  "
          k += 2
          break
        }
        masked += sql[k] === "\n" ? "\n" : " "
        k++
      }
      continue
    }
    masked += c
    k++
  }
  return masked
}

export function splitSqlStatements(sql: string): SqlStatement[] {
  const masked = maskQuotesAndComments(sql)
  const n = sql.length
  const statements: SqlStatement[] = []
  const enableDepth = /\bBEGIN\b/i.test(masked)

  function push(start: number, end: number) {
    const s = sql.slice(start, end)
    const text = s.trim()
    if (!text) return
    const lead = s.length - s.trimStart().length
    const line = sql.slice(0, start + lead).split("\n").length
    statements.push({ text, start: start + lead, end, startLine: line })
  }

  let depth = 0
  let start = 0
  let k = 0
  while (k <= n) {
    const c = k < n ? masked[k] : ";"
    if (enableDepth && k < n && /[A-Za-z]/.test(c)) {
      const m = masked.slice(k).match(/^[A-Za-z_][A-Za-z0-9_]*/)
      if (m) {
        const kw = m[0].toUpperCase()
        if (kw === "BEGIN") depth++
        else if (kw === "END") depth = Math.max(0, depth - 1)
        k += m[0].length
        continue
      }
    }
    if (c === ";") {
      if (depth === 0) {
        push(start, k)
        start = k + 1
      }
    }
    k++
  }
  if (start < n) {
    push(start, n)
  }
  return statements
}

export function statementAtOffset(sql: string, offset: number): SqlStatement | null {
  const statements = splitSqlStatements(sql)
  let fallback: SqlStatement | null = null
  for (const s of statements) {
    if (offset >= s.start && offset <= s.end) return s
    if (offset < s.start) {
      if (!fallback) fallback = s
      break
    }
    fallback = s
  }
  return fallback
}

function formatterLanguage(dbType: string): string {
  switch (dbType) {
    case "mysql":
      return "mysql"
    case "postgresql":
      return "postgresql"
    case "sqlite":
      return "sqlite"
    case "oracle":
      return "plsql"
    default:
      return "sql"
  }
}

function fallbackFormat(sql: string): string {
  const clauseBreaks = [
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP BY",
    "ORDER BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "UNION",
    "UNION ALL",
    "JOIN",
    "INNER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "FULL JOIN",
    "ON",
    "AND",
    "OR",
    "INSERT INTO",
    "VALUES",
    "UPDATE",
    "SET",
    "DELETE FROM",
  ]
  let out = sql
  for (const kw of clauseBreaks) {
    const re = new RegExp("\\s+" + kw.replace(/ /g, "\\s+") + "\\b", "gi")
    out = out.replace(re, "\n" + kw)
  }
  const lines = out
    .split("\n")
    .map((l, i) => (i === 0 ? l.trim() : "  " + l.trim()))
  return lines.join("\n")
}

export function formatSql(sql: string, dbType: string): string {
  try {
    return format(sql, {
      language: formatterLanguage(dbType) as never,
      keywordCase: "upper",
      tabWidth: 2,
      linesBetweenQueries: 2,
      denseOperators: true,
    })
  } catch {
    return fallbackFormat(sql)
  }
}

export function buildExplainSql(dbType: string, sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ""
  switch (dbType) {
    case "mysql":
      return `EXPLAIN ${trimmed}`
    case "postgresql":
      return `EXPLAIN ${trimmed}`
    case "sqlite":
      return `EXPLAIN QUERY PLAN ${trimmed}`
    case "oracle":
      return `EXPLAIN PLAN FOR ${trimmed};\nSELECT * FROM TABLE(DBMS_XPLAN.DISPLAY)`
    default:
      return ""
  }
}

export interface ErrorLocation {
  line: number
  message: string
}

export function parseErrorLine(error: string, dbType: string): number | null {
  let m = error.match(/at line (\d+)/i)
  if (m) return parseInt(m[1], 10)
  m = error.match(/\bLINE (\d+)\b/i)
  if (m) return parseInt(m[1], 10)
  m = error.match(/\bline (\d+)\b/i)
  if (m && /sqlite|sql/i.test(dbType)) return parseInt(m[1], 10)
  return null
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ""
    const s = typeof v === "string" ? v : JSON.stringify(v)
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const header = columns.map(esc).join(",")
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(","))
  return [header, ...body].join("\n")
}

export function toJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2)
}

export function toInsert(table: string, columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0) return ""
  const colList = columns.map((c) => `\`${c.replace(/`/g, "``")}\``).join(", ")
  const lit = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL"
    if (typeof v === "number" && Number.isFinite(v)) return String(v)
    if (typeof v === "boolean") return v ? "1" : "0"
    if (v instanceof Date) return "'" + v.toISOString().replace("T", " ").slice(0, 19) + "'"
    const s = typeof v === "string" ? v : JSON.stringify(v)
    return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'"
  }
  const values = rows.map((r) => `(${columns.map((c) => lit(r[c])).join(", ")})`)
  const chunks: string[] = []
  for (let i = 0; i < values.length; i += 100) {
    const slice = values.slice(i, i + 100).join(",\n  ")
    chunks.push(`INSERT INTO \`${table.replace(/`/g, "``")}\` (${colList}) VALUES\n  ${slice};`)
  }
  return chunks.join("\n")
}

export function toUpdate(
  table: string,
  columns: string[],
  row: Record<string, unknown>,
  primaryKeys: string[] = []
): string {
  if (columns.length === 0) return ""
  const lit = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL"
    if (typeof v === "number" && Number.isFinite(v)) return String(v)
    if (typeof v === "boolean") return v ? "1" : "0"
    if (v instanceof Date) return "'" + v.toISOString().replace("T", " ").slice(0, 19) + "'"
    const s = typeof v === "string" ? v : JSON.stringify(v)
    return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'"
  }
  const setParts = columns.map((c) => `\`${c.replace(/`/g, "``")}\` = ${lit(row[c])}`)
  const pkCols = primaryKeys.length > 0 ? primaryKeys : columns
  const whereParts = pkCols.map((c) => `\`${c.replace(/`/g, "``")}\` = ${lit(row[c])}`)
  return `UPDATE \`${table.replace(/`/g, "``")}\` SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")};`
}

export function toggleComment(sql: string): string {
  const lines = sql.split("\n")
  const allCommented = lines.every((l) => l.trim().startsWith("--"))
  if (allCommented && lines.length > 0) {
    return lines.map((l) => l.replace(/^\s*--\s?/, "")).join("\n")
  }
  return lines.map((l) => (l.trim() ? `-- ${l}` : l)).join("\n")
}
