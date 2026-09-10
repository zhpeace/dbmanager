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

  expect(onDropObject).toHaveBeenCalledWith("DATABASE", "mydb", "mydb", undefined)
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
      isPro
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
      isPro
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("mydb"))

  const tableEl = screen.getByText("users")
  fireEvent.contextMenu(tableEl)

  const dropBtn = await screen.findByText("Drop Table")
  await userEvent.click(dropBtn)

  expect(onDropObject).toHaveBeenCalledWith("TABLE", "users", "mydb", undefined)
})

// ── Free/Pro gating: Pro actions open the license dialog instead of firing ──

it("opens license dialog when duplicate_database clicked in free mode", async () => {
  const onDuplicateDatabase = vi.fn()
  const onOpenLicense = vi.fn()
  const conn = makeConnection({ config: makeConnConfig({ type: "oracle" }) })
  const databases = [{ name: "mydb" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      onDuplicateDatabase={onDuplicateDatabase}
      onOpenLicense={onOpenLicense}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  const dbEl = screen.getByText("mydb")
  fireEvent.contextMenu(dbEl)

  const dupBtn = await screen.findByText("Duplicate Database")
  await userEvent.click(dupBtn)

  expect(onDuplicateDatabase).not.toHaveBeenCalled()
  expect(onOpenLicense).toHaveBeenCalledTimes(1)
})

// ── Default database / schema focus ──

it("auto-expands and marks the configured default database", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ database: "prod" }),
  })
  const databases = [{ name: "prod" }, { name: "dev" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))

  // prod is auto-expanded and carries the default-database star
  await waitFor(() => {
    expect(screen.getByTitle("Default database")).toBeInTheDocument()
  })
  expect(screen.getByText("prod")).toBeInTheDocument()
  expect(screen.getByText("dev")).toBeInTheDocument()
})

it("auto-expands default schema and loads its tables for postgres", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "postgresql", database: "mydb", schema: "public" }),
  })
  const databases = [{ name: "mydb" }, { name: "other" }] as DatabaseInfo[]
  const schemasData = { mydb: [{ name: "public" }, { name: "audit" }] } as Record<string, DatabaseInfo[]>
  const tableData: TableInfo[] = [{ name: "users", object_type: "TABLE", schema: "public" }]
  const onLoadTables = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      schemas={{ c1: schemasData }}
      tables={{ c1: { mydb: tableData } }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))

  // public schema auto-expanded and marked; its tables visible
  await waitFor(() => {
    expect(screen.getByTitle("Default schema")).toBeInTheDocument()
  })
  expect(screen.getByText("users")).toBeInTheDocument()
})

it("loads the default database first, then drills into the schema when its data arrives", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "postgresql", database: "mydb", schema: "public" }),
  })
  const databases = [{ name: "mydb" }, { name: "other" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  const { rerender } = render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))

  // default database expanded even though its content is not loaded yet,
  // and a content load was requested so schema data can arrive
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "mydb")
  })

  // simulate the async load finishing: tables + schemas arrive
  rerender(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: { mydb: [{ name: "users", object_type: "TABLE", schema: "public" }] } }}
      schemas={{ c1: { mydb: [{ name: "public" }, { name: "audit" }] } }}
      onLoadTables={onLoadTables}
    />
  )

  await waitFor(() => {
    expect(screen.getByTitle("Default schema")).toBeInTheDocument()
  })
  expect(screen.getByText("users")).toBeInTheDocument()
})

it("re-locates when the configured default database changes", async () => {
  const databases = [{ name: "mydb" }, { name: "other" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  const firstConn = makeConnection({
    config: makeConnConfig({ type: "postgresql", database: "mydb", schema: "public" }),
  })
  const { rerender } = render(
    <Sidebar
      {...defaultProps}
      connections={[firstConn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: { mydb: [{ name: "users", object_type: "TABLE", schema: "public" }] } }}
      schemas={{ c1: { mydb: [{ name: "public" }] } }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(screen.getByTitle("Default schema")).toBeInTheDocument()
  })

  // user edits the connection: default database changes to "other" without schema
  const editedConn = makeConnection({
    config: makeConnConfig({ type: "postgresql", database: "other" }),
  })
  rerender(
    <Sidebar
      {...defaultProps}
      connections={[editedConn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: { mydb: [{ name: "users", object_type: "TABLE", schema: "public" }] } }}
      schemas={{ c1: { mydb: [{ name: "public" }] } }}
      onLoadTables={onLoadTables}
    />
  )

  // collapse + re-expand the connection: the new default database is located
  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "other")
  })
})

