import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import type { SchemaCache } from "@/lib/db"

interface ErDiagramProps {
  connectionId: string
  database: string
}

interface Box { x: number; y: number; width: number; height: number }

function layoutTables(schema: SchemaCache, width: number): Box[] {
  const colW = 240
  const cols = Math.max(2, Math.floor((width - 80) / colW))
  const colHeights = new Array(cols).fill(40)
  return schema.tables.map((t) => {
    const h = 38 + t.columns.length * 20
    const ci = colHeights.indexOf(Math.min(...colHeights))
    const x = 40 + ci * colW
    const y = colHeights[ci]
    colHeights[ci] += h + 20
    return { x, y, width: 220, height: h }
  })
}

export function ErDiagram({ connectionId, database }: ErDiagramProps) {
  const { t } = useTranslation()
  const [schema, setSchema] = useState<SchemaCache | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 100, h: 100 })

  const dragRef = useRef<{ startX: number; startY: number; vb: ViewBox; active: boolean }>({
    startX: 0, startY: 0, vb: { x: 0, y: 0, w: 0, h: 0 }, active: false,
  })

  const boxes = useMemo(() => {
    if (!schema) return []
    return layoutTables(schema, window.innerWidth)
  }, [schema])

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
    if (!schema || schema.tables.length === 0 || !containerRef.current) return
    const bs = layoutTables(schema, containerRef.current.clientWidth)
    const cw = Math.max(...bs.map(b => b.x + b.width)) + 80
    const ch = Math.max(...bs.map(b => b.y + b.height)) + 80
    setVb({ x: 0, y: 0, w: cw, h: ch })
  }, [schema])

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
    <div ref={containerRef} className="h-full overflow-hidden">
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
        {schema.tables.map((t, i) => {
          const box = boxes[i]
          return (
            <g key={t.table}>
              <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="6" className="fill-background stroke-border" strokeWidth="1.5" />
              <rect x={box.x} y={box.y} width={box.width} height="28" rx="6" className="fill-primary/10 stroke-border" strokeWidth="1.5" />
              <text x={box.x + box.width / 2} y={box.y + 18} textAnchor="middle" className="fill-foreground" fontSize="12" fontWeight="600">{t.table}</text>
              {t.columns.map((col, ci) => (
                <text key={col.name} x={box.x + 8} y={box.y + 46 + ci * 20} className="fill-muted-foreground" fontSize="11">
                  {col.key === "PRI" ? "\u{1F511} " : ""}{col.name} : {col.data_type}
                </text>
              ))}
            </g>
          )
        })}
        {schema.tables.flatMap((t, i) =>
          t.foreign_keys.map((fk, fi) => {
            const targetIdx = schema.tables.findIndex(st => st.table === fk.ref_table)
            if (targetIdx === -1) return null
            const src = boxes[i]
            const dst = boxes[targetIdx]
            const srcColIdx = t.columns.findIndex(c => c.name === fk.column_name)
            const dstColIdx = schema.tables[targetIdx].columns.findIndex(c => c.name === fk.ref_column)
            const x1 = src.x + src.width
            const y1 = src.y + 46 + srcColIdx * 20
            const x2 = dst.x
            const y2 = dst.y + 46 + dstColIdx * 20
            const cx = (x1 + x2) / 2
            return (
              <path
                key={`fk-${i}-${fi}`}
                d={`M${x1} ${y1} Q${cx} ${y1} ${cx} ${(y1 + y2) / 2} Q${cx} ${y2} ${x2} ${y2}`}
                className="stroke-blue-400 fill-none"
                strokeWidth="1"
                strokeDasharray="4,2"
                markerEnd="url(#arrowhead)"
              />
            )
          })
        )}
      </svg>
    </div>
  )
}

interface ViewBox { x: number; y: number; w: number; h: number }
