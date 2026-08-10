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

it("calls onCreated when duplicate completes", async () => {
  const user = userEvent.setup()
  const mockOnCreated = vi.fn()
  vi.mocked(invoke).mockResolvedValue({
    tables_transferred: ["t1"],
    rows_transferred: 10,
    duration: "0.5s",
    errors: [],
  })

  render(<DuplicateDatabaseDialog {...defaultProps} onCreated={mockOnCreated} />)
  await user.click(screen.getByRole("button", { name: /duplicate/i }))

  await waitFor(() => {
    expect(mockOnCreated).toHaveBeenCalled()
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

it("allows retry after failure", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockRejectedValueOnce(new Error("boom"))
    .mockResolvedValueOnce({
      tables_transferred: ["t1"],
      rows_transferred: 5,
      duration: "0.2s",
      errors: [],
    })

  render(<DuplicateDatabaseDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /duplicate/i }))
  await waitFor(() => {
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  const retryBtn = screen.getByRole("button", { name: /duplicate/i })
  expect(retryBtn).toBeEnabled()
  await user.click(retryBtn)
  await waitFor(() => {
    expect(screen.getByText(/5/)).toBeInTheDocument()
  })
})

it("shows duplicating label while copying", async () => {
  const user = userEvent.setup()
  let resolveInvoke: (v: any) => void
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => { resolveInvoke = resolve }))

  render(<DuplicateDatabaseDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /duplicate/i }))

  expect(screen.getByRole("button", { name: /duplicating/i })).toBeInTheDocument()
  resolveInvoke!({ tables_transferred: ["t1"], rows_transferred: 1, duration: "0.1s", errors: [] })
  await waitFor(() => {
    expect(screen.getByText(/1/)).toBeInTheDocument()
  })
})

it("blocks submit when target name is same as source", async () => {
  const user = userEvent.setup()
  render(<DuplicateDatabaseDialog {...defaultProps} sourceDb="prod" />)
  const input = screen.getByRole("textbox")
  await user.clear(input)
  await user.type(input, "prod")

  expect(screen.getByText(/different from the source/i)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /duplicate/i })).toBeDisabled()
})

it("blocks submit for invalid characters in name", async () => {
  const user = userEvent.setup()
  render(<DuplicateDatabaseDialog {...defaultProps} />)
  const input = screen.getByRole("textbox")
  await user.clear(input)
  await user.type(input, "bad/name")

  expect(screen.getByText(/invalid characters/i)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /duplicate/i })).toBeDisabled()
})

it("calls onOpenChange and onDone when close is clicked", async () => {
  const user = userEvent.setup()
  render(<DuplicateDatabaseDialog {...defaultProps} />)
  const [footerClose] = screen.getAllByRole("button", { name: /close/i })
  await user.click(footerClose)
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  expect(mockOnDone).toHaveBeenCalled()
})
