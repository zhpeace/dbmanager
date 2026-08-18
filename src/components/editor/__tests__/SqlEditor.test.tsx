import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SqlEditor } from "../SqlEditor"
import { SQL_SNIPPETS } from "@/lib/snippets"

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ onMount }: { onMount: any }) => {
    const editor = {
      getValue: () => "",
      setValue: () => {},
      onDidChangeModelContent: () => {},
      addCommand: () => {},
      getModel: () => null,
      getSelection: () => null,
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      getOffsetAt: () => 0,
      setPosition: () => {},
      revealLineInCenter: () => {},
      trigger: () => {},
      focus: () => {},
    }
    const monaco = {
      KeyMod: { CtrlCmd: 1, Shift: 2 },
      KeyCode: { Enter: 3, F5: 4, Semicolon: 5, KeyS: 6, KeyO: 7, UpArrow: 8 },
      editor: { setModelMarkers: () => {} },
      languages: { registerCompletionItemProvider: () => ({ dispose: () => {} }) },
    }
    onMount(editor, monaco)
    return <div data-testid="monaco-editor" />
  },
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ tables: [] }),
}))

const baseProps = {
  value: "",
  onChange: vi.fn(),
  onExecute: vi.fn(),
  onRunAll: vi.fn(),
  onExplain: vi.fn(),
  onCancel: vi.fn(),
  onSave: vi.fn(),
  onOpen: vi.fn(),
  onHistoryRun: vi.fn(),
  onToggleFavorite: vi.fn(),
  favorites: [],
  onNewTab: vi.fn(),
  onBeginTransaction: vi.fn(),
  onCommitTransaction: vi.fn(),
  onRollbackTransaction: vi.fn(),
  txActive: false,
  executing: false,
  lastExec: null,
  connectionId: null,
  currentDatabase: null,
  dbType: "mysql",
  history: [],
  errorMarker: null,
}

it("renders snippet button and opens the snippet menu", async () => {
  const user = userEvent.setup()
  render(<SqlEditor {...baseProps} />)
  const btn = screen.getByTitle("Snippets")
  await user.click(btn)
  expect(screen.getByText("Snippets")).toBeInTheDocument()
  for (const s of SQL_SNIPPETS.slice(0, 3)) {
    expect(screen.getByText(s.name)).toBeInTheDocument()
  }
})

it("closes snippet menu with Escape", async () => {
  const user = userEvent.setup()
  render(<SqlEditor {...baseProps} />)
  await user.click(screen.getByTitle("Snippets"))
  expect(screen.getByText("INSERT INTO")).toBeInTheDocument()
  fireEvent.keyDown(screen.getByText("Snippets"), { key: "Escape" })
  expect(screen.queryByText("INSERT INTO")).not.toBeInTheDocument()
})

it("shows Begin button when no transaction and calls onBeginTransaction", async () => {
  const user = userEvent.setup()
  const onBegin = vi.fn()
  render(<SqlEditor {...baseProps} onBeginTransaction={onBegin} />)
  await user.click(screen.getByTitle("Begin"))
  expect(onBegin).toHaveBeenCalledTimes(1)
})

it("shows Commit/Rollback buttons when transaction is active", async () => {
  const user = userEvent.setup()
  const onCommit = vi.fn()
  const onRollback = vi.fn()
  render(<SqlEditor {...baseProps} txActive={true} onCommitTransaction={onCommit} onRollbackTransaction={onRollback} />)
  expect(screen.queryByTitle("Begin")).not.toBeInTheDocument()
  await user.click(screen.getByTitle("Commit"))
  await user.click(screen.getByTitle("Rollback"))
  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onRollback).toHaveBeenCalledTimes(1)
})

it("shows favorites section and toggles pin", async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  render(<SqlEditor {...baseProps} favorites={["SELECT * FROM t"]} onToggleFavorite={onToggle} />)
  await user.click(screen.getByTitle("Query History"))
  expect(screen.getByText("Favorites")).toBeInTheDocument()
  expect(screen.getByText("Recent")).toBeInTheDocument()
  expect(screen.getByText("SELECT * FROM t")).toBeInTheDocument()
  await user.click(screen.getByTitle("Remove from favorites"))
  expect(onToggle).toHaveBeenCalledWith("SELECT * FROM t")
})

it("pins a recent query", async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  render(<SqlEditor {...baseProps} history={["SELECT 1"]} onToggleFavorite={onToggle} />)
  await user.click(screen.getByTitle("Query History"))
  const pinBtn = screen.getByTitle("Pin to favorites")
  await user.click(pinBtn)
  expect(onToggle).toHaveBeenCalledWith("SELECT 1")
})

it("renders database selector and switches database on selection", async () => {
  const user = userEvent.setup()
  const onChangeDatabase = vi.fn()
  render(
    <SqlEditor
      {...baseProps}
      connectionId="c1"
      currentDatabase="test"
      databases={[{ name: "test" }, { name: "prod" }]}
      onChangeDatabase={onChangeDatabase}
    />
  )
  expect(screen.getByTitle("Select database")).toBeInTheDocument()
  await user.click(screen.getByTitle("Select database"))
  const prodOption = await screen.findByText("prod")
  await user.click(prodOption)
  expect(onChangeDatabase).toHaveBeenCalledWith("prod")
})

it("does not render database selector when no connection or no databases", () => {
  render(<SqlEditor {...baseProps} connectionId={null} databases={[]} />)
  expect(screen.queryByTitle("Select database")).not.toBeInTheDocument()
})
