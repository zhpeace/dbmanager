import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Sidebar } from "../Sidebar"
import type { Connection, ConnectionConfig, DatabaseInfo, TableInfo } from "@/lib/db"

function makeConnConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "c1",
    name: "Test DB",
    type: "mysql",
    host: "localhost",
    port: 3306,
    user: "root",
    ...overrides,
  }
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    config: makeConnConfig(overrides.config),
    connected: overrides.connected ?? true,
    ...overrides,
  }
}

const noop = () => {}

const defaultProps = {
  connections: [] as Connection[],
  activeConnectionId: null as string | null,
  onSelectConnection: noop,
  onDisconnect: noop,
  onRefresh: noop,
  onEditConnection: noop,
  onDuplicateConnection: noop,
  onDeleteConnection: noop,
  onLoadTables: noop,
  onTableClick: noop,
  onDatabaseClick: noop,
  onInsertSql: noop,
  databases: {} as Record<string, DatabaseInfo[]>,
  tables: {} as Record<string, Record<string, TableInfo[]>>,
  loading: {} as Record<string, boolean>,
  onNewTable: noop,
  onNewDatabase: noop,
  onDuplicateDatabase: noop,
  onDesignTable: noop,
  onExportTable: noop,
  onDropObject: noop,
  onTruncateTable: noop,
  onRenameTable: noop,
  onNewObject: noop,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Empty state ──

it("renders empty state when no connections", () => {
  render(<Sidebar {...defaultProps} />)
  expect(screen.getByText("No connections yet")).toBeInTheDocument()
})

// ── Connection rendering ──

it("renders connection name and type badge", () => {
  const conn = makeConnection({ config: makeConnConfig({ name: "My MySQL", type: "mysql" }) })
  render(<Sidebar {...defaultProps} connections={[conn]} activeConnectionId="c1" />)
  expect(screen.getByText("My MySQL")).toBeInTheDocument()
  expect(screen.getByText("MySQL")).toBeInTheDocument()
})

it("shows green dot for connected and gray for disconnected", () => {
  const connected = makeConnection({ config: makeConnConfig({ name: "Online" }), connected: true })
  const disconnected = makeConnection({ id: "c2", config: makeConnConfig({ id: "c2", name: "Offline" }), connected: false })

  render(
    <Sidebar
      {...defaultProps}
      connections={[connected, disconnected]}
    />
  )

  expect(screen.getByText("Online")).toBeInTheDocument()
  expect(screen.getByText("Offline")).toBeInTheDocument()
})

// ── Interaction: expand connection ──

it("calls onSelectConnection when connection name is clicked", async () => {
  const onSelectConnection = vi.fn()
  const conn = makeConnection()
  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      onSelectConnection={onSelectConnection}
    />
  )
  await userEvent.click(screen.getByText("Test DB"))
  expect(onSelectConnection).toHaveBeenCalledWith("c1")
})

// ── Database rendering ──

it("shows databases when connection is expanded", async () => {
  const conn = makeConnection()
  const databases = [{ name: "sales_db" }, { name: "analytics_db" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )

  expect(screen.queryByText("sales_db")).not.toBeInTheDocument()

  await userEvent.click(screen.getByText("Test DB"))

  expect(screen.getByText("sales_db")).toBeInTheDocument()
  expect(screen.getByText("analytics_db")).toBeInTheDocument()
})

it("calls onDatabaseClick when database is clicked", async () => {
  const onDatabaseClick = vi.fn()
  const conn = makeConnection()
  const databases = [{ name: "mydb" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      onDatabaseClick={onDatabaseClick}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("mydb"))

  expect(onDatabaseClick).toHaveBeenCalledWith("mydb", "c1")
})

// ── Table rendering with grouping ──

it("renders tables grouped by type after expanding database", async () => {
  const conn = makeConnection()
  const databases = [{ name: "mydb" }] as DatabaseInfo[]
  const tableData: TableInfo[] = [
    { name: "users", object_type: "TABLE" },
    { name: "orders", object_type: "TABLE" },
    { name: "user_view", object_type: "VIEW" },
  ]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: { mydb: tableData } }}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("mydb"))

  expect(screen.getByText("users")).toBeInTheDocument()
  expect(screen.getByText("orders")).toBeInTheDocument()
  expect(screen.getByText("user_view")).toBeInTheDocument()
  expect(screen.getByText("Tables")).toBeInTheDocument()
  expect(screen.getByText("Views")).toBeInTheDocument()
  expect(screen.getByText(/\(2\)/)).toBeInTheDocument()
  expect(screen.getByText(/\(1\)/)).toBeInTheDocument()
})

