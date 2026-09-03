import { render, screen, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { ErDiagram } from "../ErDiagram"
import type { SchemaCache } from "@/lib/db"

const mockSchema: SchemaCache = {
  tables: [
    {
      table: "users",
      columns: [
        { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" },
        { name: "email", data_type: "VARCHAR(255)", nullable: true, key: "", default_value: null, extra: "" },
      ],
      primary_keys: ["id"],
      foreign_keys: [],
      indexes: [],
      views: [],
      routines: [],
      triggers: [],
    },
    {
      table: "orders",
      columns: [
        { name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" },
        { name: "user_id", data_type: "INT", nullable: true, key: "", default_value: null, extra: "" },
        { name: "total", data_type: "DECIMAL", nullable: true, key: "", default_value: null, extra: "" },
      ],
      primary_keys: ["id"],
      foreign_keys: [
        { column_name: "user_id", ref_table: "users", ref_column: "id" },
      ],
      indexes: [],
      views: [],
      routines: [],
      triggers: [],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

it("shows loading state initially", () => {
  vi.mocked(invoke).mockImplementation(() => new Promise(() => {}))
  render(<ErDiagram connectionId="c1" database="mydb" />)
  expect(screen.getByText("Loading ER diagram...")).toBeInTheDocument()
})

it("shows error state when invoke fails", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("connection lost"))
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(screen.getByText("Error: connection lost")).toBeInTheDocument()
  })
})

it("shows no tables state when schema has no tables", async () => {
  vi.mocked(invoke).mockResolvedValue({ tables: [] })
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(screen.getByText("No tables found")).toBeInTheDocument()
  })
})

it("renders table names from schema", async () => {
  vi.mocked(invoke).mockResolvedValue(mockSchema)
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument()
  })
  expect(screen.getByText("orders")).toBeInTheDocument()
})

it("renders column names and types", async () => {
  vi.mocked(invoke).mockResolvedValue(mockSchema)
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(screen.getByText("email : VARCHAR(255)")).toBeInTheDocument()
  })
  expect(screen.getByText("user_id : INT")).toBeInTheDocument()
})

it("renders SVG element", async () => {
  vi.mocked(invoke).mockResolvedValue(mockSchema)
  const { container } = render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(container.querySelector("svg")).toBeInTheDocument()
  })
})

it("calls invoke with correct parameters", async () => {
  vi.mocked(invoke).mockResolvedValue(mockSchema)
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_schema_cache", { id: "c1", database: "mydb" })
  })
})

it("renders foreign key paths", async () => {
  vi.mocked(invoke).mockResolvedValue(mockSchema)
  const { container } = render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(container.querySelector("path")).toBeInTheDocument()
  })
})

/** Build a schema with `total` tables where only the first one has a FK to the second. */
function buildLargeSchema(total: number): SchemaCache {
  const tables = Array.from({ length: total }, (_, i) => ({
    table: `tbl_${i}`,
    columns: [{ name: "id", data_type: "INT", nullable: false, key: "PRI", default_value: null, extra: "" }],
    primary_keys: ["id"],
    foreign_keys: [] as { column_name: string; ref_table: string; ref_column: string }[],
    indexes: [],
    views: [],
    routines: [],
    triggers: [],
  }))
  tables[0].foreign_keys = [{ column_name: "id", ref_table: "tbl_1", ref_column: "id" }]
  return { tables }
}

it("renders only related tables when count exceeds limit", async () => {
  vi.mocked(invoke).mockResolvedValue(buildLargeSchema(200))
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(screen.getByText("tbl_0")).toBeInTheDocument()
  })
  expect(screen.getByText("tbl_1")).toBeInTheDocument()
  expect(screen.queryByText("tbl_99")).not.toBeInTheDocument()
  expect(screen.getByText(/200 tables/)).toBeInTheDocument()
  expect(screen.getByText("Show all")).toBeInTheDocument()
})

it("shows all tables after toggling show all", async () => {
  vi.mocked(invoke).mockResolvedValue(buildLargeSchema(200))
  render(<ErDiagram connectionId="c1" database="mydb" />)
  await waitFor(() => {
    expect(screen.getByText("Show all")).toBeInTheDocument()
  })
  await screen.getByText("Show all").click()
  expect(screen.getByText("tbl_150")).toBeInTheDocument()
  expect(screen.getByText("Related only")).toBeInTheDocument()
})
