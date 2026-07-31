import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DuplicateDatabaseDialog } from "../DuplicateDatabaseDialog"
import { invoke } from "@tauri-apps/api/core"

const mockOnOpenChange = vi.fn()
const mockOnDone = vi.fn()

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  connectionId: "conn-1",
  sourceDb: "mydb",
  onDone: mockOnDone,
}

beforeEach(() => {
  vi.clearAllMocks()
})

it("renders with correct title and source database", () => {
  render(<DuplicateDatabaseDialog {...defaultProps} />)
  expect(screen.getByText("Duplicate Database")).toBeInTheDocument()
  expect(screen.getByText("mydb")).toBeInTheDocument()
})

it("defaults target name to sourceDb + _copy", () => {
  render(<DuplicateDatabaseDialog {...defaultProps} />)
  const input = screen.getByRole("textbox") as HTMLInputElement
  expect(input.value).toBe("mydb_copy")
})

it("calls duplicateDatabase with correct params on submit", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue({
    tables_transferred: ["t1"],
    rows_transferred: 10,
    duration: "0.5s",
    errors: [],
  })

  render(<DuplicateDatabaseDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /duplicate/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("duplicate_database", {
      id: "conn-1",
      sourceDb: "mydb",
      targetDb: "mydb_copy",
    })
  })
})

it("shows success message after duplicate completes", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue({
    tables_transferred: ["t1", "t2"],
    rows_transferred: 100,
    duration: "1.2s",
    errors: [],
  })

  render(<DuplicateDatabaseDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /duplicate/i }))

  await waitFor(() => {
    expect(screen.getByText(/100/)).toBeInTheDocument()
  })
})

it("shows error when duplicate fails", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockRejectedValue(new Error("connection lost"))

  render(<DuplicateDatabaseDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /duplicate/i }))

  await waitFor(() => {
    expect(screen.getByText(/connection lost/)).toBeInTheDocument()
  })
})

it("calls onOpenChange and onDone when close is clicked", async () => {
  const user = userEvent.setup()
  render(<DuplicateDatabaseDialog {...defaultProps} />)
  const [footerClose] = screen.getAllByRole("button", { name: /close/i })
  await user.click(footerClose)
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  expect(mockOnDone).toHaveBeenCalled()
})
