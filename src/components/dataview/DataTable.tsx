import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  type SortingState,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronUp, ChevronDown, Pencil, CirclePlus, XCircle, Maximize2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { toCsv, toInsert, toUpdate } from "@/lib/sql"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export type RowState = "modified" | "added" | "deleted"

interface DataTableProps {
  columns: string[]
  rows: Record<string, unknown>[]
  error?: string
  rowCount?: number
  sortColumn?: string | null
  sortOrder?: string
  onSort?: (col: string) => void
  onCellEdit?: (rowIndex: number, columnName: string, newValue: string) => void
  editingCell?: { row: number; col: string } | null
  onCellEditStart?: (rowIndex: number, columnName: string) => void
  onMoveNext?: (rowIndex: number, columnName: string, direction: "down" | "right") => void
  onLargeEdit?: (rowIndex: number, columnName: string) => void
  largeValueThreshold?: number
  onBinaryEdit?: (rowIndex: number, columnName: string) => void
  binaryColumns?: string[]
  rowStates?: Array<RowState | undefined>
  selectedRows?: Set<number>
  onSelectionChange?: (rowIndex: number, selected: boolean) => void
  tableName?: string
  primaryKeys?: string[]
  copyEnabled?: boolean
}

export function DataTable({
  columns,
  rows,
  error,
  rowCount,
  sortColumn,
  sortOrder,
  onSort,
  onCellEdit,
  editingCell,
  onCellEditStart,
  onMoveNext,
  onLargeEdit,
  largeValueThreshold = 200,
  onBinaryEdit,
  binaryColumns,
  rowStates,
  selectedRows,
  onSelectionChange,
  tableName,
  primaryKeys,
  copyEnabled = true,
}: DataTableProps) {
  const { t } = useTranslation()
  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const isExternalSort = !!onSort

  const [editValue, setEditValue] = useState("")
  const commitHandled = useRef(false)

  const [copyCell, setCopyCell] = useState<{ row: number; col: string } | null>(null)

  const data = useMemo(() => rows, [rows])

  const cellString = (v: unknown): string => {
    if (v === null || v === undefined) return ""
    if (typeof v === "object") return JSON.stringify(v)
    return String(v)
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
  }

  const handleCopy = (kind: "cell" | "row" | "column" | "rowCsv" | "insert" | "update") => {
    if (!copyCell) return
    const { row, col } = copyCell
    const rowData = data[row]
    if (!rowData) return
    setCopyCell(null)
    if (kind === "cell") {
      copyText(cellString(rowData[col]))
      return
    }
    if (kind === "row") {
      copyText(columns.map((c) => cellString(rowData[c])).join("\t"))
      return
    }
    if (kind === "column") {
      copyText(data.map((r) => cellString(r[col])).join("\n"))
      return
    }
    if (kind === "rowCsv") {
      copyText(toCsv(columns, [rowData]))
      return
    }
    if (kind === "insert" && tableName) {
      copyText(toInsert(tableName, columns, [rowData]))
      return
    }
    if (kind === "update" && tableName) {
      copyText(toUpdate(tableName, columns, rowData, primaryKeys))
    }
  }

  useEffect(() => {
    commitHandled.current = false
    if (editingCell) {
      const row = data[editingCell.row]
      const v = row ? row[editingCell.col] : undefined
      setEditValue(v === null || v === undefined ? "" : String(v))
    }
  }, [editingCell, data])

  const commitEdit = useCallback(
    (rowIdx: number, col: string, original: string) => {
      if (commitHandled.current) return
      commitHandled.current = true
      if (editValue !== original) {
        onCellEdit?.(rowIdx, col, editValue)
      } else {
        onCellEditStart?.(-1, "")
      }
    },
    [editValue, onCellEdit, onCellEditStart]
  )

  const cols = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    return columns.map((col) => ({
      id: col,
      accessorKey: col,
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (isExternalSort) {
              onSort(col)
            } else {
              column.toggleSorting()
            }
          }}
        >
          {col}
          {isExternalSort ? (
            sortColumn === col ? (
              sortOrder === "asc" ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 opacity-30" />
            )
          ) : column.getIsSorted() === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : column.getIsSorted() === "desc" ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-30" />
          )}
        </button>
      ),
      cell: ({ row, getValue }) => {
        const value = getValue()
        const rowIdx = row.index
        const rowState = rowStates?.[rowIdx]
        const isEditing = editingCell?.row === rowIdx && editingCell?.col === col

        if (rowState === "deleted") {
          return <span className="text-xs text-muted-foreground line-through opacity-60">{value === null || value === undefined ? "" : String(value)}</span>
        }

        if (isEditing) {
          const original = value === null ? "" : value === undefined ? "" : String(value)
          return (
            <input
              className="w-full min-w-0 bg-transparent text-xs outline-none border border-primary rounded px-1"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitEdit(rowIdx, col, original)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  commitHandled.current = true
                  onCellEditStart?.(-1, "")
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  commitEdit(rowIdx, col, original)
                  onMoveNext?.(rowIdx, col, "down")
                } else if (e.key === "Tab") {
                  e.preventDefault()
                  commitEdit(rowIdx, col, original)
                  onMoveNext?.(rowIdx, col, "right")
                }
              }}
              autoFocus
            />
          )
        }

        const isBinary = binaryColumns?.includes(col) ?? false
        const isHexString = typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)
        let displayValue: React.ReactNode
        let tooltip: string | undefined
        if (value === null) {
          displayValue = <span className="italic text-muted-foreground/50">{t('datatable.null')}</span>
        } else if (value === undefined) {
          displayValue = <span className="italic text-muted-foreground/50">{t('datatable.empty')}</span>
        } else if (isBinary && isHexString) {
          const hex = value.slice(2)
          tooltip = value
          displayValue = (
            <span className="font-mono">
              {hex.length > 32 ? `0x${hex.slice(0, 32)}…` : value}
            </span>
          )
        } else if (typeof value === "object") {
          tooltip = JSON.stringify(value)
          displayValue = JSON.stringify(value)
        } else {
          tooltip = String(value)
          displayValue = String(value)
        }
        const isLarge = value !== null && value !== undefined &&
          (isBinary || (typeof value === "object") || (typeof value === "string" && value.length > largeValueThreshold))
        return (
          <span
            className={cn(
              "text-xs cursor-pointer inline-flex items-center gap-1 max-w-full",
              rowState === "modified" && "text-amber-600 dark:text-amber-400 font-medium"
            )}
            title={tooltip}
            onDoubleClick={() => {
              if (isBinary && onBinaryEdit) {
                onBinaryEdit(rowIdx, col)
                return
              }
              if (isLarge && onLargeEdit) {
                onLargeEdit(rowIdx, col)
                return
              }
              onCellEditStart?.(rowIdx, col)
            }}
          >
            {displayValue}
            {isLarge && (
              <Maximize2 className="absolute bottom-0 right-0.5 h-2.5 w-2.5 text-muted-foreground/50 pointer-events-none" />
            )}
          </span>
        )
      },
      size: 150,
      minSize: 60,
      maxSize: 1200,
    }))
  }, [columns, sortColumn, sortOrder, isExternalSort, onSort, editingCell, editValue, onCellEdit, onCellEditStart, onMoveNext, commitEdit, rowStates, onLargeEdit, largeValueThreshold, onBinaryEdit, binaryColumns])

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})

  const table = useReactTable({
    data,
    columns: cols,
    state: { sorting: internalSorting, columnSizing },
    onSortingChange: setInternalSorting,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const rowStateIcon = (state: RowState | undefined) => {
    if (state === "modified") {
      return <Pencil className="h-3 w-3 text-amber-500" />
    }
    if (state === "added") {
      return <CirclePlus className="h-3 w-3 text-green-500" />
    }
    if (state === "deleted") {
      return <XCircle className="h-3 w-3 text-red-500" />
    }
    return null
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  if (columns.length === 0 && rowCount !== undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">
          {t('datatable.executed', { count: rowCount })}
        </p>
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full overflow-auto">
          <table className="border-collapse table-fixed" style={{ width: 56 + table.getTotalSize() }}>
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  <th className="w-14 h-8 px-2 border-b text-xs text-muted-foreground text-center bg-muted/80">
                    {t('datatable.rownum')}
                  </th>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="relative h-8 px-3 border-b text-left whitespace-nowrap bg-muted/80"
                      style={{ width: header.getSize() }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanResize() && (
                        <div
                          onPointerDown={header.getResizeHandler()}
                          onDoubleClick={() => header.column.resetSize()}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-accent-foreground/20"
                          title={t('datatable.resize_hint')}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="h-40 text-center align-middle text-sm text-muted-foreground">
                    {t('datatable.no_rows')}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, i) => {
                  const rowState = rowStates?.[i]
                  const isDeleted = rowState === "deleted"
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "hover:bg-accent/30 transition-colors",
                        i % 2 === 0 ? "bg-background" : "bg-muted/20",
                        isDeleted && "opacity-50 bg-red-50/40 dark:bg-red-950/20",
                        rowState === "added" && "bg-green-50/40 dark:bg-green-950/20"
                      )}
                    >
                      <td className="w-14 h-7 px-2 border-b text-xs text-muted-foreground text-center">
                        <div className="flex items-center justify-center gap-1">
                          {onSelectionChange && (
                            <input
                              type="checkbox"
                              className="h-3 w-3 accent-primary"
                              checked={selectedRows?.has(i) ?? false}
                              onChange={(e) => onSelectionChange(i, e.target.checked)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <span className="tabular-nums">{i + 1}</span>
                          {rowStateIcon(rowState)}
                        </div>
                      </td>
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="relative h-7 px-3 border-b whitespace-nowrap overflow-hidden text-ellipsis"
                          style={{ width: cell.column.getSize() }}
                          onContextMenu={() => {
                            if (!copyEnabled) return
                            setCopyCell({ row: i, col: cell.column.id })
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[10rem]">
        <ContextMenuItem onSelect={() => handleCopy("cell")}>
          {t('datatable.copy_cell')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handleCopy("row")}>
          {t('datatable.copy_row')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handleCopy("column")}>
          {t('datatable.copy_column')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => handleCopy("rowCsv")}>
          {t('datatable.copy_row_csv')}
        </ContextMenuItem>
        {copyEnabled && tableName && (
          <>
            <ContextMenuItem onSelect={() => handleCopy("insert")}>
              {t('datatable.copy_row_insert')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => handleCopy("update")}>
              {t('datatable.copy_row_update')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
