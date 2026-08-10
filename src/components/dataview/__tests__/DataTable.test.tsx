import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DataTable } from "../DataTable"

const columns = ["id", "name", "email"]
const rows = [
  { id: 1, name: "Alice", email: "alice@test.com" },
  { id: 2, name: "Bob", email: "bob@test.com" },
]

it("renders column headers", () => {
  render(<DataTable columns={columns} rows={rows} />)
  expect(screen.getByText("id")).toBeInTheDocument()
  expect(screen.getByText("name")).toBeInTheDocument()
  expect(screen.getByText("email")).toBeInTheDocument()
})

it("renders row data", () => {
  render(<DataTable columns={columns} rows={rows} />)
  expect(screen.getByText("Alice")).toBeInTheDocument()
  expect(screen.getByText("Bob")).toBeInTheDocument()
  expect(screen.getByText("alice@test.com")).toBeInTheDocument()
})

it("renders row numbers", () => {
  render(<DataTable columns={columns} rows={rows} />)
  const ones = screen.getAllByText("1")
  expect(ones.length).toBeGreaterThanOrEqual(1)
})

it("shows error state", () => {
  render(<DataTable columns={columns} rows={[]} error="Connection failed" />)
  expect(screen.getByText("Connection failed")).toBeInTheDocument()
})

it("shows executed message when no columns but rowCount provided", () => {
  render(<DataTable columns={[]} rows={[]} rowCount={3} />)
  expect(screen.getByText("Query executed successfully. 3 row(s) affected.")).toBeInTheDocument()
})

it("shows no rows message when rows array is empty", () => {
  render(<DataTable columns={columns} rows={[]} />)
  expect(screen.getByText("No rows returned")).toBeInTheDocument()
})

it("renders null value as italic NULL", () => {
  const nullRows = [{ id: null }]
  render(<DataTable columns={["id"]} rows={nullRows} />)
  expect(screen.getByText("NULL")).toBeInTheDocument()
})

it("renders undefined value as em dash", () => {
  const undefRows = [{}]
  render(<DataTable columns={["id"]} rows={undefRows} />)
  expect(screen.getByText("—")).toBeInTheDocument()
})

it("renders object value as JSON string", () => {
  const objRows = [{ meta: { key: "val" } }]
  render(<DataTable columns={["meta"]} rows={objRows} />)
  expect(screen.getByText('{"key":"val"}')).toBeInTheDocument()
})

it("calls external onSort when sort column header clicked", async () => {
  const user = userEvent.setup()
  const handleSort = vi.fn()
  render(<DataTable columns={columns} rows={rows} sortColumn="id" sortOrder="asc" onSort={handleSort} />)
  await user.click(screen.getByText("id"))
  expect(handleSort).toHaveBeenCalledWith("id")
})

it("shows external sort indicators", () => {
  render(<DataTable columns={columns} rows={rows} sortColumn="name" sortOrder="desc" onSort={vi.fn()} />)
  expect(screen.getByText("name")).toBeInTheDocument()
})

it("renders inline edit input when editingCell matches", () => {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      editingCell={{ row: 0, col: "name" }}
      onCellEditStart={vi.fn()}
    />
  )
  expect(screen.getByRole("textbox")).toBeInTheDocument()
})

it("calls onCellEdit when Enter pressed in edit mode", async () => {
  const user = userEvent.setup()
  const handleCellEdit = vi.fn()
  render(
    <DataTable
      columns={columns}
      rows={rows}
      editingCell={{ row: 0, col: "name" }}
      onCellEdit={handleCellEdit}
      onCellEditStart={vi.fn()}
    />
  )
  const input = screen.getByRole("textbox")
  await user.clear(input)
  await user.type(input, "Charlie")
  await user.keyboard("{Enter}")
  expect(handleCellEdit).toHaveBeenCalledWith(0, "name", "Charlie")
})

it("calls onCellEditStart when double-clicking a cell", async () => {
  const user = userEvent.setup()
  const handleEditStart = vi.fn()
  render(
    <DataTable
      columns={columns}
      rows={rows}
      onCellEditStart={handleEditStart}
    />
  )
  await user.dblClick(screen.getByText("Alice"))
  expect(handleEditStart).toHaveBeenCalledWith(0, "name")
})

it("Enter without changes closes editor without committing", async () => {
  const user = userEvent.setup()
  const handleCellEdit = vi.fn()
  const handleEditStart = vi.fn()
  const { rerender } = render(
    <DataTable columns={columns} rows={rows} onCellEditStart={handleEditStart} />
  )
  await user.dblClick(screen.getByText("Alice"))
  rerender(
    <DataTable
      columns={columns}
      rows={rows}
      editingCell={{ row: 0, col: "name" }}
      onCellEdit={handleCellEdit}
      onCellEditStart={handleEditStart}
    />
  )
  await user.keyboard("{Enter}")
  expect(handleCellEdit).not.toHaveBeenCalled()
  expect(handleEditStart).toHaveBeenCalledWith(-1, "")
})

