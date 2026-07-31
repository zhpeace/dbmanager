import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SchedulerDialog } from "../SchedulerDialog"
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
  connected: false,
  config: { id: "c2", name: "Offline PG", type: "postgresql", host: "example.com", port: 5432, user: "postgres" },
}

const defaultProps = {
  open: true,
  onOpenChange: mockOnOpenChange,
  connections: [conn1, conn2],
}

const sampleTask = {
  id: "t1",
  name: "Nightly Backup",
  cron_expr: "0 0 2 * * *",
  enabled: true,
  config: { type: "Backup" as const, source_id: "c1", database: "mydb", tables: ["users"], output_path: "/tmp/backup.sql" },
  created_at: "2025-01-01T00:00:00Z",
  last_run: "2025-01-02T02:00:00Z",
  next_run: "2025-01-03T02:00:00Z",
  last_result: "OK (5 tables)",
}

const sampleTransferTask = {
  id: "t2",
  name: "Data Sync",
  cron_expr: "0 */6 * * *",
  enabled: false,
  config: { type: "Transfer" as const, source_id: "c1", source_database: "source_db", target_id: "c1", target_database: "target_db", tables: ["users"], mode: "structure_and_data" as const, conflict_strategy: "error" as const },
  created_at: "2025-01-01T00:00:00Z",
  last_run: null,
  next_run: null,
  last_result: null,
}

// Mock @/lib/db functions to avoid invoke queue-poisoning between tests
const mockListTasks = vi.fn<() => Promise<any[]>>()
const mockCreateTask = vi.fn()
const mockUpdateTask = vi.fn()
const mockDeleteTask = vi.fn()
const mockToggleTask = vi.fn()

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual as any,
    listScheduledTasks: (...args: any[]) => mockListTasks(...args),
    createScheduledTask: (...args: any[]) => mockCreateTask(...args),
    updateScheduledTask: (...args: any[]) => mockUpdateTask(...args),
    deleteScheduledTask: (...args: any[]) => mockDeleteTask(...args),
    toggleScheduledTask: (...args: any[]) => mockToggleTask(...args),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue([]) // for get_databases / get_tables
  mockListTasks.mockResolvedValue([])
  mockCreateTask.mockResolvedValue(undefined)
  mockUpdateTask.mockResolvedValue(undefined)
  mockDeleteTask.mockResolvedValue(undefined)
  mockToggleTask.mockResolvedValue(undefined)
})

function getCombobox(text: string): HTMLElement {
  const span = screen.getByText(text)
  return span.closest('[role="combobox"]')!
}

// ── List view tests ──

it("renders title and create button", () => {
  render(<SchedulerDialog {...defaultProps} />)
  expect(screen.getByText("Scheduled Tasks")).toBeInTheDocument()
  expect(screen.getByText("Create Scheduled Task")).toBeInTheDocument()
})

it("shows empty state when no tasks exist", async () => {
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
})

it("displays task list with task data", async () => {
  mockListTasks.mockResolvedValueOnce([sampleTask])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument()
    expect(screen.getByText("0 0 2 * * *")).toBeInTheDocument()
    expect(screen.getByText("Backup")).toBeInTheDocument()
    expect(screen.getByText("OK (5 tables)")).toBeInTheDocument()
  })
})

it("shows loading state then renders tasks", async () => {
  const taskNoLastRun = { ...sampleTask, last_run: null, next_run: null, last_result: null }
  mockListTasks.mockResolvedValueOnce([taskNoLastRun])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument()
  })
  expect(screen.getByText("Never")).toBeInTheDocument()
})

it("opens task form when create is clicked", async () => {
  const user = userEvent.setup()
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))
  expect(screen.getByText("Task Name")).toBeInTheDocument()
  expect(screen.getByText("Cron Expression")).toBeInTheDocument()
})

it("closes form and returns to list on cancel", async () => {
  const user = userEvent.setup()
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))
  expect(screen.getByText("Task Name")).toBeInTheDocument()
  await user.click(screen.getByText("Cancel"))
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
})

