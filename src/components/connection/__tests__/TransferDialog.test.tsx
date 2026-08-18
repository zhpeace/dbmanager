import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TransferDialog } from "../TransferDialog"
import { invoke } from "@tauri-apps/api/core"
import type { Connection } from "@/lib/db"

const mockOnOpenChange = vi.fn()

const conn1: Connection = {
  id: "c1",
  connected: true,
  config: { id: "c1", name: "MySQL DB", type: "mysql", host: "localhost", port: 3306, user: "root" },
}

const conn2: Connection = {
  id: "c2",
  connected: true,
  config: { id: "c2", name: "PG DB", type: "postgresql", host: "localhost", port: 5432, user: "postgres" },
}

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  connections: [conn1, conn2],
}

type CommandHandlers = Record<string, unknown>

function mockCommands(handlers: CommandHandlers) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd in handlers) return handlers[cmd]
    return null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCommands({})
})

function getCombobox(text: string): HTMLElement {
  const span = screen.getByText(text)
  return span.closest('[role="combobox"]')!
}

it("renders title and source/target selects", () => {
  render(<TransferDialog {...defaultProps} />)
  expect(screen.getByText("Data Transfer")).toBeInTheDocument()
  expect(screen.getByText("Select source")).toBeInTheDocument()
  expect(screen.getByText("Select target")).toBeInTheDocument()
})

it("loads source databases after selecting source connection", async () => {
  const user = userEvent.setup()
  mockCommands({ get_databases: [{ name: "source_db" }] })

  render(<TransferDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_databases", { id: "c1" })
  })
})

it("loads target databases after selecting target connection", async () => {
  const user = userEvent.setup()
  mockCommands({ get_databases: [{ name: "target_db" }] })

  render(<TransferDialog {...defaultProps} />)
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("PG DB (postgresql)"))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_databases", { id: "c2" })
  })
})

it("renders table checkboxes after selecting source database", async () => {
  const user = userEvent.setup()
  mockCommands({
    get_databases: [{ name: "mydb" }],
    get_tables: [
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
      { name: "collections", object_type: "COLLECTION" },
    ],
  })

  render(<TransferDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("mydb"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
    expect(screen.getByText("orders")).toBeInTheDocument()
    expect(screen.getByText("collections")).toBeInTheDocument()
  })
})

it("select all toggles all table checkboxes", async () => {
  const user = userEvent.setup()
  mockCommands({
    get_databases: [{ name: "mydb" }],
    get_tables: [
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
    ],
  })

  render(<TransferDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("mydb"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })

  await user.click(screen.getByText(/Select All/))
  expect(screen.getByText(/2\/2/)).toBeInTheDocument()
})

it("disables start button when required fields are missing", () => {
  render(<TransferDialog {...defaultProps} />)
  expect(screen.getByRole("button", { name: /Start Transfer/i })).toBeDisabled()
})

