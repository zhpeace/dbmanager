import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NewDatabaseDialog } from "../NewDatabaseDialog"
import { invoke } from "@tauri-apps/api/core"

const mockOnOpenChange = vi.fn()
const mockOnCreated = vi.fn()

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  connectionId: "conn-1",
  onCreated: mockOnCreated,
}

beforeEach(() => {
  vi.clearAllMocks()
})

it("renders with correct title", () => {
  render(<NewDatabaseDialog {...defaultProps} />)
  expect(screen.getByText("New Database")).toBeInTheDocument()
})

it("disables create button when name is empty", () => {
  render(<NewDatabaseDialog {...defaultProps} />)
  expect(screen.getByRole("button", { name: /create/i })).toBeDisabled()
})

it("enables create button when name is entered", async () => {
  const user = userEvent.setup()
  render(<NewDatabaseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "mydb")
  expect(screen.getByRole("button", { name: /create/i })).toBeEnabled()
})

it("calls createDatabase with correct name", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue(null)

  render(<NewDatabaseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "new_db")
  await user.click(screen.getByRole("button", { name: /create/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("create_database", {
      id: "conn-1",
      dbName: "new_db",
    })
  })
})

it("calls onCreated and closes on success", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue(null)

  render(<NewDatabaseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "new_db")
  await user.click(screen.getByRole("button", { name: /create/i }))

  await waitFor(() => {
    expect(mockOnCreated).toHaveBeenCalledOnce()
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })
})

it("shows error when creation fails", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockRejectedValue(new Error("permission denied"))

  render(<NewDatabaseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "new_db")
  await user.click(screen.getByRole("button", { name: /create/i }))

  await waitFor(() => {
    expect(screen.getByText(/permission denied/)).toBeInTheDocument()
  })
})

it("calls onOpenChange when cancel is clicked", async () => {
  const user = userEvent.setup()
  render(<NewDatabaseDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /cancel/i }))
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})
