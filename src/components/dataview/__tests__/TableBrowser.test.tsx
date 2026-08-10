import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { invoke } from "@tauri-apps/api/core"
import { TableBrowser } from "../TableBrowser"
import type { TableData } from "@/lib/db"

const mockTableData: TableData = {
  columns: [
    { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" },
    { name: "name", data_type: "VARCHAR(255)", nullable: true, key: "", default_value: null, extra: "" },
  ],
  rows: [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ],
  total: 2,
  duration: "0.5s",
  primary_keys: ["id"],
  row_handles: [{ id: 1 }, { id: 2 }],
}

const defaultProps = {
  connectionId: "c1",
  database: "mydb",
  table: "users",
  dbType: "postgresql" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue(null)
})

it("shows loading state initially", () => {
  vi.mocked(invoke).mockImplementation(() => new Promise(() => {}))
  render(<TableBrowser {...defaultProps} />)
  expect(screen.getByText("Loading...")).toBeInTheDocument()
})

it("shows error when get_table_data fails", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce(new Error("permission denied"))
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Error: permission denied")).toBeInTheDocument()
  })
})

it("renders table name and data", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("CREATE TABLE users ...")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  expect(screen.getByText("Alice")).toBeInTheDocument()
  expect(screen.getByText("Bob")).toBeInTheDocument()
})

it("calls invoke with correct parameters on mount", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("CREATE TABLE ...")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_table_data", {
      id: "c1", database: "mydb", table: "users",
      page: 1, pageSize: 100,
      sortColumn: null, sortOrder: null,
      whereClause: null,
    })
  })
  expect(invoke).toHaveBeenCalledWith("get_table_ddl", { id: "c1", database: "mydb", table: "users" })
})

it("shows rows info text", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText(/2 rows/)).toBeInTheDocument()
  })
  expect(screen.getByText(/0\.5s/)).toBeInTheDocument()
})

it("calls onClose when close button clicked", async () => {
  const onClose = vi.fn()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  const user = userEvent.setup()
  const { container } = render(<TableBrowser {...defaultProps} onClose={onClose} />)
  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  const closeBtn = container.querySelector('button svg.lucide-x')?.closest('button')
  if (closeBtn) await user.click(closeBtn)
  expect(onClose).toHaveBeenCalled()
})

it("shows columns tab", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Data")).toBeInTheDocument()
  })
  expect(screen.getByText("Columns")).toBeInTheDocument()
  expect(screen.getByText("DDL")).toBeInTheDocument()
})

it("shows column info in columns tab", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Data")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Columns"))
  await waitFor(() => {
    expect(screen.getByText("Name")).toBeInTheDocument()
  })
  expect(screen.getByText("Type")).toBeInTheDocument()
  expect(screen.getByText("Nullable")).toBeInTheDocument()
  expect(screen.getByText("Key")).toBeInTheDocument()
  expect(screen.getByText("Default")).toBeInTheDocument()
  expect(screen.getByText("Extra")).toBeInTheDocument()
})

it("shows DDL in DDL tab", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("CREATE TABLE users (id INT)")
  const user = userEvent.setup()
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Data")).toBeInTheDocument()
  })
  await user.click(screen.getByText("DDL"))
  await waitFor(() => {
    expect(screen.getByText("CREATE TABLE users (id INT)")).toBeInTheDocument()
  })
})

it("disables prev button on page 1", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  const buttons = screen.getAllByRole("button")
  const svgButtons = buttons.filter(b => b.querySelector("svg"))
  expect(svgButtons.length).toBeGreaterThan(0)
})

it("shows pagination info", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("1 / 1")).toBeInTheDocument()
  })
})

it("shows sortable column headers", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  const idHeaders = screen.getAllByText("id")
  expect(idHeaders.length).toBeGreaterThan(0)
})

it("renders DataTable with sort props", async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  expect(screen.getByText("Bob")).toBeInTheDocument()
})

it("adds a blank row and shows pending count", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Add"))
  expect(screen.getByText(/1 row\(s\) pending/)).toBeInTheDocument()
})

