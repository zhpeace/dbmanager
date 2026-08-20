// oxlint-disable react/only-export-components
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight, ChevronDown } from "lucide-react"

export interface PlanNode {
  label: string
  children: PlanNode[]
}

export function parsePlanResult(columns: string[], rows: Record<string, unknown>[]): PlanNode[] | null {
  if (rows.length === 0) return null

  // PostgreSQL / MySQL FORMAT=TREE produce indented text lines.
  const textRows = rows.map((r) => {
    const v = r[columns[0]]
    return typeof v === "string" ? v : String(v ?? "")
  })
  if (textRows.some((l) => /^\s+\S/.test(l))) {
    return parseIndented(textRows)
  }

  const lower = columns.map((c) => c.toLowerCase())
  const get = (r: Record<string, unknown>, name: string) => {
    const i = lower.indexOf(name.toLowerCase())
    return i >= 0 ? r[columns[i]] : undefined
  }

  // SQLite EXPLAIN QUERY PLAN: id, parent, notused, detail.
  if (lower.includes("parent") && lower.includes("detail")) {
    const nodes = rows.map((r, i) => ({
      i,
      id: Number(get(r, "id") ?? i),
      parent: Number(get(r, "parent") ?? -1),
      label: String(get(r, "detail") ?? ""),
      children: [] as PlanNode[],
    }))
    const byId = new Map<number, (typeof nodes)[number]>()
    nodes.forEach((n) => byId.set(n.id, n))
    const roots: PlanNode[] = []
    for (const n of nodes) {
      if (n.parent >= 0 && byId.has(n.parent)) {
        byId.get(n.parent)!.children.push(n)
      } else {
        roots.push(n)
      }
    }
    return roots
  }

  // MySQL classic EXPLAIN: rows with id, table, type, key, rows, extra.
  if (lower.includes("id") && lower.includes("table")) {
    const roots: PlanNode[] = []
    const lastGroup = new Map<number, PlanNode>()
    for (const r of rows) {
      const id = Number(get(r, "id") ?? 0)
      const table = String(get(r, "table") ?? "")
      const parts: string[] = []
      const type = get(r, "type")
      if (type !== undefined && String(type) !== "") parts.push(String(type))
      const key = get(r, "key")
      if (key !== undefined && String(key) !== "") parts.push(`key=${key}`)
      const rw = get(r, "rows")
      if (rw !== undefined && String(rw) !== "") parts.push(`rows=${rw}`)
      const extra = get(r, "extra")
      if (extra !== undefined && String(extra) !== "") parts.push(String(extra))
      const node: PlanNode = { label: parts.length ? `${table} (${parts.join(", ")})` : table, children: [] }
      if (lastGroup.has(id)) {
        lastGroup.get(id)!.children.push(node)
      } else {
        roots.push(node)
        lastGroup.set(id, node)
      }
    }
    return roots
  }

  return null
}

function parseIndented(lines: string[]): PlanNode[] {
  const root: PlanNode = { label: "__root__", children: [] }
  const stack: Array<{ depth: number; node: PlanNode }> = [{ depth: -1, node: root }]
  for (const line of lines) {
    if (!line.trim()) continue
    const indent = line.length - line.trimStart().length
    const node: PlanNode = { label: line.trim(), children: [] }
    while (stack.length > 1 && stack[stack.length - 1].depth >= indent) {
      stack.pop()
    }
    stack[stack.length - 1].node.children.push(node)
    stack.push({ depth: indent, node })
  }
  return root.children
}

function PlanTree({ nodes }: { nodes: PlanNode[] }) {
  return (
    <ul className="space-y-1">
      {nodes.map((node, i) => (
        <PlanTreeNode key={i} node={node} />
      ))}
    </ul>
  )
}

function PlanTreeNode({ node }: { node: PlanNode }) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0
  return (
    <li>
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <button className="mt-0.5" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-xs font-mono whitespace-pre-wrap break-all">{node.label}</span>
      </div>
      {hasChildren && open && (
        <div className="ml-4 border-l border-border/60 pl-2 mt-1">
          <PlanTree nodes={node.children} />
        </div>
      )}
    </li>
  )
}

export function PlanView({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const { t } = useTranslation()
  const nodes = useMemo(() => parsePlanResult(columns, rows), [columns, rows])

  if (!nodes || nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {t('plan.unavailable')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3">
      <PlanTree nodes={nodes} />
    </div>
  )
}