it("Escape cancels edit without committing", async () => {
  const user = userEvent.setup()
  const handleCellEdit = vi.fn()
  const handleEditStart = vi.fn()
  render(
    <DataTable
      columns={columns}
      rows={rows}
      editingCell={{ row: 0, col: "name" }}
      onCellEdit={handleCellEdit}
      onCellEditStart={handleEditStart}
    />
  )
  const input = screen.getByRole("textbox")
  await user.clear(input)
  await user.type(input, "Charlie")
  await user.keyboard("{Escape}")
  expect(handleCellEdit).not.toHaveBeenCalled()
  expect(handleEditStart).toHaveBeenCalledWith(-1, "")
})

it("renders selection checkboxes when onSelectionChange provided", () => {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      selectedRows={new Set([0])}
      onSelectionChange={vi.fn()}
    />
  )
  const checkboxes = screen.getAllByRole("checkbox")
  expect(checkboxes).toHaveLength(2)
  expect(checkboxes[0]).toBeChecked()
})

it("calls onSelectionChange when checkbox toggled", async () => {
  const user = userEvent.setup()
  const handleSelectionChange = vi.fn()
  render(
    <DataTable
      columns={columns}
      rows={rows}
      onSelectionChange={handleSelectionChange}
    />
  )
  await user.click(screen.getAllByRole("checkbox")[0])
  expect(handleSelectionChange).toHaveBeenCalledWith(0, true)
})

it("shows status icons for modified/added/deleted rows", () => {
  render(
    <DataTable
      columns={columns}
      rows={rows}
      rowStates={["modified", "added", "deleted"]}
    />
  )
  expect(screen.getByText("Alice").closest("span")).toHaveClass("text-amber-600")
})

it("does not trigger edit on deleted rows", async () => {
  const user = userEvent.setup()
  const handleEditStart = vi.fn()
  render(
    <DataTable
      columns={columns}
      rows={rows}
      rowStates={["deleted", undefined]}
      onCellEditStart={handleEditStart}
    />
  )
  await user.dblClick(screen.getByText("Alice"))
  expect(handleEditStart).not.toHaveBeenCalled()
})

it("resizes column width only when dragging the header handle", () => {
  render(<DataTable columns={["name"]} rows={[{ name: "Alice" }]} />)
  const th = screen.getByText("name").closest("th")!
  const handle = th.querySelector("div[title]") as HTMLElement
  expect(handle).not.toBeNull()

  fireEvent.pointerDown(handle, { clientX: 100, button: 0 })
  fireEvent.mouseMove(document, { clientX: 200 })
  fireEvent.mouseUp(document)

  const nameTh = screen.getByText("name").closest("th")!
  expect(nameTh.style.width).toBe("250px")
})

it("does not resize column width on hover without pointer down", () => {
  render(<DataTable columns={["name"]} rows={[{ name: "Alice" }]} />)
  const handle = screen.getByText("name").closest("th")!.querySelector("div[title]") as HTMLElement
  const before = screen.getByText("name").closest("th")!.style.width

  fireEvent.pointerMove(handle, { clientX: 100 })
  fireEvent.pointerMove(handle, { clientX: 200 })

  const after = screen.getByText("name").closest("th")!.style.width
  expect(after).toBe(before)
})

it("opens large value editor on double-click for long text instead of inline edit", async () => {
  const user = userEvent.setup()
  const handleLarge = vi.fn()
  const handleEditStart = vi.fn()
  const long = "x".repeat(300)
  render(
    <DataTable
      columns={["body"]}
      rows={[{ body: long }]}
      onLargeEdit={handleLarge}
      onCellEditStart={handleEditStart}
    />
  )
  await user.dblClick(screen.getByText(long))
  expect(handleLarge).toHaveBeenCalledWith(0, "body")
  expect(handleEditStart).not.toHaveBeenCalled()
})

it("keeps inline edit for short values", async () => {
  const user = userEvent.setup()
  const handleLarge = vi.fn()
  const handleEditStart = vi.fn()
  render(
    <DataTable
      columns={["name"]}
      rows={[{ name: "Alice" }]}
      onLargeEdit={handleLarge}
      onCellEditStart={handleEditStart}
    />
  )
  await user.dblClick(screen.getByText("Alice"))
  expect(handleEditStart).toHaveBeenCalledWith(0, "name")
  expect(handleLarge).not.toHaveBeenCalled()
})

