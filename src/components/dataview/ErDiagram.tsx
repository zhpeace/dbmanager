import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import type { SchemaCache, TableSchemaInfo } from "@/lib/db"

interface ErDiagramProps {
  connectionId: string
  database: string
}

interface Box { x: number; y: number; width: number; height: number }

/** Above this table count, default to showing only related tables to stay usable. */
const ER_MAX_TABLES = 120

function layoutTables(tables: TableSchemaInfo[], width: number): Box[] {
  const colW = 240
  const cols = Math.max(2, Math.floor((width - 80) / colW))
  const colHeights = new Array(cols).fill(40)
  return tables.map((t) => {
    const h = 38 + t.columns.length * 20
    const ci = colHeights.indexOf(Math.min(...colHeights))
    const x = 40 + ci * colW
    const y = colHeights[ci]
    colHeights[ci] += h + 20
    return { x, y, width: 220, height: h }
  })
}

/** Memoized table box so viewBox zoom/pan does not re-render every table node. */
const TableNode = memo(function TableNode({
  box, table, columns,
}: {
  box: Box; table: string; columns: TableSchemaInfo["columns"]
}) {
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="6" className="fill-background stroke-border" strokeWidth="1.5" />
      <rect x={box.x} y={box.y} width={box.width} height="28" rx="6" className="fill-primary/10 stroke-border" strokeWidth="1.5" />
      <text x={box.x + box.width / 2} y={box.y + 18} textAnchor="middle" className="fill-foreground" fontSize="12" fontWeight="600">{table}</text>
      {columns.map((col, ci) => (
        <text key={col.name} x={box.x + 8} y={box.y + 46 + ci * 20} className="fill-muted-foreground" fontSize="11">
          {col.key === "PRI" ? "\u{1F511} " : ""}{col.name} : {col.data_type}
        </text>
      ))}
    </g>
  )
})

const FkPath = memo(function FkPath({ d }: { d: string }) {
  return (
    <path d={d} className="stroke-blue-400 fill-none" strokeWidth="1" strokeDasharray="4,2" markerEnd="url(#arrowhead)" />
  )
})

interface ViewBox { x: number; y: number; w: number; h: number }