it("edit button opens form with pre-filled task data", async () => {
  const user = userEvent.setup()
  mockListTasks.mockResolvedValueOnce([sampleTask])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument()
  })

  await waitFor(() => {
    expect(document.querySelector("tbody tr")).toBeTruthy()
  })
  const taskRow = document.querySelector("tbody tr")!
  const editBtn = taskRow.querySelector(".lucide-pencil")!.closest("button")!
  await user.click(editBtn)

  await waitFor(() => {
    expect(screen.getByDisplayValue("Nightly Backup")).toBeInTheDocument()
    expect(screen.getByDisplayValue("0 0 2 * * *")).toBeInTheDocument()
  })
})

it("delete button calls deleteScheduledTask and refreshes", async () => {
  const user = userEvent.setup()
  mockListTasks.mockResolvedValueOnce([sampleTask])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument()
  })

  await waitFor(() => {
    expect(document.querySelector("tbody tr")).toBeTruthy()
  })
  const taskRow = document.querySelector("tbody tr")!
  const deleteBtn = taskRow.querySelector(".lucide-trash-2")!.closest("button")!
  await user.click(deleteBtn)

  await waitFor(() => {
    expect(mockDeleteTask).toHaveBeenCalledWith("t1")
  })
  expect(mockListTasks).toHaveBeenCalledTimes(2)
})

it("toggle switch calls toggleScheduledTask and refreshes", async () => {
  const user = userEvent.setup()
  mockListTasks.mockResolvedValueOnce([sampleTask])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    expect(screen.getByText("Nightly Backup")).toBeInTheDocument()
  })

  const switches = screen.getAllByRole("switch")
  await user.click(switches[0])

  await waitFor(() => {
    expect(mockToggleTask).toHaveBeenCalledWith("t1")
  })
  expect(mockListTasks).toHaveBeenCalledTimes(2)
})

it("shows last_result with green text for OK", async () => {
  mockListTasks.mockResolvedValueOnce([sampleTask])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    const resultEl = screen.getByText("OK (5 tables)")
    expect(resultEl.className).toContain("text-green-500")
  })
})

it("shows last_result with destructive text for errors", async () => {
  mockListTasks.mockResolvedValueOnce([{ ...sampleTask, last_result: "FAILED: timeout" }])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    const resultEl = screen.getByText("FAILED: timeout")
    expect(resultEl.className).toContain("text-destructive")
  })
})

// ── TaskForm: Backup ──

it("creates a Backup task successfully", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "mydb" }])
    .mockResolvedValueOnce([{ name: "users", object_type: "TABLE" }, { name: "orders", object_type: "TABLE" }])

  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))

  await user.type(screen.getByPlaceholderText("Nightly backup"), "My Backup")

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select database"))
  await user.click(screen.getByText("mydb"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText("users"))
  await user.click(screen.getByText("orders"))

  const textboxes = screen.getAllByRole("textbox")
  const pathInput = textboxes[2]
  await user.type(pathInput, "/tmp/backup.sql")

  await user.click(screen.getByText("Add Task"))

  await waitFor(() => {
    expect(mockCreateTask).toHaveBeenCalledWith("My Backup", "0 0 2 * * *", {
      type: "Backup",
      source_id: "c1",
      database: "mydb",
      tables: ["users", "orders"],
      output_path: "/tmp/backup.sql",
    })
  })
})

it("backup form only shows connected connections", async () => {
  const user = userEvent.setup()
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))

  await user.click(getCombobox("Select source"))
  expect(screen.getByText("MySQL DB (mysql)")).toBeInTheDocument()
  expect(screen.queryByText("Offline PG (postgresql)")).not.toBeInTheDocument()
})

it("backup form validates required fields", async () => {
  const user = userEvent.setup()
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))

  await user.click(screen.getByText("Add Task"))
  expect(mockCreateTask).not.toHaveBeenCalled()
})

// ── TaskForm: Transfer ──

it("switches between Backup and Transfer types", async () => {
  const user = userEvent.setup()
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))

  expect(screen.getByText("Save to")).toBeInTheDocument()

  await user.click(getCombobox("Backup"))
  await user.click(screen.getByText("Transfer"))

  expect(screen.queryByText("Save to")).not.toBeInTheDocument()
  expect(screen.getByText("Advanced Options")).toBeInTheDocument()
})