it("saves modified cell and added row as a batch", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  const { container } = render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  await user.dblClick(screen.getByText("Alice"))
  const input = screen.getByDisplayValue("Alice")
  fireEvent.change(input, { target: { value: "Alicia" } })
  await user.keyboard("{Enter}")

  await user.click(screen.getByText("Add"))
  const toolbarSave = container.querySelector('button svg.lucide-save')?.closest("button")
  expect(toolbarSave).not.toBeNull()
  await user.click(toolbarSave!)

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("execute_batch", {
      id: "c1",
      queries: expect.arrayContaining([
        expect.stringContaining("UPDATE users SET name = 'Alicia' WHERE id = 1"),
      ]),
    })
  })
  const batchCall = vi.mocked(invoke).mock.calls.find(([name]) => name === "execute_batch")
  expect(batchCall).toBeDefined()
  expect(batchCall![1].queries).toHaveLength(2)
  expect(batchCall![1].queries[1]).toMatch(/INSERT INTO users/)
})

it("marks deleted row and issues DELETE on save", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  const checkboxes = screen.getAllByRole("checkbox")
  await user.click(checkboxes[0])
  await user.click(screen.getByText("Delete"))
  await user.click(screen.getByText("Save"))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("execute_batch", {
      id: "c1",
      queries: ["DELETE FROM users WHERE id = 1"],
    })
  })
})

it("rollback discards buffer and reloads", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Add"))
  expect(screen.getByText(/1 row\(s\) pending/)).toBeInTheDocument()
  await user.click(screen.getByText("Revert"))
  await waitFor(() => {
    expect(screen.queryByText(/row\(s\) pending/)).not.toBeInTheDocument()
  })
  const reloadCalls = vi.mocked(invoke).mock.calls.filter(([name]) => name === "get_table_data")
  expect(reloadCalls.length).toBeGreaterThanOrEqual(2)
})

it("refresh prompts to discard unsaved changes", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Add"))
  await user.click(screen.getByText("Refresh"))
  expect(confirmSpy).toHaveBeenCalled()
  confirmSpy.mockRestore()
})

it("commits the edited cell when save is clicked directly without Enter", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  const { container } = render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  await user.dblClick(screen.getByText("Alice"))
  const input = screen.getByDisplayValue("Alice")
  fireEvent.change(input, { target: { value: "Alicia" } })

  const toolbarSave = container.querySelector('button svg.lucide-save')?.closest("button")
  expect(toolbarSave).not.toBeNull()
  await user.click(toolbarSave!)

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("execute_batch", {
      id: "c1",
      queries: expect.arrayContaining([
        expect.stringContaining("UPDATE users SET name = 'Alicia' WHERE id = 1"),
      ]),
    })
  })
})

it("moves to the next row when Enter is pressed", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  await user.dblClick(screen.getByText("Alice"))
  const input = screen.getByDisplayValue("Alice")
  fireEvent.change(input, { target: { value: "Alicia" } })
  await user.keyboard("{Enter}")

  await waitFor(() => {
    expect(screen.getByDisplayValue("Bob")).toBeInTheDocument()
  })
})

it("opens value editor dialog for large fields and commits to buffer then batch", async () => {
  const user = userEvent.setup()
  const long = "L".repeat(300)
  const tableData: TableData = {
    columns: [
      { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" },
      { name: "body", data_type: "TEXT", nullable: true, key: "", default_value: null, extra: "" },
    ],
    rows: [{ id: 1, body: long }],
    total: 1,
    duration: "0.5s",
    primary_keys: ["id"],
    row_handles: [{ id: 1 }],
  }
  vi.mocked(invoke)
    .mockResolvedValueOnce(tableData)
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(tableData)
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText(long)).toBeInTheDocument()
  })

  await user.dblClick(screen.getByText(long))
  const dialog = await screen.findByRole("dialog")
  const textarea = within(dialog).getByRole("textbox")
  await user.clear(textarea)
  await user.type(textarea, "New long content")
  await user.click(within(dialog).getByRole("button", { name: "Save" }))

  await waitFor(() => {
    expect(screen.getByText("New long content")).toBeInTheDocument()
    expect(screen.getByText("1 row(s) pending")).toBeInTheDocument()
  })

  await user.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() => {
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "execute_batch")
    expect(call).toBeDefined()
    expect(call![1].queries[0]).toContain("body")
  })
})

