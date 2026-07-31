import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { invoke } from "@tauri-apps/api/core"
import { CompareDialog } from "../CompareDialog"
import { compareSchemas } from "@/lib/db"
import type { Connection } from "@/lib/db"

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, compareSchemas: vi.fn() }
})

const conn1: Connection = {
  id: "c1", connected: true,
  config: { id: "c1", name: "MySQL DB", type: "mysql", host: "localhost", port: 3306, user: "root" },
}
const conn2: Connection = {
  id: "c2", connected: true,
  config: { id: "c2", name: "PG DB", type: "postgresql", host: "localhost", port: 5432, user: "postgres" },
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connections: [conn1, conn2],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue([{ name: "mydb" }])
})

function getCombobox(text: string): HTMLElement {
  const el = screen.getByText(text)
  return el.closest('[role="combobox"]')!
}

async function selectAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_databases", { id: "c1" }))
  const combos = screen.getAllByRole("combobox")
  await user.click(combos[1])
  await user.click(screen.getAllByText("mydb")[0])
  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("PG DB (postgresql)"))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_databases", { id: "c2" }))
  const combos2 = screen.getAllByRole("combobox")
  await user.click(combos2[3])
  await user.click(screen.getAllByText("mydb")[1])
}

it("renders title and source/target selects", () => {
  render(<CompareDialog {...defaultProps} />)
  expect(screen.getByText("Compare Schemas")).toBeInTheDocument()
  expect(screen.getByText("Source")).toBeInTheDocument()
  expect(screen.getByText("Target")).toBeInTheDocument()
})

it("shows connected connections in source select", async () => {
  const user = userEvent.setup()
  render(<CompareDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  expect(screen.getByText("MySQL DB (mysql)")).toBeInTheDocument()
  expect(screen.getByText("PG DB (postgresql)")).toBeInTheDocument()
})

it("filters selected source from target options", async () => {
  const user = userEvent.setup()
  render(<CompareDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await user.click(getCombobox("Select target"))
  expect(screen.getByText("PG DB (postgresql)")).toBeInTheDocument()
})

it("loads source databases after selecting source connection", async () => {
  const user = userEvent.setup()
  render(<CompareDialog {...defaultProps} />)
  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await waitFor(() => {
    expect(screen.getByText("Select database")).toBeInTheDocument()
  })
})

it("disables compare button until all selections made", async () => {
  const user = userEvent.setup()
  render(<CompareDialog {...defaultProps} />)
  expect(screen.getByText("Compare")).toBeDisabled()
  await selectAll(user)
  await waitFor(() => {
    expect(screen.getByText("Compare")).toBeEnabled()
  })
})

it("calls compareSchemas and shows result", async () => {
  const user = userEvent.setup()
  vi.mocked(compareSchemas).mockResolvedValue({
    tables: [
      {
        table: "users", status: "match",
        columns: [], indexes: [], foreign_keys: [], sync_sql: [],
      },
    ],
    extra_in_source: [],
    extra_in_target: [],
    summary: "1 table compared, 1 match",
  })
  render(<CompareDialog {...defaultProps} />)
  await selectAll(user)
  await user.click(screen.getByText("Compare"))
  await waitFor(() => {
    expect(compareSchemas).toHaveBeenCalledWith("c1", "mydb", "c2", "mydb")
  })
  expect(screen.getByText("1 table compared, 1 match")).toBeInTheDocument()
  expect(screen.getByText("users")).toBeInTheDocument()
})

it("shows extra tables in source and target", async () => {
  const user = userEvent.setup()
  vi.mocked(compareSchemas).mockResolvedValue({
    tables: [],
    extra_in_source: ["old_table"],
    extra_in_target: ["new_table"],
    summary: "Check extras",
  })
  render(<CompareDialog {...defaultProps} />)
  await selectAll(user)
  await user.click(screen.getByText("Compare"))
  await waitFor(() => {
    expect(screen.getByText(/Only in source/)).toBeInTheDocument()
  })
  expect(screen.getByText("old_table")).toBeInTheDocument()
  expect(screen.getByText(/Only in target/)).toBeInTheDocument()
  expect(screen.getByText("new_table")).toBeInTheDocument()
})

it("shows error result when compareSchemas fails", async () => {
  const user = userEvent.setup()
  vi.mocked(compareSchemas).mockRejectedValue(new Error("timeout"))
  render(<CompareDialog {...defaultProps} />)
  await selectAll(user)
  await user.click(screen.getByText("Compare"))
  await waitFor(() => {
    expect(screen.getByText(/Error: Error: timeout/)).toBeInTheDocument()
  })
})