it("enables start button when source, target, and tables selected", async () => {
  const user = userEvent.setup()
  mockCommands({
    get_databases: [{ name: "mydb" }, { name: "target_db" }],
    get_tables: [{ name: "users", object_type: "TABLE" }],
  })

  render(<TransferDialog {...defaultProps} />)

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("mydb"))

  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("PG DB (postgresql)"))
  await waitFor(() => {
    expect(screen.getByText("Select target db")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target db"))
  await user.click(screen.getByText("target_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Start Transfer/i })).toBeEnabled()
  })
})

function setupTransferMocks(result?: any) {
  mockCommands({
    get_databases: [{ name: "mydb" }, { name: "target_db" }],
    get_tables: [{ name: "users", object_type: "TABLE" }],
    transfer_data: result ?? null,
  })
}

async function setupTransferDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await waitFor(() => {
    expect(screen.getByText("Select source database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("mydb"))

  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("PG DB (postgresql)"))
  await waitFor(() => {
    expect(screen.getByText("Select target db")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target db"))
  await user.click(screen.getByText("target_db"))
}

it("calls transfer_data and shows success result", async () => {
  const user = userEvent.setup()
  setupTransferMocks({
    tables_transferred: ["users"],
    rows_transferred: 100,
    errors: [],
    duration: "1.2s",
    logs: ["Created table users", "Inserted 100 rows"],
  })

  render(<TransferDialog {...defaultProps} />)

  await setupTransferDialog(user)

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))

  await user.click(screen.getByRole("button", { name: /Start Transfer/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("transfer_data", expect.objectContaining({
      opts: expect.objectContaining({
        source_id: "c1",
        source_database: "mydb",
        target_id: "c2",
        target_database: "target_db",
        tables: ["users"],
      }),
    }))
  })

  await waitFor(() => {
    expect(screen.getByText(/Transferred 100 rows/)).toBeInTheDocument()
  })
})

it("shows errors when transfer has errors", async () => {
  const user = userEvent.setup()
  setupTransferMocks({
    tables_transferred: ["users"],
    rows_transferred: 50,
    errors: ["insert failed on row 5: duplicate key"],
    duration: "0.8s",
    logs: [],
  })

  render(<TransferDialog {...defaultProps} />)

  await setupTransferDialog(user)

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))

  await user.click(screen.getByRole("button", { name: /Start Transfer/i }))

  await waitFor(() => {
    expect(screen.getByText("insert failed on row 5: duplicate key")).toBeInTheDocument()
  })
})

it("toggles advanced options panel", async () => {
  const user = userEvent.setup()
  render(<TransferDialog {...defaultProps} />)
  expect(screen.queryByText("Transfer Mode")).not.toBeInTheDocument()

  await user.click(screen.getByText("Advanced Options"))
  expect(screen.getByText("Transfer Mode")).toBeInTheDocument()
  expect(screen.getByText("Conflict Strategy")).toBeInTheDocument()
})

it("calls onOpenChange when cancel is clicked", async () => {
  const user = userEvent.setup()
  render(<TransferDialog {...defaultProps} />)
  await user.click(screen.getByText("Cancel"))
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})

it("never dismisses on overlay click or Esc; close via explicit button", async () => {
  const user = userEvent.setup()
  let resolveTransfer: (v: unknown) => void
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "transfer_data") {
      return new Promise((res) => { resolveTransfer = res })
    }
    if (cmd === "get_databases") return [{ name: "mydb" }, { name: "target_db" }]
    if (cmd === "get_tables") return [{ name: "users", object_type: "TABLE" }]
    return null
  })

  render(<TransferDialog {...defaultProps} />)
  await setupTransferDialog(user)

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText(/Select All/))

  const overlay = screen.getByRole("dialog").previousElementSibling!
  fireEvent.pointerDown(overlay)
  fireEvent.pointerUp(overlay)
  fireEvent.click(overlay)
  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(mockOnOpenChange).not.toHaveBeenCalled()

  await user.click(screen.getByRole("button", { name: /Start Transfer/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("transfer_data", expect.anything())
  })

  const overlay2 = screen.getByRole("dialog").previousElementSibling!
  fireEvent.pointerDown(overlay2)
  fireEvent.pointerUp(overlay2)
  fireEvent.click(overlay2)
  expect(mockOnOpenChange).not.toHaveBeenCalled()

  resolveTransfer!({
    tables_transferred: ["users"],
    rows_transferred: 100,
    errors: [],
    duration: "1.2s",
    logs: [],
  })

  await waitFor(() => {
    expect(screen.getByText(/Transferred 100 rows/)).toBeInTheDocument()
  })

  const overlay3 = screen.getByRole("dialog").previousElementSibling!
  fireEvent.pointerDown(overlay3)
  fireEvent.pointerUp(overlay3)
  fireEvent.click(overlay3)
  expect(mockOnOpenChange).not.toHaveBeenCalled()

  const closeButtons = screen.getAllByRole("button", { name: /Close/i })
  const footerClose = closeButtons.find(b => b.className.includes("bg-primary"))
  await user.click(footerClose!)
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})