it("single click selects a table, double click opens it (DBeaver-style)", async () => {
  const conn = makeConnection()
  const databases = [{ name: "mydb" }] as DatabaseInfo[]
  const tableData: TableInfo[] = [
    { name: "users", object_type: "TABLE" },
  ]
  const onTableClick = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: { mydb: tableData } }}
      onTableClick={onTableClick}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("mydb"))
  const tableEl = screen.getByText("users")

  await userEvent.click(tableEl)
  expect(onTableClick).not.toHaveBeenCalled()

  await userEvent.dblClick(tableEl)
  expect(onTableClick).toHaveBeenCalledTimes(1)
  expect(onTableClick.mock.calls[0][0]).toContain("users")
})

// ── Database context menu: mysql gets drop/duplicate items ──

it("shows drop and duplicate in database context menu for mysql", async () => {
  const conn = makeConnection({ config: makeConnConfig({ type: "mysql" }) })
  const databases = [{ name: "mydb" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  const dbEl = screen.getByText("mydb")
  fireEvent.contextMenu(dbEl)

  await waitFor(() => {
    expect(screen.getByText("Drop Database")).toBeInTheDocument()
    expect(screen.getByText("Duplicate Database")).toBeInTheDocument()
  })
})

it("hides drop_database in database context menu for sqlite", async () => {
  const conn = makeConnection({ config: makeConnConfig({ type: "sqlite" }) })
  const databases = [{ name: "mydb" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  const dbEl = screen.getByText("mydb")
  fireEvent.contextMenu(dbEl)

  await waitFor(() => {
    expect(screen.queryByText("Drop Database")).not.toBeInTheDocument()
  })
})

it("calls onDropObject when drop_database menu item clicked", async () => {
  const onDropObject = vi.fn()
  const conn = makeConnection({ config: makeConnConfig({ type: "mysql" }) })
  const databases = [{ name: "mydb" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      onDropObject={onDropObject}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  const dbEl = screen.getByText("mydb")
  fireEvent.contextMenu(dbEl)

  const dropBtn = await screen.findByText("Drop Database")
  await userEvent.click(dropBtn)

  expect(onDropObject).toHaveBeenCalledWith("DATABASE", "mydb", "mydb")
})

it("calls onDuplicateDatabase when duplicate menu item clicked", async () => {
  const onDuplicateDatabase = vi.fn()
  const conn = makeConnection({ config: makeConnConfig({ type: "oracle" }) })
  const databases = [{ name: "mydb" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      onDuplicateDatabase={onDuplicateDatabase}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  const dbEl = screen.getByText("mydb")
  fireEvent.contextMenu(dbEl)

  const dupBtn = await screen.findByText("Duplicate Database")
  await userEvent.click(dupBtn)

  expect(onDuplicateDatabase).toHaveBeenCalledWith("c1", "mydb")
})

// ── Table context menu: drop_table ──

it("calls onDropObject when drop_table menu item clicked", async () => {
  const onDropObject = vi.fn()
  const conn = makeConnection({ config: makeConnConfig({ type: "mysql" }) })
  const databases = [{ name: "mydb" }] as DatabaseInfo[]
  const tableData: TableInfo[] = [
    { name: "users", object_type: "TABLE" },
  ]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: { mydb: tableData } }}
      onDropObject={onDropObject}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("mydb"))

  const tableEl = screen.getByText("users")
  fireEvent.contextMenu(tableEl)

  const dropBtn = await screen.findByText("Drop Table")
  await userEvent.click(dropBtn)

  expect(onDropObject).toHaveBeenCalledWith("TABLE", "users", "mydb")
})
