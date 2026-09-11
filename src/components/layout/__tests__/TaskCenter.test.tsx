import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TaskCenter } from "../TaskCenter"
import { invoke } from "@tauri-apps/api/core"
import {
  startTransferTask,
  __resetTransferTasksForTest,
} from "@/lib/transferTasks"

const baseOpts = {
  source_id: "s1",
  source_database: "db1",
  target_id: "t1",
  target_database: "db2",
  tables: ["a", "b", "c"],
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetTransferTasksForTest()
})

it("shows empty state", async () => {
  const user = userEvent.setup()
  render(<TaskCenter />)
  await user.click(screen.getByRole("button", { name: /Tasks/i }))
  await waitFor(() => {
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument()
  })
})

it("shows a running task with progress and cancels it", async () => {
  const user = userEvent.setup()
  let rejectTransfer: (v: unknown) => void
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "transfer_data") {
      return new Promise((_, rej) => { rejectTransfer = rej })
    }
    return null
  })

  const p = startTransferTask({
    taskId: "t1",
    opts: baseOpts as never,
    sourceLabel: "MySQL · db1",
    targetLabel: "PG · db2",
    checkpoint: { sourceId: "s1", sourceDb: "db1", targetId: "t1", targetDb: "db2" },
  })

  render(<TaskCenter />)
  await user.click(screen.getByRole("button", { name: /Tasks/i }))

  // running card with labels
  await waitFor(() => {
    expect(screen.getByText(/MySQL/)).toBeInTheDocument()
    expect(screen.getByText(/PG/)).toBeInTheDocument()
  })

  // cancel triggers cancel_transfer
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Cancel task/i })).toBeInTheDocument()
  })
  await user.click(screen.getByRole("button", { name: /Cancel task/i }))
  expect(invoke).toHaveBeenCalledWith("cancel_transfer", { taskId: "t1" })

  // backend rejects with cancelled error
  rejectTransfer!("Transfer cancelled")
  await p

  await waitFor(() => {
    expect(screen.getByText(/Cancelled/)).toBeInTheDocument()
  })

  // cancelled tasks still persist a checkpoint (resume support)
  expect(invoke).toHaveBeenCalledWith(
    "save_checkpoint",
    expect.objectContaining({
      sourceId: "s1",
      sourceDatabase: "db1",
      targetId: "t1",
      targetDatabase: "db2",
      completedTables: [],
    }),
  )
})

it("shows a finished error task with logs", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "transfer_data") {
      return {
        tables_transferred: ["a"],
        rows_transferred: 5,
        errors: ["Failed to create table 'b': boom"],
        duration: "0.3s",
        logs: ["Starting table: a", "Completed table: a", "Starting table: b", "Failed to create table 'b': boom"],
      }
    }
    return null
  })

  await startTransferTask({
    taskId: "t2",
    opts: baseOpts as never,
    sourceLabel: "MySQL · db1",
    targetLabel: "PG · db2",
    checkpoint: null,
  })

  render(<TaskCenter />)
  await user.click(screen.getByRole("button", { name: /Tasks/i }))

  await waitFor(() => {
    expect(screen.getByText(/1 errors/)).toBeInTheDocument()
  })

  // expand to see the error detail
  await user.click(screen.getByText(/MySQL/))
  expect(screen.getAllByText(/Failed to create table 'b'/).length).toBeGreaterThan(0)
})