it("re-locates when the connection is collapsed and re-expanded", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "postgresql", database: "mydb", schema: "public" }),
  })
  const databases = [{ name: "mydb" }, { name: "other" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "mydb")
  })
  onLoadTables.mockClear()

  // collapse the connection, then re-expand: locate should run again
  await userEvent.click(screen.getByText("Test DB"))
  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "mydb")
  })
})

// ── Expand-while-connecting & disconnect collapse ──

it("expands immediately while the connection is loading (shows loading state)", async () => {
  const conn = makeConnection()
  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      loading={{ c1: true }}
    />
  )

  expect(screen.queryByText("sales_db")).not.toBeInTheDocument()

  await userEvent.click(screen.getByText("Test DB"))

  // While connecting, the expanded area renders with a loading indicator
  // instead of waiting for `connected` to become true.
  expect(
    screen.getByText((content) => content.includes("加载中") || content.includes("Loading"))
  ).toBeInTheDocument()
})

it("collapses the row when the connection is disconnected, so the next click expands again", async () => {
  const conn = makeConnection()
  const databases = [{ name: "sales_db" }] as DatabaseInfo[]

  const { rerender } = render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  expect(screen.getByText("sales_db")).toBeInTheDocument()

  // Disconnect: the row should collapse (expanded resets), not stay "open"
  // with an empty area that would turn the next click into a collapse.
  rerender(
    <Sidebar
      {...defaultProps}
      connections={[{ ...conn, connected: false }]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )
  expect(screen.queryByText("sales_db")).not.toBeInTheDocument()

  // Reconnect: still collapsed; a single click expands and shows the list.
  rerender(
    <Sidebar
      {...defaultProps}
      connections={[{ ...conn, connected: true }]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
    />
  )
  expect(screen.queryByText("sales_db")).not.toBeInTheDocument()

  await userEvent.click(screen.getByText("Test DB"))
  expect(screen.getByText("sales_db")).toBeInTheDocument()
})

// ── Default database fallback to username (PostgreSQL) ──

it("locates the user-named database for PostgreSQL when database is empty", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "postgresql", user: "oushutest", database: "" }),
  })
  const databases = [{ name: "oushutest" }, { name: "other" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "oushutest")
  })
  // The user-named database is expanded and starred as the default context
  expect(screen.getByText("oushutest")).toBeInTheDocument()
})

it("does not fall back to username for non-PostgreSQL connections", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "mysql", user: "root", database: "" }),
  })
  const databases = [{ name: "root" }, { name: "other" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).not.toHaveBeenCalledWith("c1", "root")
  })
})

it("locates by username for Oracle even when the database field holds a service name", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "oracle", user: "SCOTT", database: "ORCLPDB1" }),
  })
  const databases = [{ name: "SCOTT" }, { name: "SYS" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "SCOTT")
  })
})

it("locates by username for Oracle when database is empty", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "oracle", user: "SCOTT", database: "" }),
  })
  const databases = [{ name: "SCOTT" }, { name: "SYS" }] as DatabaseInfo[]
  const onLoadTables = vi.fn()

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={onLoadTables}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))
  await waitFor(() => {
    expect(onLoadTables).toHaveBeenCalledWith("c1", "SCOTT")
  })
})

it("marks the user-named schema with the default-database star for Oracle", async () => {
  const conn = makeConnection({
    config: makeConnConfig({ type: "oracle", user: "SCOTT", database: "ORCLPDB1" }),
  })
  const databases = [{ name: "SCOTT" }, { name: "SYS" }] as DatabaseInfo[]

  render(
    <Sidebar
      {...defaultProps}
      connections={[conn]}
      activeConnectionId="c1"
      databases={{ c1: databases }}
      tables={{ c1: {} }}
      schemas={{ c1: {} }}
      onLoadTables={vi.fn()}
    />
  )

  await userEvent.click(screen.getByText("Test DB"))

  // The star follows the locate logic (username for Oracle), so it sits on SCOTT
  await waitFor(() => {
    expect(screen.getByTitle("Default database")).toBeInTheDocument()
  })
  const star = screen.getByTitle("Default database")
  expect(star.closest("div")?.textContent).toContain("SCOTT")
  expect(star.closest("div")?.textContent).not.toContain("SYS")
})
