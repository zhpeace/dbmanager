import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { invoke } from "@tauri-apps/api/core"
import { ImportDialog } from "../ImportDialog"
import type { TableInfo } from "@/lib/db"

const tables: TableInfo[] = [
  { name: "users", object_type: "TABLE" },
  { name: "orders", object_type: "TABLE" },
  { name: "collections", object_type: "COLLECTION" },
]

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connectionId: "c1",
  tables,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(invoke).mockResolvedValue(null)
})

function getCombobox(text: string): HTMLElement {
  const el = screen.getByText(text)
  return el.closest('[role="combobox"]')!
}

function selectOption(text: string) {
  const option = screen.getByText(text)
  return option.closest('[role="option"]') ?? option
}

it("renders title and table select", () => {
  render(<ImportDialog {...defaultProps} />)
  expect(screen.getByText("Import Data")).toBeInTheDocument()
  expect(screen.getByText("Target Table")).toBeInTheDocument()
})

it("shows only TABLE type options in select", async () => {
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  expect(screen.getByText("users")).toBeInTheDocument()
  expect(screen.getByText("orders")).toBeInTheDocument()
  expect(screen.queryByText("collections")).not.toBeInTheDocument()
})

it("disables file upload button when no table selected", () => {
  render(<ImportDialog {...defaultProps} />)
  expect(screen.getByText("Choose CSV/JSON file")).toBeDisabled()
})

it("enables file upload button when table selected", async () => {
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  await user.click(screen.getByText("users"))
  expect(screen.getByText("Choose CSV/JSON file")).toBeEnabled()
})

it("imports CSV data successfully", async () => {
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  await user.click(screen.getByText("users"))
  const file = new File(["name,email\nAlice,alice@test.com\nBob,bob@test.com"], "data.csv", { type: "text/csv" })
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(fileInput, file)
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("execute_query", expect.objectContaining({
      query: expect.stringContaining("INSERT INTO"),
    }))
  })
})

it("imports JSON array data successfully", async () => {
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  await user.click(screen.getByText("users"))
  const file = new File([JSON.stringify([{ name: "Alice", email: "alice@test.com" }])], "data.json", { type: "application/json" })
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(fileInput, file)
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("execute_query", expect.objectContaining({
      id: "c1",
    }))
  })
})

it("shows success message after import", async () => {
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  await user.click(screen.getByText("users"))
  const file = new File(["col\nval1\nval2"], "data.csv", { type: "text/csv" })
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(fileInput, file)
  await waitFor(() => {
    expect(screen.getByText(/Successfully imported 2 rows/)).toBeInTheDocument()
  })
})

it("shows error when file is empty CSV", async () => {
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  await user.click(screen.getByText("users"))
  const file = new File(["header"], "data.csv", { type: "text/csv" })
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(fileInput, file)
  await waitFor(() => {
    expect(screen.getByText(/Import failed/)).toBeInTheDocument()
  })
})

it("shows error when execute_query fails", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("constraint violation"))
  const user = userEvent.setup()
  render(<ImportDialog {...defaultProps} />)
  await user.click(getCombobox("Select table"))
  await user.click(screen.getByText("users"))
  const file = new File(["col\nval1"], "data.csv", { type: "text/csv" })
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(fileInput, file)
  await waitFor(() => {
    expect(screen.getByText("Import failed: Error: constraint violation")).toBeInTheDocument()
  })
})

it("closes dialog when Close clicked", async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  render(<ImportDialog {...defaultProps} onOpenChange={onOpenChange} />)
  const closeButtons = screen.getAllByRole("button", { name: "Close" })
  await user.click(closeButtons[closeButtons.length - 1])
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