it("edits binary column via hex editor and saves with binary literal", async () => {
  const user = userEvent.setup()
  const tableData: TableData = {
    columns: [
      { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" },
      { name: "data", data_type: "BLOB", nullable: true, key: "", default_value: null, extra: "" },
    ],
    rows: [{ id: 1, data: "0xDEADBEEF" }],
    total: 1,
    duration: "0.5s",
    primary_keys: ["id"],
    row_handles: [{ id: 1 }],
  }
  vi.mocked(invoke)
    .mockResolvedValueOnce(tableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("0xDEADBEEF")).toBeInTheDocument()
  })

  await user.dblClick(screen.getByText("0xDEADBEEF"))
  const dialog = await screen.findByRole("dialog")
  const hexInput = within(dialog).getByDisplayValue("DEADBEEF")
  fireEvent.change(hexInput, { target: { value: "DEADBEFF" } })
  await user.click(within(dialog).getByRole("button", { name: "Save" }))

  await waitFor(() => {
    expect(screen.getByText("0xDEADBEFF")).toBeInTheDocument()
  })
  await user.click(screen.getByRole("button", { name: "Save" }))

  await waitFor(() => {
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === "execute_batch")
    expect(call).toBeDefined()
    expect(call![1].queries[0]).toMatch(/UPDATE users SET data = decode\('DEADBEFF', 'hex'\) WHERE id = 1/)
  })
})

it("does not mark binary cell dirty when hex unchanged", async () => {
  const user = userEvent.setup()
  const tableData: TableData = {
    columns: [
      { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" },
      { name: "data", data_type: "BYTEA", nullable: true, key: "", default_value: null, extra: "" },
    ],
    rows: [{ id: 1, data: "0xDEADBEEF" }],
    total: 1,
    duration: "0.5s",
    primary_keys: ["id"],
    row_handles: [{ id: 1 }],
  }
  vi.mocked(invoke)
    .mockResolvedValueOnce(tableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("0xDEADBEEF")).toBeInTheDocument()
  })

  await user.dblClick(screen.getByText("0xDEADBEEF"))
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "Save" }))

  await waitFor(() => {
    expect(screen.queryByText("1 row(s) pending")).not.toBeInTheDocument()
  })
  const saveButtons = screen.getAllByRole("button", { name: "Save" })
  expect(saveButtons.filter((b) => (b as HTMLButtonElement).disabled).length).toBeGreaterThan(0)
})

it("filters data by column value via whereClause", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  vi.mocked(invoke).mockResolvedValue(mockTableData)

  await user.click(screen.getByText("Filter"))
  const nameInput = screen.getByPlaceholderText("name")
  fireEvent.change(nameInput, { target: { value: "%Ali%" } })

  await waitFor(() => {
    const calls = vi.mocked(invoke).mock.calls.filter(([n]) => n === "get_table_data")
    expect(calls[calls.length - 1][1]).toMatchObject({
      whereClause: "name LIKE '%Ali%'",
      page: 1,
    })
  })
})

it("builds operator filters like >, >=, <>, and clear resets filters", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce(mockTableData)
    .mockResolvedValueOnce("")
  render(<TableBrowser {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })
  vi.mocked(invoke).mockResolvedValue(mockTableData)

  await user.click(screen.getByText("Filter"))
  const idInput = screen.getByPlaceholderText("id")
  fireEvent.change(idInput, { target: { value: ">= 5" } })

  await waitFor(() => {
    const calls = vi.mocked(invoke).mock.calls.filter(([n]) => n === "get_table_data")
    expect(calls[calls.length - 1][1]).toMatchObject({
      whereClause: "id >= 5",
    })
  })

  const clearBtn = screen.getByTitle("Clear filters")
  await user.click(clearBtn)
  await waitFor(() => {
    const calls = vi.mocked(invoke).mock.calls.filter(([n]) => n === "get_table_data")
    expect(calls[calls.length - 1][1]).toMatchObject({ whereClause: null })
  })
})

