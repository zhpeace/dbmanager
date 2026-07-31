import { render, screen } from "@testing-library/react"
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
  expect(screen.getByText("Save")).toBeInTheDocument()
  expect(screen.getByText("Cancel")).toBeInTheDocument()
})

it("calls onCellEdit when save button clicked in edit mode", async () => {
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
  await user.click(screen.getByText("Save"))
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

it("save button is disabled when value unchanged", async () => {
  const user = userEvent.setup()
  const handleEditStart = vi.fn()
  const { rerender } = render(
    <DataTable
      columns={columns}
      rows={rows}
      onCellEditStart={handleEditStart}
    />
  )
  await user.dblClick(screen.getByText("Alice"))
  expect(handleEditStart).toHaveBeenCalledWith(0, "name")
  // Rerender with editingCell set to simulate parent state update
  rerender(
    <DataTable
      columns={columns}
      rows={rows}
      editingCell={{ row: 0, col: "name" }}
      onCellEdit={vi.fn()}
      onCellEditStart={vi.fn()}
    />
  )
  expect(screen.getByText("Save")).toBeDisabled()
})
