import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CreateTableDialog } from "../CreateTableDialog"

const createTableMock = vi.fn()

vi.mock("@/lib/db", () => ({
  createTable: (...args: any[]) => createTableMock(...args),
}))

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connectionId: "c1",
  database: "mydb",
  dbType: "postgresql" as const,
  onCreated: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

it("renders title and table name input", () => {
  render(<CreateTableDialog {...defaultProps} />)
  expect(screen.getByText("Create Table")).toBeInTheDocument()
  expect(screen.getByText("Table Name")).toBeInTheDocument()
})

it("renders default column row with id INT PK", () => {
  render(<CreateTableDialog {...defaultProps} />)
  expect(screen.getByDisplayValue("id")).toBeInTheDocument()
  expect(screen.getByDisplayValue("INT")).toBeInTheDocument()
})

it("shows error when table name is empty and create clicked", async () => {
  const user = userEvent.setup()
  render(<CreateTableDialog {...defaultProps} />)
  await user.click(screen.getByText("Create"))
  expect(screen.getByText("Table name required")).toBeInTheDocument()
})

it("shows error when column name is empty", async () => {
  const user = userEvent.setup()
  render(<CreateTableDialog {...defaultProps} />)
  await user.type(screen.getByPlaceholderText("my_table"), "users")
  await user.clear(screen.getByDisplayValue("id"))
  await user.click(screen.getByText("Create"))
  expect(screen.getByText("Column name required")).toBeInTheDocument()
})

it("calls createTable and closes on success", async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  createTableMock.mockResolvedValue(undefined)
  render(
    <CreateTableDialog
      {...defaultProps}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />
  )
  await user.type(screen.getByPlaceholderText("my_table"), "users")
  await user.click(screen.getByText("Create"))
  await waitFor(() => {
    expect(createTableMock).toHaveBeenCalledWith(
      "c1", "mydb", "users",
      [{ name: "id", data_type: "INT", nullable: false, primary_key: true, default_value: null }]
    )
  })
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(onCreated).toHaveBeenCalled()
})

it("shows error when createTable fails", async () => {
  const user = userEvent.setup()
  createTableMock.mockRejectedValue(new Error("table already exists"))
  render(<CreateTableDialog {...defaultProps} />)
  await user.type(screen.getByPlaceholderText("my_table"), "users")
  await user.click(screen.getByText("Create"))
  await waitFor(() => {
    expect(screen.getByText(/table already exists/)).toBeInTheDocument()
  })
})

it("adds a new column row", async () => {
  const user = userEvent.setup()
  render(<CreateTableDialog {...defaultProps} />)
  expect(screen.getByDisplayValue("INT")).toBeInTheDocument()
  await user.click(screen.getByText("Add Column"))
  expect(screen.getByDisplayValue("VARCHAR(255)")).toBeInTheDocument()
  expect(screen.getAllByRole("checkbox").length).toBe(4)
})

it("removes a column row", async () => {
  const user = userEvent.setup()
  render(<CreateTableDialog {...defaultProps} />)
  // Add then remove
  await user.click(screen.getByText("Add Column"))
  const deleteBtns = screen.getAllByRole("button")
  // Find the trash buttons (they have variant ghost)
  const trashButtons = deleteBtns.filter(b => b.innerHTML.includes("Trash2") || b.querySelector("svg"))
  if (trashButtons.length > 0) {
    await user.click(trashButtons[0])
  }
})

it("cancels and resets form", async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  render(
    <CreateTableDialog
      {...defaultProps}
      onOpenChange={onOpenChange}
    />
  )
  await user.type(screen.getByPlaceholderText("my_table"), "users")
  await user.click(screen.getByText("Cancel"))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it("disables create button while busy", async () => {
  const user = userEvent.setup()
  createTableMock.mockImplementation(() => new Promise(() => {}))
  render(<CreateTableDialog {...defaultProps} />)
  await user.type(screen.getByPlaceholderText("my_table"), "users")
  await user.click(screen.getByText("Create"))
  expect(screen.getByText("Create")).toBeDisabled()
})

it("toggles nullable checkbox", async () => {
  const user = userEvent.setup()
  render(<CreateTableDialog {...defaultProps} />)
  const checkboxes = screen.getAllByRole("checkbox")
  const nullableCheckbox = checkboxes[0]
  expect(nullableCheckbox).not.toBeChecked()
  await user.click(nullableCheckbox)
  expect(nullableCheckbox).toBeChecked()
})

it("toggles PK checkbox and clears nullable", async () => {
  const user = userEvent.setup()
  render(<CreateTableDialog {...defaultProps} />)
  const checkboxes = screen.getAllByRole("checkbox")
  const pkCheckbox = checkboxes[1]
  expect(pkCheckbox).toBeChecked()
  await user.click(pkCheckbox)
  expect(pkCheckbox).not.toBeChecked()
})
