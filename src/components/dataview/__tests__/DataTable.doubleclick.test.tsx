import { render, screen, fireEvent } from "@testing-library/react"
import { DataTable } from "../DataTable"

describe("DataTable double-click editor dispatch (type-driven, DBeaver-like)", () => {
  const baseProps = {
    columns: ["id", "ts", "doc", "data", "name"] as string[],
    rows: [
      {
        id: 1,
        ts: "2023-01-02 03:04:05",
        doc: "<a>x</a>",
        data: "0x00",
        name: "Alice",
      },
    ],
    columnTypes: { ts: "timestamp", doc: "longtext", data: "bytea", name: "varchar" } as Record<string, string>,
    binaryColumns: ["data"],
    largeValueThreshold: 200,
  }

  it("opens the value editor for temporal columns", () => {
    const onLargeEdit = vi.fn()
    const onCellEditStart = vi.fn()
    render(<DataTable {...baseProps} onLargeEdit={onLargeEdit} onCellEditStart={onCellEditStart} />)
    fireEvent.doubleClick(screen.getByText("2023-01-02 03:04:05"))
    expect(onLargeEdit).toHaveBeenCalledWith(0, "ts")
    expect(onCellEditStart).not.toHaveBeenCalled()
  })

  it("opens the value editor for structured text columns (by type, not length)", () => {
    const onLargeEdit = vi.fn()
    render(<DataTable {...baseProps} onLargeEdit={onLargeEdit} />)
    fireEvent.doubleClick(screen.getByText("<a>x</a>"))
    expect(onLargeEdit).toHaveBeenCalledWith(0, "doc")
  })

  it("opens the binary editor for binary/LOB columns", () => {
    const onBinaryEdit = vi.fn()
    render(<DataTable {...baseProps} onBinaryEdit={onBinaryEdit} />)
    fireEvent.doubleClick(screen.getByText("0x00"))
    expect(onBinaryEdit).toHaveBeenCalledWith(0, "data")
  })

  it("falls back to inline edit for short ordinary columns", () => {
    const onLargeEdit = vi.fn()
    const onCellEditStart = vi.fn()
    render(<DataTable {...baseProps} onLargeEdit={onLargeEdit} onCellEditStart={onCellEditStart} />)
    fireEvent.doubleClick(screen.getByText("Alice"))
    expect(onCellEditStart).toHaveBeenCalledWith(0, "name")
    expect(onLargeEdit).not.toHaveBeenCalled()
  })

  it("opens the value editor for ordinary columns whose content exceeds the length threshold", () => {
    const onLargeEdit = vi.fn()
    const longRows = [{ note: "x".repeat(500) }]
    render(
      <DataTable
        columns={["note"]}
        rows={longRows}
        columnTypes={{ note: "varchar" }}
        largeValueThreshold={200}
        onLargeEdit={onLargeEdit}
      />,
    )
    fireEvent.doubleClick(screen.getByText("x".repeat(500)))
    expect(onLargeEdit).toHaveBeenCalledWith(0, "note")
  })
})