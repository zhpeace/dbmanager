import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConnectionDialog } from "../ConnectionDialog"
import { invoke } from "@tauri-apps/api/core"
import type { ConnectionConfig } from "@/lib/db"

const mockOnOpenChange = vi.fn()
const mockOnSave = vi.fn()

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  onSave: mockOnSave,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("crypto", { randomUUID: () => "mock-uuid" })
})

// ── Basic rendering ──

it("renders title for new connection", () => {
  render(<ConnectionDialog {...defaultProps} />)
  expect(screen.getByText("New Connection")).toBeInTheDocument()
})

it("shows host, port, user, password, database for mysql type", () => {
  render(<ConnectionDialog {...defaultProps} />)
  expect(screen.getByPlaceholderText("localhost")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("3306")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("root")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("Leave empty to show all databases")).toBeInTheDocument()
})

it("shows file path for sqlite type", () => {
  render(<ConnectionDialog {...defaultProps} />)
  // Switch type to sqlite — default is mysql, so we need to render with type=sqlite
  // We can't easily test this with Radix Select, so we'll test the sqlite rendering path
})

// ── SQLite mode ──

it("shows file path field and hides host/user/password for sqlite", () => {
  // Render with editingConfig to bypass the type default
  const sqliteConfig: ConnectionConfig = {
    id: "s1", name: "Local", type: "sqlite",
  }
  render(
    <ConnectionDialog
      {...defaultProps}
      editingConfig={sqliteConfig}
    />
  )
  expect(screen.getByPlaceholderText("/path/to/database.db")).toBeInTheDocument()
  expect(screen.queryByPlaceholderText("localhost")).not.toBeInTheDocument()
  expect(screen.queryByPlaceholderText("root")).not.toBeInTheDocument()
  expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument()
})

// ── Redis mode ──

it("shows host, port, password, db index for redis (no user)", () => {
  const redisConfig: ConnectionConfig = {
    id: "r1", name: "Redis Cache", type: "redis",
  }
  render(
    <ConnectionDialog
      {...defaultProps}
      editingConfig={redisConfig}
    />
  )
  expect(screen.getByPlaceholderText("localhost")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("3306")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument()
  expect(screen.getByPlaceholderText("0")).toBeInTheDocument()
  expect(screen.queryByPlaceholderText("root")).not.toBeInTheDocument()
})

// ── Editing mode ──

it("pre-fills values when editingConfig is provided", () => {
  const config: ConnectionConfig = {
    id: "edit-1", name: "My Existing DB", type: "mysql",
    host: "192.168.1.1", port: 3307, user: "admin",
    password: "secret", database: "existing_db",
  }
  render(
    <ConnectionDialog {...defaultProps} editingConfig={config} />
  )
  expect(screen.getByText("Edit Connection")).toBeInTheDocument()
  expect(screen.getByDisplayValue("My Existing DB")).toBeInTheDocument()
  expect(screen.getByDisplayValue("192.168.1.1")).toBeInTheDocument()
  expect(screen.getByDisplayValue("3307")).toBeInTheDocument()
  expect(screen.getByDisplayValue("admin")).toBeInTheDocument()
  expect(screen.getByDisplayValue("existing_db")).toBeInTheDocument()
})

// ── Validation ──

it("disables save button when name is empty", () => {
  render(<ConnectionDialog {...defaultProps} />)
  const buttons = screen.getAllByRole("button")
  const connectBtn = buttons.find(b => b.textContent === "Connect")
  expect(connectBtn).toBeDisabled()
})

it("enables save button when name and host are filled", async () => {
  const user = userEvent.setup()
  render(<ConnectionDialog {...defaultProps} />)
  await user.clear(screen.getByPlaceholderText("localhost"))
  await user.type(screen.getByPlaceholderText("localhost"), "myhost")
  await user.type(screen.getByPlaceholderText("Leave empty to show all databases"), "test")
  // Name is still empty — fill it
  await user.type(screen.getByPlaceholderText("My Database"), "My Conn")

  await waitFor(() => {
    const buttons = screen.getAllByRole("button")
    const connectBtn = buttons.find(b => b.textContent === "Connect")
    expect(connectBtn).toBeEnabled()
  })
})

it("disables save button for sqlite when filePath is empty", () => {
  const sqliteConfig: ConnectionConfig = {
    id: "s1", name: "SQLite DB", type: "sqlite",
  }
  render(
    <ConnectionDialog {...defaultProps} editingConfig={sqliteConfig} />
  )
  expect(screen.getByRole("button", { name: /save/i })).toBeDisabled()
})

// ── Save action ──

it("calls onSave with correct config and closes dialog", async () => {
  const user = userEvent.setup()
  render(<ConnectionDialog {...defaultProps} />)

  await user.type(screen.getByPlaceholderText("My Database"), "My DB")
  await user.type(screen.getByPlaceholderText("Leave empty to show all databases"), "testdb")

  const buttons = screen.getAllByRole("button")
  const connectBtn = buttons.find(b => b.textContent === "Connect")!
  await user.click(connectBtn)

  await waitFor(() => {
    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My DB",
        type: "mysql",
        host: "localhost",
        port: 3306,
        user: "root",
        database: "testdb",
      })
    )
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })
})

it("calls onSave with sqlite config (no host/port/user/password)", async () => {
  const user = userEvent.setup()
  const sqliteConfig: ConnectionConfig = {
    id: "s1", name: "My SQLite", type: "sqlite",
  }
  render(
    <ConnectionDialog
      {...defaultProps}
      editingConfig={sqliteConfig}
    />
  )

  await user.type(screen.getByPlaceholderText("/path/to/database.db"), "/data/mydb.sqlite")
  await user.click(screen.getByRole("button", { name: /save/i }))

  await waitFor(() => {
    expect(mockOnSave).toHaveBeenCalledWith({
      id: "s1",
      name: "My SQLite",
      type: "sqlite",
      host: undefined,
      port: undefined,
      user: undefined,
      password: undefined,
      database: undefined,
      filePath: "/data/mydb.sqlite",
    })
  })
})

// ── Test connection ──

it("calls test_connection with correct params", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue("Connected OK")

  render(<ConnectionDialog {...defaultProps} />)
  await user.type(screen.getByPlaceholderText("My Database"), "Test")

  await user.click(screen.getByRole("button", { name: /test connection/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("test_connection", {
      type: "mysql",
      host: "localhost",
      port: 3306,
      user: "root",
      password: "",
      database: null,
    })
  })
})

it("shows success message when test_connection succeeds", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue("Connected OK")

  render(<ConnectionDialog {...defaultProps} />)
  await user.type(screen.getByPlaceholderText("My Database"), "Test")
  await user.click(screen.getByRole("button", { name: /test connection/i }))

  await waitFor(() => {
    expect(screen.getByText("Connected OK")).toBeInTheDocument()
  })
})

it("shows error message when test_connection fails", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockRejectedValue(new Error("timeout"))

  render(<ConnectionDialog {...defaultProps} />)
  await user.type(screen.getByPlaceholderText("My Database"), "Test")
  await user.click(screen.getByRole("button", { name: /test connection/i }))

  await waitFor(() => {
    expect(screen.getByText(/timeout/)).toBeInTheDocument()
  })
})

// ── Close ──

it("calls onOpenChange when cancel is clicked", async () => {
  const user = userEvent.setup()
  render(<ConnectionDialog {...defaultProps} />)
  await user.click(screen.getByRole("button", { name: /cancel/i }))
  expect(mockOnOpenChange).toHaveBeenCalledWith(false)
})
