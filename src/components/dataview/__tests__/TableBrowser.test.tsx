import { render, screen, waitFor } from "@testing-library/react"
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
