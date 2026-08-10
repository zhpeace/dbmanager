import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { invoke } from "@tauri-apps/api/core"
import { FindInTablesDialog } from "../FindInTablesDialog"

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connectionId: "c1",
  database: "app",
  onOpenRow: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue([])
})

it("renders title and search input", () => {
  render(<FindInTablesDialog {...defaultProps} />)
  expect(screen.getByText("Find in Tables")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("Enter text to search across tables...")).toBeInTheDocument()
})

it("invokes find_in_tables with connection and database", async () => {
  const user = userEvent.setup()
  render(<FindInTablesDialog {...defaultProps} />)
  const input = screen.getByPlaceholderText("Enter text to search across tables...")
  await user.type(input, "admin")
  await user.click(screen.getByText("Search"))
  await waitFor(() => {
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("find_in_tables", {
      id: "c1",
      database: "app",
      search: "admin",
      maxTables: undefined,
      perTableLimit: undefined,
    })
  })
})

it("shows matches and opens row on click", async () => {
  vi.mocked(invoke).mockResolvedValue([
    { table: "users", column: "email", value: "admin@x.com", row: { id: 1 } },
  ])
  const user = userEvent.setup()
  render(<FindInTablesDialog {...defaultProps} />)
  const input = screen.getByPlaceholderText("Enter text to search across tables...")
  await user.type(input, "admin@x.com")
  await user.click(screen.getByText("Search"))
  await user.click(await screen.findByText("admin@x.com"))
  expect(defaultProps.onOpenRow).toHaveBeenCalledWith("users")
  expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
})

it("shows need connection hint when no connection", () => {
  render(<FindInTablesDialog {...defaultProps} connectionId={null} database={null} />)
  expect(screen.getByText("Select a connection and database first")).toBeInTheDocument()
})

it("shows no results message", async () => {
  const user = userEvent.setup()
  render(<FindInTablesDialog {...defaultProps} />)
  const input = screen.getByPlaceholderText("Enter text to search across tables...")
  await user.type(input, "zzz")
  await user.click(screen.getByText("Search"))
  expect(await screen.findByText("No matches found")).toBeInTheDocument()
})
