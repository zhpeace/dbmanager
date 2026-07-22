import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

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
}

export function DataTable({ columns, rows, error, rowCount, sortColumn, sortOrder, onSort, onCellEdit, editingCell, onCellEditStart }: DataTableProps) {
  const { t } = useTranslation()
  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const isExternalSort = !!onSort

  const [editValue, setEditValue] = useState("")

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
        const isEditing = editingCell?.row === rowIdx && editingCell?.col === col

        if (isEditing) {
          const original = value === null ? "" : value === undefined ? "" : String(value)
          const changed = editValue !== original
          return (
            <div className="flex items-center gap-1">
              <input
                className="flex-1 min-w-0 bg-transparent text-xs outline-none border border-primary rounded px-1"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    onCellEditStart?.(-1, "")
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                disabled={!changed}
                onClick={() => onCellEdit?.(rowIdx, col, editValue)}
                className="shrink-0 h-5 px-1.5 rounded text-[10px] bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('datatable.save')}
              </button>
              <button
                type="button"
                onClick={() => onCellEditStart?.(-1, "")}
                className="shrink-0 h-5 px-1.5 rounded text-[10px] border border-border"
              >
                {t('datatable.cancel')}
              </button>
            </div>
          )
        }

        const displayValue = value === null ? (
          <span className="italic text-muted-foreground/50">{t('datatable.null')}</span>
        ) : value === undefined ? (
          <span className="italic text-muted-foreground/50">{t('datatable.empty')}</span>
        ) : typeof value === "object" ? (
          JSON.stringify(value)
        ) : (
          String(value)
        )
        return (
          <span
            className="text-xs cursor-pointer"
            onDoubleClick={() => {
              setEditValue(String(value ?? ""))
              onCellEditStart?.(rowIdx, col)
            }}
          >
            {displayValue}
          </span>
        )
      },
      size: 150,
    }))
  }, [columns, sortColumn, sortOrder, isExternalSort, onSort, editingCell, editValue, onCellEdit, onCellEditStart])

  const data = useMemo(() => rows, [rows])

  const table = useReactTable({
    data,
    columns: cols,
    state: { sorting: internalSorting },
    onSortingChange: setInternalSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

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
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              <th className="w-10 h-8 px-2 border-b text-xs text-muted-foreground text-center bg-muted/80">
                {t('datatable.rownum')}
              </th>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-8 px-3 border-b text-left whitespace-nowrap bg-muted/80"
                  style={{ width: header.getSize() }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="h-20 text-center text-sm text-muted-foreground">
                {t('datatable.no_rows')}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className={cn(
                  "hover:bg-accent/30 transition-colors",
                  i % 2 === 0 ? "bg-background" : "bg-muted/20"
                )}
              >
                <td className="w-10 h-7 px-2 border-b text-xs text-muted-foreground text-center">
                  {i + 1}
                </td>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="h-7 px-3 border-b whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
