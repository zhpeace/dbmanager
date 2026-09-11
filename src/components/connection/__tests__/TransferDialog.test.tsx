import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
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

it("starts a background transfer and closes the dialog immediately", async () => {
  const user = userEvent.setup()
  const { __resetTransferTasksForTest } = await import("@/lib/transferTasks")
  __resetTransferTasksForTest()
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

  // 后台任务：transfer_data 被调用并带 taskId
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("transfer_data", expect.objectContaining({
      opts: expect.objectContaining({
        source_id: "c1",
        source_database: "mydb",
        target_id: "c2",
        target_database: "target_db",
        tables: ["users"],
      }),
      taskId: expect.any(String),
    }))
  })

  // 对话框立即关闭，结果不再展示在对话框里
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  expect(screen.queryByText(/Transferred 100 rows/)).not.toBeInTheDocument()
})

it("starts a background transfer even when it has errors", async () => {
  const user = userEvent.setup()
  const { __resetTransferTasksForTest } = await import("@/lib/transferTasks")
  __resetTransferTasksForTest()
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
    expect(invoke).toHaveBeenCalledWith("transfer_data", expect.objectContaining({
      taskId: expect.any(String),
    }))
  })
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  // 错误不展示在对话框（任务中心展示）
  expect(screen.queryByText("insert failed on row 5: duplicate key")).not.toBeInTheDocument()
})

it("dismisses on overlay click and Esc (non-modal)", async () => {
  const user = userEvent.setup()
  render(<TransferDialog {...defaultProps} />)

  fireEvent.keyDown(document.body, { key: "Escape" })
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})

describe("groupLogs", () => {
  it("groups per-table logs and flags errors", async () => {
    const { groupLogs } = await import("../TransferDialog")
    const logs = [
      "Starting table: users",
      "Creating table 'users'...",
      "Completed table: users",
      "Starting table: orders",
      "Creating table 'orders'...",
      "Failed to create table 'orders': error returned from database: boom",
    ]
    const groups = groupLogs(logs)
    expect(groups).toHaveLength(2)
    expect(groups[0].table).toBe("users")
    expect(groups[0].hasError).toBe(false)
    expect(groups[0].lines).toHaveLength(3)
    expect(groups[1].table).toBe("orders")
    expect(groups[1].hasError).toBe(true)
  })
})