export function ErDiagram({ connectionId, database }: ErDiagramProps) {
  const { t } = useTranslation()
  const [schema, setSchema] = useState<SchemaCache | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [filter, setFilter] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 100, h: 100 })

  const dragRef = useRef<{ startX: number; startY: number; vb: ViewBox; active: boolean }>({
    startX: 0, startY: 0, vb: { x: 0, y: 0, w: 0, h: 0 }, active: false,
  })

  const overLimit = !!schema && schema.tables.length > ER_MAX_TABLES

  const related = useMemo(() => {
    if (!schema) return new Set<string>()
    const s = new Set<string>()
    for (const tb of schema.tables) {
      if (tb.foreign_keys.length > 0) s.add(tb.table)
      for (const fk of tb.foreign_keys) s.add(fk.ref_table)
    }
    return s
  }, [schema])

  const displayTables = useMemo(() => {
    if (!schema) return []
    const kw = filter.trim().toLowerCase()
    // 搜索模式：匹配表 + 它们的一跳外键关联表（双向）
    if (kw) {
      const matched = schema.tables.filter((tb) => tb.table.toLowerCase().includes(kw))
      if (matched.length === 0) return []
      const mset = new Set(matched.map((tb) => tb.table))
      const hops = new Set<string>()
      for (const tb of schema.tables) {
        if (mset.has(tb.table)) for (const fk of tb.foreign_keys) hops.add(fk.ref_table)
        for (const fk of tb.foreign_keys) if (mset.has(fk.ref_table)) hops.add(tb.table)
      }
      const keep = new Set([...mset, ...hops])
      return schema.tables.filter((tb) => keep.has(tb.table))
    }
    if (showAll || !overLimit) return schema.tables
    const rel = schema.tables.filter((tb) => related.has(tb.table))
    if (rel.length === 0) return schema.tables.slice(0, ER_MAX_TABLES)
    // 稠密大库：关联表仍超限时截断，防止渲染卡顿
    return rel.length > ER_MAX_TABLES ? rel.slice(0, ER_MAX_TABLES) : rel
  }, [schema, showAll, overLimit, related, filter])

  const boxes = useMemo(() => layoutTables(displayTables, window.innerWidth), [displayTables])

  const tableIndex = useMemo(() => {
    const m = new Map<string, number>()
    displayTables.forEach((tb, i) => m.set(tb.table, i))
    return m
  }, [displayTables])

  const totalW = useMemo(() => {
    if (boxes.length === 0) return 100
    return Math.max(...boxes.map(b => b.x + b.width)) + 80
  }, [boxes])

  useEffect(() => {
    invoke<SchemaCache>("get_schema_cache", { id: connectionId, database })
      .then(setSchema)
      .catch((e: any) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [connectionId, database])

  useEffect(() => {
    if (!schema || displayTables.length === 0 || !containerRef.current) return
    const bs = layoutTables(displayTables, containerRef.current.clientWidth)
    const cw = Math.max(...bs.map(b => b.x + b.width)) + 80
    const ch = Math.max(...bs.map(b => b.y + b.height)) + 80
    setVb({ x: 0, y: 0, w: cw, h: ch })
  }, [schema, displayTables])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * vb.w + vb.x
    const my = ((e.clientY - rect.top) / rect.height) * vb.h + vb.y
    const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25
    const newW = Math.max(20, Math.min(totalW * 10, vb.w * factor))
    const newH = newW * (vb.h / vb.w)
    setVb({
      x: mx - (mx - vb.x) * (newW / vb.w),
      y: my - (my - vb.y) * (newH / vb.h),
      w: newW, h: newH,
    })
  }, [vb, totalW])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      vb: { ...vb },
      active: true,
    }
  }, [vb])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.active) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    setVb({
      x: dragRef.current.vb.x - (e.clientX - dragRef.current.startX) / rect.width * vb.w,
      y: dragRef.current.vb.y - (e.clientY - dragRef.current.startY) / rect.height * vb.h,
      w: vb.w, h: vb.h,
    })
  }, [vb])

  const onMouseUp = useCallback(() => {
    dragRef.current.active = false
  }, [])

  if (loading) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">{t('erdiagram.loading')}</div>
  if (error) return <div className="flex items-center justify-center h-full text-xs text-destructive">{error}</div>
  if (!schema || schema.tables.length === 0) return <div className="flex items-center justify-center h-full text-xs text-muted-foreground">{t('erdiagram.no_tables')}</div>

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden">
      <div className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-2 rounded-md bg-background/95 border px-2.5 py-1.5 text-xs shadow-sm">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('erdiagram.filter_placeholder')}
          className="w-44 rounded border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
        />
        {filter.trim() ? (
          <>
            <span className="text-muted-foreground">
              {t('erdiagram.filter_count', { shown: displayTables.length })}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setFilter("")}
            >
              ✕
            </button>
          </>
        ) : overLimit ? (
          <>
            <span className="text-muted-foreground">
              {t('erdiagram.table_count', { total: schema.tables.length, shown: displayTables.length })}
            </span>
            {!showAll && displayTables.length >= ER_MAX_TABLES && (
              <span className="text-amber-600">{t('erdiagram.truncated')}</span>
            )}
            <button
              type="button"
              className="text-primary font-medium hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? t('erdiagram.show_related') : t('erdiagram.show_all')}
            </button>
          </>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ cursor: dragRef.current.active ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" className="fill-blue-400" />
          </marker>
        </defs>
        {displayTables.map((tb, i) => (
          <TableNode key={tb.table} box={boxes[i]} table={tb.table} columns={tb.columns} />
        ))}
        {displayTables.flatMap((tb, i) =>
          tb.foreign_keys.map((fk, fi) => {
            const targetIdx = tableIndex.get(fk.ref_table)
            if (targetIdx === undefined) return null
            const src = boxes[i]
            const dst = boxes[targetIdx]
            const srcColIdx = tb.columns.findIndex(c => c.name === fk.column_name)
            const dstColIdx = displayTables[targetIdx].columns.findIndex(c => c.name === fk.ref_column)
            const x1 = src.x + src.width
            const y1 = src.y + 46 + srcColIdx * 20
            const x2 = dst.x
            const y2 = dst.y + 46 + dstColIdx * 20
            const cx = (x1 + x2) / 2
            return (
              <FkPath
                key={`fk-${i}-${fi}`}
                d={`M${x1} ${y1} Q${cx} ${y1} ${cx} ${(y1 + y2) / 2} Q${cx} ${y2} ${x2} ${y2}`}
              />
            )
          })
        )}
      </svg>
    </div>
  )
}
