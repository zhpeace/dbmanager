import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RestoreDialog } from "../RestoreDialog"
import { invoke } from "@tauri-apps/api/core"
import type { Connection } from "@/lib/db"

const mockOnOpenChange = vi.fn()

const connectedConn: Connection = {
  id: "c1",
  connected: true,
  config: { id: "c1", name: "My MySQL", type: "mysql", host: "localhost", port: 3306, user: "root" },
}

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  connections: [connectedConn],
}

beforeEach(() => {
  vi.clearAllMocks()
})

function getCombobox(text: string): HTMLElement {
  const span = screen.getByText(text)
  return span.closest('[role="combobox"]')!
}

it("renders title and target select", () => {
  render(<RestoreDialog {...defaultProps} />)
  expect(screen.getByText("Restore Database")).toBeInTheDocument()
  expect(screen.getByText("Select target")).toBeInTheDocument()
})

it("shows connected connections in target dropdown", async () => {
  const user = userEvent.setup()
  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  expect(screen.getByText("My MySQL (mysql)")).toBeInTheDocument()
})

it("fetches databases after selecting target connection", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue([{ name: "test_db" }])

  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_databases", { id: "c1" })
  })
})

it("shows database select and file input after target is selected", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue([{ name: "test_db" }])

  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select target database")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("/path/to/backup.sql")).toBeInTheDocument()
  })
})

it("disables start button when required fields are missing", () => {
  render(<RestoreDialog {...defaultProps} />)
  expect(screen.getByRole("button", { name: /Start Restore/i })).toBeDisabled()
})

it("enables start button when all fields are filled", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue([{ name: "test_db" }])

  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select target database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target database"))
  await user.click(screen.getByText("test_db"))

  await user.type(screen.getByPlaceholderText("/path/to/backup.sql"), "/tmp/restore.sql")

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Start Restore/i })).toBeEnabled()
  })
})

it("calls restore_database and shows success result", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([42, []]) // restore_database result

  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select target database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target database"))
  await user.click(screen.getByText("test_db"))

  await user.type(screen.getByPlaceholderText("/path/to/backup.sql"), "/tmp/restore.sql")
  await user.click(screen.getByRole("button", { name: /Start Restore/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("restore_database", {
      targetId: "c1",
      database: "test_db",
      inputPath: "/tmp/restore.sql",
    })
  })

  await waitFor(() => {
    expect(screen.getByText("Restore complete")).toBeInTheDocument()
    expect(screen.getByText(/Executed 42 statements/)).toBeInTheDocument()
  })
})

it("shows errors when restore has errors", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([10, ["table users already exists", "constraint failed"]])

  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select target database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target database"))
  await user.click(screen.getByText("test_db"))

  await user.type(screen.getByPlaceholderText("/path/to/backup.sql"), "/tmp/restore.sql")
  await user.click(screen.getByRole("button", { name: /Start Restore/i }))

  await waitFor(() => {
    expect(screen.getByText("Restore complete")).toBeInTheDocument()
    expect(screen.getByText("table users already exists")).toBeInTheDocument()
    expect(screen.getByText("constraint failed")).toBeInTheDocument()
  })
})

it("re-enables start button after restore fails", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockRejectedValueOnce(new Error("permission denied"))

  render(<RestoreDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select target database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target database"))
  await user.click(screen.getByText("test_db"))

  await user.type(screen.getByPlaceholderText("/path/to/backup.sql"), "/tmp/restore.sql")
  await user.click(screen.getByRole("button", { name: /Start Restore/i }))

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Start Restore/i })).toBeEnabled()
  })
})

it("calls onOpenChange when close is clicked", async () => {
  const user = userEvent.setup()
  render(<RestoreDialog {...defaultProps} />)
  const buttons = screen.getAllByRole("button")
  const closeBtn = buttons.find(b => b.textContent === "Close")
  await user.click(closeBtn!)
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})