it("routes object values to the large value editor", async () => {
  const user = userEvent.setup()
  const handleLarge = vi.fn()
  const handleEditStart = vi.fn()
  render(
    <DataTable
      columns={["meta"]}
      rows={[{ meta: { a: 1 } }]}
      onLargeEdit={handleLarge}
      onCellEditStart={handleEditStart}
    />
  )
  await user.dblClick(screen.getByText('{"a":1}'))
  expect(handleLarge).toHaveBeenCalledWith(0, "meta")
  expect(handleEditStart).not.toHaveBeenCalled()
})

it("shows expand icon for large values", () => {
  render(<DataTable columns={["body"]} rows={[{ body: "x".repeat(300) }]} />)
  expect(document.querySelectorAll(".lucide-maximize-2").length).toBeGreaterThan(0)
})

it("shows hex preview and opens binary editor for binary columns", async () => {
  const user = userEvent.setup()
  const handleBinary = vi.fn()
  render(
    <DataTable
      columns={["data"]}
      rows={[{ data: "0xDEADBEEF" }]}
      binaryColumns={["data"]}
      onBinaryEdit={handleBinary}
    />
  )
  expect(screen.getByText("0xDEADBEEF")).toBeInTheDocument()
  await user.dblClick(screen.getByText("0xDEADBEEF"))
  expect(handleBinary).toHaveBeenCalledWith(0, "data")
})

it("truncates long hex preview in binary columns", () => {
  const longHex = "0x" + "AB".repeat(40)
  render(<DataTable columns={["data"]} rows={[{ data: longHex }]} binaryColumns={["data"]} />)
  expect(screen.getByText(/^0x(AB){16}…$/)).toBeInTheDocument()
})

describe("context menu copy", () => {
  let writeTextMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    })
  })

  async function openMenuOn(text: string) {
    render(<DataTable columns={columns} rows={rows} tableName="users" primaryKeys={["id"]} />)
    fireEvent.contextMenu(screen.getByText(text).closest("td")!)
  }

  async function clickMenuItem(label: string) {
    const item = await screen.findByText(label)
    fireEvent.pointerDown(item)
    fireEvent.pointerUp(item)
    fireEvent.click(item)
  }

  it("shows copy options in context menu", async () => {
    render(<DataTable columns={columns} rows={rows} tableName="users" primaryKeys={["id"]} />)
    fireEvent.contextMenu(screen.getByText("Alice").closest("td")!)
    expect(screen.getByText("Copy Cell")).toBeInTheDocument()
    expect(screen.getByText("Copy Row")).toBeInTheDocument()
    expect(screen.getByText("Copy Column")).toBeInTheDocument()
    expect(screen.getByText("Copy as INSERT")).toBeInTheDocument()
    expect(screen.getByText("Copy as UPDATE")).toBeInTheDocument()
  })

  it("copies a cell value", async () => {
    await openMenuOn("Alice")
    await clickMenuItem("Copy Cell")
    expect(writeTextMock).toHaveBeenCalledWith("Alice")
  })

  it("copies row as tab-separated values", async () => {
    await openMenuOn("Alice")
    await clickMenuItem("Copy Row")
    expect(writeTextMock).toHaveBeenCalledWith("1\tAlice\talice@test.com")
  })

  it("copies a column as newline-separated values", async () => {
    await openMenuOn("Alice")
    await clickMenuItem("Copy Column")
    expect(writeTextMock).toHaveBeenCalledWith("Alice\nBob")
  })

  it("copies row as CSV", async () => {
    await openMenuOn("Alice")
    await clickMenuItem("Copy Row as CSV")
    expect(writeTextMock).toHaveBeenCalledWith('id,name,email\n1,Alice,alice@test.com')
  })

  it("copies row as INSERT statement", async () => {
    await openMenuOn("Alice")
    await clickMenuItem("Copy as INSERT")
    expect(writeTextMock).toHaveBeenCalledWith(
      "INSERT INTO `users` (`id`, `name`, `email`) VALUES\n  (1, 'Alice', 'alice@test.com');"
    )
  })

  it("copies row as UPDATE statement using primary keys", async () => {
    await openMenuOn("Alice")
    await clickMenuItem("Copy as UPDATE")
    expect(writeTextMock).toHaveBeenCalledWith(
      "UPDATE `users` SET `id` = 1, `name` = 'Alice', `email` = 'alice@test.com' WHERE `id` = 1;"
    )
  })

  it("hides INSERT/UPDATE items when no tableName provided", () => {
    render(<DataTable columns={columns} rows={rows} />)
    fireEvent.contextMenu(screen.getByText("Alice").closest("td")!)
    expect(screen.queryByText("Copy as INSERT")).not.toBeInTheDocument()
    expect(screen.queryByText("Copy as UPDATE")).not.toBeInTheDocument()
  })
})