it("creates a Transfer task successfully", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "source_db" }])
    .mockResolvedValueOnce([{ name: "users", object_type: "TABLE" }])
    .mockResolvedValueOnce([{ name: "target_db" }])

  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))

  await user.click(getCombobox("Backup"))
  await user.click(screen.getByText("Transfer"))

  await user.type(screen.getByPlaceholderText("Nightly backup"), "My Transfer")

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))

  await waitFor(() => {
    expect(screen.getByText("Select database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select database"))
  await user.click(screen.getByText("source_db"))

  await waitFor(() => {
    expect(screen.getByText("Select target")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target"))
  const connItems = screen.getAllByText("MySQL DB (mysql)")
  await user.click(connItems[connItems.length - 1])

  await waitFor(() => {
    expect(screen.getByText("Select database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select database"))
  await user.click(screen.getByText("target_db"))

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText("users"))

  await user.click(screen.getByText("Add Task"))

  await waitFor(() => {
    expect(mockCreateTask).toHaveBeenCalledWith("My Transfer", "0 0 2 * * *", expect.objectContaining({
      type: "Transfer",
      source_id: "c1",
      source_database: "source_db",
      target_id: "c1",
      target_database: "target_db",
      tables: ["users"],
    }))
  })
})

it("expands and collapses advanced options in Transfer form", async () => {
  const user = userEvent.setup()
  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))

  await user.click(getCombobox("Backup"))
  await user.click(screen.getByText("Transfer"))

  expect(screen.queryByText("Transfer Mode")).not.toBeInTheDocument()

  await user.click(screen.getByText("Advanced Options"))
  expect(screen.getByText("Transfer Mode")).toBeInTheDocument()
  expect(screen.getByText("Error Handling")).toBeInTheDocument()

  await user.click(screen.getByText("Advanced Options"))
  expect(screen.queryByText("Transfer Mode")).not.toBeInTheDocument()
})

it("pre-fills Transfer fields when editing existing task", async () => {
  const user = userEvent.setup()
  mockListTasks.mockResolvedValueOnce([sampleTransferTask])
  render(<SchedulerDialog {...defaultProps} />)

  await waitFor(() => {
    expect(screen.getByText("Data Sync")).toBeInTheDocument()
  })

  await waitFor(() => {
    expect(document.querySelector("tbody tr")).toBeTruthy()
  })
  const taskRow = document.querySelector("tbody tr")!
  const editBtn = taskRow.querySelector(".lucide-pencil")!.closest("button")!
  await user.click(editBtn)

  await waitFor(() => {
    expect(screen.getByDisplayValue("Data Sync")).toBeInTheDocument()
    expect(screen.getByDisplayValue("0 */6 * * *")).toBeInTheDocument()
    expect(screen.getByText("Disabled")).toBeInTheDocument()
  })
})

it("maps where_clause and row_limit to null in Transfer config", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke)
    .mockResolvedValueOnce([{ name: "source_db" }])
    .mockResolvedValueOnce([{ name: "users", object_type: "TABLE" }])
    .mockResolvedValueOnce([{ name: "target_db" }])

  render(<SchedulerDialog {...defaultProps} />)
  await waitFor(() => {
    expect(screen.getByText("No scheduled tasks yet")).toBeInTheDocument()
  })
  await user.click(screen.getByText("Create Scheduled Task"))
  await user.click(getCombobox("Backup"))
  await user.click(screen.getByText("Transfer"))
  await user.type(screen.getByPlaceholderText("Nightly backup"), "T")

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await waitFor(() => {
    expect(screen.getByText("Select database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select database"))
  await user.click(screen.getByText("source_db"))
  await waitFor(() => {
    expect(screen.getByText("Select target")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select target"))
  const connItems = screen.getAllByText("MySQL DB (mysql)")
  await user.click(connItems[connItems.length - 1])
  await waitFor(() => {
    expect(screen.getByText("Select database")).toBeInTheDocument()
  })
  await user.click(getCombobox("Select database"))
  await user.click(screen.getByText("target_db"))
  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  await user.click(screen.getByText("users"))
  await user.click(screen.getByText("Add Task"))

  await waitFor(() => {
    expect(mockCreateTask).toHaveBeenCalled()
    const config = mockCreateTask.mock.calls[0][2]
    expect(config.where_clause).toBeNull()
    expect(config.row_limit).toBeNull()
  })
})
