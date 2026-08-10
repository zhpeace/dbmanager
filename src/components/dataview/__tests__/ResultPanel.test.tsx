import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ResultPanel } from "../ResultPanel"
import type { ExecResult } from "@/lib/db"

const mockResult: ExecResult = {
  id: "r1",
  title: "结果 1",
  columns: ["id", "name", "email"],
  rows: [
    { id: 1, name: "Alice", email: "alice@test.com" },
    { id: 2, name: "Bob", email: "bob@test.com" },
  ],
  rowCount: 2,
  duration: "1.2s",
}

it("renders empty state when results is null", () => {
  render(<ResultPanel results={null} />)
  expect(screen.getByText("Run a query to see results")).toBeInTheDocument()
  expect(screen.getByText("⌘+↩ to execute")).toBeInTheDocument()
})

it("renders results tab by default", () => {
  render(<ResultPanel results={[mockResult]} />)
  expect(screen.getByText("Results")).toBeInTheDocument()
  const twos = screen.getAllByText("2")
  expect(twos.length).toBeGreaterThanOrEqual(1)
})

it("renders info tab", () => {
  render(<ResultPanel results={[mockResult]} />)
  expect(screen.getByText("Info")).toBeInTheDocument()
})

it("switches to info tab and shows metadata", async () => {
  const user = userEvent.setup()
  render(<ResultPanel results={[mockResult]} />)
  await user.click(screen.getByText("Info"))
  await waitFor(() => {
    expect(screen.getByText("1.2s")).toBeInTheDocument()
  })
  expect(screen.getByText("3")).toBeInTheDocument()
})

it("shows column names in info tab", async () => {
  const user = userEvent.setup()
  render(<ResultPanel results={[mockResult]} />)
  await user.click(screen.getByText("Info"))
  await waitFor(() => {
    expect(screen.getByText("id")).toBeInTheDocument()
  })
  expect(screen.getByText("name")).toBeInTheDocument()
  expect(screen.getByText("email")).toBeInTheDocument()
})

it("displays correct labels in info tab", async () => {
  const user = userEvent.setup()
  render(<ResultPanel results={[mockResult]} />)
  await user.click(screen.getByText("Info"))
  await waitFor(() => {
    expect(screen.getByText("Duration")).toBeInTheDocument()
  })
  expect(screen.getByText("Rows")).toBeInTheDocument()
  expect(screen.getByText("Columns")).toBeInTheDocument()
  expect(screen.getByText("Columns:")).toBeInTheDocument()
})

it("handles result with zero rows", () => {
  const emptyResult: ExecResult = {
    id: "r2",
    title: "结果 2",
    columns: [],
    rows: [],
    rowCount: 0,
    duration: "0.5s",
  }
  render(<ResultPanel results={[emptyResult]} />)
  expect(screen.getByText("Results")).toBeInTheDocument()
})

it("shows no columns heading when columns array is empty", async () => {
  const user = userEvent.setup()
  const noColResult: ExecResult = {
    id: "r3",
    title: "结果 3",
    columns: [],
    rows: [],
    rowCount: 0,
    duration: "0.3s",
  }
  render(<ResultPanel results={[noColResult]} />)
  await user.click(screen.getByText("Info"))
  await waitFor(() => {
    expect(screen.getByText("Duration")).toBeInTheDocument()
  })
  expect(screen.queryByText("Columns:")).not.toBeInTheDocument()
})

it("shows multiple result set tabs", () => {
  const second: ExecResult = {
    id: "r4",
    title: "结果 2",
    columns: ["id"],
    rows: [{ id: 7 }],
    rowCount: 1,
    duration: "0.1s",
  }
  render(<ResultPanel results={[mockResult, second]} />)
  expect(screen.getByText("结果 1")).toBeInTheDocument()
  expect(screen.getByText("结果 2")).toBeInTheDocument()
})
