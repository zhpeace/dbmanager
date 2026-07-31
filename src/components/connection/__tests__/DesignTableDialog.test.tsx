import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DesignTableDialog } from "../DesignTableDialog"

const getSchemaCacheMock = vi.fn()
const alterAddColumnMock = vi.fn()
const alterDropColumnMock = vi.fn()

vi.mock("@/lib/db", () => ({
  getSchemaCache: (...args: any[]) => getSchemaCacheMock(...args),
  alterAddColumn: (...args: any[]) => alterAddColumnMock(...args),
  alterDropColumn: (...args: any[]) => alterDropColumnMock(...args),
}))

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connectionId: "c1",
  database: "mydb",
  table: "users",
  dbType: "postgresql" as const,
  onChanged: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  getSchemaCacheMock.mockResolvedValue({
    tables: [
      {
        table: "users",
        columns: [
          { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null },
          { name: "email", data_type: "VARCHAR(255)", nullable: true, key: "", default_value: null },
        ],
      },
    ],
  })
})

it("renders title with table name", async () => {
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Design Table: users")).toBeInTheDocument()
  })
})

it("loads and displays existing columns", async () => {
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  expect(screen.getByDisplayValue("INT")).toBeInTheDocument()
  expect(screen.getByDisplayValue("email")).toBeInTheDocument()
  const varcharInputs = screen.getAllByDisplayValue("VARCHAR(255)")
  expect(varcharInputs.length).toBeGreaterThanOrEqual(1)
})

it("calls getSchemaCache on mount", async () => {
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(getSchemaCacheMock).toHaveBeenCalledWith("c1", "mydb")
  })
})

it("shows error when getSchemaCache fails", async () => {
  getSchemaCacheMock.mockRejectedValue(new Error("connection lost"))
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("Error: connection lost")).toBeInTheDocument()
  })
})

it("disables drop button while busy", async () => {
  alterDropColumnMock.mockImplementation(() => new Promise(() => {}))
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  const dropButtons = screen.getAllByTitle("Drop")
  expect(dropButtons[0]).toBeEnabled()
  await userEvent.setup().click(dropButtons[0])
  await waitFor(() => {
    expect(dropButtons[0]).toBeDisabled()
  })
})

it("shows error when alterAddColumn fails", async () => {
  const user = userEvent.setup()
  alterAddColumnMock.mockRejectedValue(new Error("column exists"))
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  const textboxes = screen.getAllByRole("textbox")
  const newColName = textboxes[textboxes.length - 2]
  await user.type(newColName, "age")
  const addBtn = screen.getByText("Add Column")
  await user.click(addBtn)
  await waitFor(() => {
    expect(screen.getByText("Operation failed: Error: column exists")).toBeInTheDocument()
  })
})

it("adds a new column successfully", async () => {
  const user = userEvent.setup()
  alterAddColumnMock.mockResolvedValue(undefined)
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  const textboxes = screen.getAllByRole("textbox")
  const newColName = textboxes[textboxes.length - 2]
  await user.type(newColName, "age")
  await user.click(screen.getByText("Add Column"))
  await waitFor(() => {
    expect(alterAddColumnMock).toHaveBeenCalled()
  })
})

it("shows error when alterDropColumn fails", async () => {
  const user = userEvent.setup()
  alterDropColumnMock.mockRejectedValue(new Error("drop failed"))
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  const dropButtons = screen.getAllByTitle("Drop")
  await user.click(dropButtons[0])
  await waitFor(() => {
    expect(screen.getByText(/drop failed/)).toBeInTheDocument()
  })
})

it("calls alterDropColumn and removes row on success", async () => {
  const user = userEvent.setup()
  alterDropColumnMock.mockResolvedValue(undefined)
  render(<DesignTableDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  const dropButtons = screen.getAllByTitle("Drop")
  await user.click(dropButtons[0])
  await waitFor(() => {
    expect(alterDropColumnMock).toHaveBeenCalledWith("c1", "mydb", "users", "id")
  })
})

it("closes dialog when Close clicked", async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  render(<DesignTableDialog {...defaultProps} onOpenChange={onOpenChange} />)
  await waitFor(() => {
    expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  })
  const closeButtons = screen.getAllByRole("button", { name: "Close" })
  await user.click(closeButtons[closeButtons.length - 1])
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
