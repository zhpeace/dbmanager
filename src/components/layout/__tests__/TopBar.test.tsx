import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TopBar } from "../TopBar"

const mockToggleTheme = vi.fn()
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: mockToggleTheme }),
}))

const mockOnNewConnection = vi.fn()
const mockOnOpenErDiagram = vi.fn()
const mockOnOpenImport = vi.fn()
const mockOnOpenTransfer = vi.fn()
const mockOnOpenCompare = vi.fn()
const mockOnOpenBackup = vi.fn()
const mockOnOpenRestore = vi.fn()
const mockOnOpenSchedule = vi.fn()

const defaultProps = {
  onNewConnection: mockOnNewConnection,
}

beforeEach(() => {
  vi.clearAllMocks()
})

it("renders title, language toggle, and new connection button", () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.getByText("DBManager")).toBeInTheDocument()
  expect(screen.getByText("中文")).toBeInTheDocument()
  expect(screen.getByText("New Connection")).toBeInTheDocument()
})

it("does not show connection breadcrumb or action buttons when no connectionId", () => {
  render(<TopBar {...defaultProps} />)
  expect(screen.queryByText("No database selected")).not.toBeInTheDocument()
  expect(screen.queryByText("ER Diagram")).not.toBeInTheDocument()
  expect(screen.queryByText("Import")).not.toBeInTheDocument()
  expect(screen.queryByText("Transfer")).not.toBeInTheDocument()
  expect(screen.queryByText("Compare")).not.toBeInTheDocument()
  expect(screen.queryByText("Backup")).not.toBeInTheDocument()
  expect(screen.queryByText("Restore")).not.toBeInTheDocument()
  expect(screen.queryByText("Schedule")).not.toBeInTheDocument()
})

it("shows connection name and database in breadcrumb", () => {
  render(
    <TopBar
      {...defaultProps}
      connectionId="c1"
      connectionName="My DB"
      currentDatabase="testdb"
    />
  )
  expect(screen.getByText("My DB")).toBeInTheDocument()
  expect(screen.getByText("testdb")).toBeInTheDocument()
})

it("shows 'No database selected' when connected but no database chosen", () => {
  render(
    <TopBar
      {...defaultProps}
      connectionId="c1"
      connectionName="My DB"
    />
  )
  expect(screen.getByText("No database selected")).toBeInTheDocument()
})

it("shows action buttons when connectionId is provided", () => {
  render(
    <TopBar {...defaultProps} connectionId="c1" />
  )
  expect(screen.getByText("ER Diagram")).toBeInTheDocument()
  expect(screen.getByText("Import")).toBeInTheDocument()
  expect(screen.getByText("Transfer")).toBeInTheDocument()
  expect(screen.getByText("Compare")).toBeInTheDocument()
  expect(screen.getByText("Backup")).toBeInTheDocument()
  expect(screen.getByText("Restore")).toBeInTheDocument()
  expect(screen.getByText("Schedule")).toBeInTheDocument()
})

it("calls onNewConnection when New Connection button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} />)
  await user.click(screen.getByText("New Connection"))
  expect(mockOnNewConnection).toHaveBeenCalledTimes(1)
})

it("calls onOpenErDiagram when ER Diagram button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenErDiagram={mockOnOpenErDiagram} />)
  await user.click(screen.getByText("ER Diagram"))
  expect(mockOnOpenErDiagram).toHaveBeenCalledTimes(1)
})

it("calls onOpenImport when Import button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenImport={mockOnOpenImport} />)
  await user.click(screen.getByText("Import"))
  expect(mockOnOpenImport).toHaveBeenCalledTimes(1)
})

it("calls onOpenTransfer when Transfer button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenTransfer={mockOnOpenTransfer} />)
  await user.click(screen.getByText("Transfer"))
  expect(mockOnOpenTransfer).toHaveBeenCalledTimes(1)
})

it("calls onOpenCompare when Compare button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenCompare={mockOnOpenCompare} />)
  await user.click(screen.getByText("Compare"))
  expect(mockOnOpenCompare).toHaveBeenCalledTimes(1)
})

it("calls onOpenBackup when Backup button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenBackup={mockOnOpenBackup} />)
  await user.click(screen.getByText("Backup"))
  expect(mockOnOpenBackup).toHaveBeenCalledTimes(1)
})

it("calls onOpenRestore when Restore button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenRestore={mockOnOpenRestore} />)
  await user.click(screen.getByText("Restore"))
  expect(mockOnOpenRestore).toHaveBeenCalledTimes(1)
})

it("calls onOpenSchedule when Schedule button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} connectionId="c1" onOpenSchedule={mockOnOpenSchedule} />)
  await user.click(screen.getByText("Schedule"))
  expect(mockOnOpenSchedule).toHaveBeenCalledTimes(1)
})

it("toggles theme when theme button is clicked", async () => {
  const user = userEvent.setup()
  render(<TopBar {...defaultProps} />)
  const buttons = screen.getAllByRole("button")
  // Theme toggle is the icon-only button with no visible text
  const themeBtn = buttons.find(b => !b.textContent)
  expect(themeBtn).toBeDefined()
  await user.click(themeBtn!)
  expect(mockToggleTheme).toHaveBeenCalledTimes(1)
})
