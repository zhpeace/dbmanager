import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BackupDialog } from "../BackupDialog"
import { invoke } from "@tauri-apps/api/core"
import type { Connection } from "@/lib/db"

const mockOnOpenChange = vi.fn()

const connectedConn: Connection = {
  id: "c1",
  connected: true,
  config: { id: "c1", name: "My MySQL", type: "mysql", host: "localhost", port: 3306, user: "root" },
}

const disconnectedConn: Connection = {
  id: "c2",
  connected: false,
  config: { id: "c2", name: "Offline DB", type: "mysql", host: "example.com", port: 3306, user: "admin" },
}

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  connections: [connectedConn, disconnectedConn],
}

beforeEach(() => {
  vi.clearAllMocks()
})

function getCombobox(text: string): HTMLElement {
  const span = screen.getByText(text)
  return span.closest('[role="combobox"]')!
}

it("renders title and source select", () => {
  render(<BackupDialog {...defaultProps} />)
  expect(screen.getByText("Backup Database")).toBeInTheDocument()
  expect(screen.getByText("Select source")).toBeInTheDocument()
})

it("only shows connected connections in source dropdown", async () => {
  const user = userEvent.setup()
  render(<BackupDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  expect(screen.getByText("My MySQL (mysql)")).toBeInTheDocument()
  expect(screen.queryByText("Offline DB (mysql)")).not.toBeInTheDocument()
})

it("fetches databases after selecting source connection", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue([{ name: "test_db" }, { name: "analytics" }])

  render(<BackupDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_databases", { id: "c1" })
  })
})

it("shows database select after source is selected", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue([{ name: "test_db" }])

  render(<BackupDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
})

it("renders table checkboxes after selecting source database", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
      { name: "vw_active", object_type: "VIEW" },
    ])

  render(<BackupDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("test_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
    expect(screen.getByText("orders")).toBeInTheDocument()
    expect(screen.queryByText("vw_active")).not.toBeInTheDocument()
  })
})

it("select all toggles all table checkboxes", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
    ])

  render(<BackupDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("test_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })

  const selectAll = screen.getByText(/Select All/)
  await user.click(selectAll)
  expect(screen.getByText(/2\/2/)).toBeInTheDocument()
})

it("disables start button when required fields are missing", () => {
  render(<BackupDialog {...defaultProps} />)
  expect(screen.getByRole("button", { name: /Start Backup/i })).toBeDisabled()
})

it("enables start button when all fields are filled", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
    ])

  render(<BackupDialog {...defaultProps} />)

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("test_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  const selectAll = screen.getByText(/Select All/)
  await user.click(selectAll)

  const pathInput = screen.getByRole("textbox")
  await user.type(pathInput, "/tmp/backup.sql")

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Start Backup/i })).toBeEnabled()
  })
})

it("calls backup_database and shows success result", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
    ])
    .mockResolvedValueOnce([5, "2.3s"])

  render(<BackupDialog {...defaultProps} />)

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("test_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))

  const pathInput = screen.getByRole("textbox")
  await user.type(pathInput, "/tmp/backup.sql")

  await user.click(screen.getByRole("button", { name: /Start Backup/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("backup_database", {
      sourceId: "c1",
      database: "test_db",
      tables: ["users", "orders"],
      outputPath: "/tmp/backup.sql",
    })
  })

  await waitFor(() => {
    expect(screen.getByText("Backup complete")).toBeInTheDocument()
    expect(screen.getByText(/Backed up 5 tables/)).toBeInTheDocument()
  })
})

it("re-enables start button after backup fails", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "test_db" }])
    .mockResolvedValueOnce([
      { name: "users", object_type: "TABLE" },
    ])
    .mockRejectedValueOnce(new Error("disk full"))

  render(<BackupDialog {...defaultProps} />)

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("test_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))

  const pathInput = screen.getByRole("textbox")
  await user.type(pathInput, "/tmp/backup.sql")

  await user.click(screen.getByRole("button", { name: /Start Backup/i }))

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Start Backup/i })).toBeEnabled()
  })
})

it("calls onOpenChange when close is clicked", async () => {
  const user = userEvent.setup()
  render(<BackupDialog {...defaultProps} />)
  const buttons = screen.getAllByRole("button")
  const closeBtn = buttons.find(b => b.textContent === "Close")
  await user.click(closeBtn!)
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})

it("never dismisses on overlay click or Esc while running", async () => {
  const user = userEvent.setup()
  let resolveBackup: (v: unknown) => void
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "backup_database") {
      return new Promise((res) => { resolveBackup = res })
    }
    if (cmd === "get_databases") return [{ name: "test_db" }]
    if (cmd === "get_tables") return [{ name: "users", object_type: "TABLE" }]
    return null
  })

  render(<BackupDialog {...defaultProps} />)

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("My MySQL (mysql)"))
  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("test_db"))
  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))
  await user.type(screen.getByRole("textbox"), "/tmp/backup.sql")
  await user.click(screen.getByRole("button", { name: /Start Backup/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("backup_database", expect.anything())
  })

  const overlay = screen.getByRole("dialog").previousElementSibling!
  fireEvent.pointerDown(overlay)
  fireEvent.pointerUp(overlay)
  fireEvent.click(overlay)
  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(mockOnOpenChange).not.toHaveBeenCalled()

  resolveBackup!([2, "1.0s"])

  await waitFor(() => {
    expect(screen.getByText(/Backed up 2 tables/)).toBeInTheDocument()
  })
})
