import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { RedisValuePanel } from "../RedisValuePanel"
import { invoke } from "@tauri-apps/api/core"
import type { TableData } from "@/lib/db"

// base64("A\x00\xffC") = "QQD/Qw=="
const BIN_B64 = "QQD/Qw=="
const BIN_BYTES_LEN = 4

function mockCommands() {
  const getTableData = vi.fn(async () => {
    const td: TableData = {
      columns: [{ name: "value", data_type: "string", nullable: true, key: "", default_value: null, extra: "" }],
      rows: [{ value: { __datanex_binary__: true, b64: BIN_B64, len: BIN_BYTES_LEN } }],
      total: 1,
      duration: "1.00ms",
      primary_keys: [],
      row_handles: [],
    }
    return td
  })
  const keyInfo = vi.fn(async () => ({
    key: "k",
    key_type: "string",
    ttl: -1,
    value: null,
    size: 4,
    encoding: "raw",
    refcount: 1,
    idletime: 0,
    memory_usage: 4,
    n_elements: 1,
  }))
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_table_data") return getTableData()
    if (cmd === "redis_key_info") return keyInfo()
    throw new Error(`unexpected command ${cmd}`)
  })
  return { getTableData, keyInfo }
}

describe("RedisValuePanel binary value handling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommands()
  })

  it("renders a binary string value without error and shows lossy text in the editor", async () => {
    render(<RedisValuePanel connectionId="r1" database="db0" table="bin:key" />)
    await waitFor(() => {
      expect(screen.queryByText(/Cannot convert from UTF-8/i)).toBeNull()
    })
    // The editor shows the lossy-decoded text (A, U+FFFD replacement, C).
    const textarea = await screen.findByRole("textbox")
    expect(textarea).toBeTruthy()
    // No error banner rendered.
    await waitFor(() => {
      expect(screen.queryByText(/datanex_binary/i)).toBeNull()
    })
  })

  it("shows faithful HEX preview for a binary value", async () => {
    render(<RedisValuePanel connectionId="r1" database="db0" table="bin:key" />)
    const hexTab = await screen.findByRole("button", { name: "hex" })
    fireEvent.click(hexTab)
    await waitFor(() => {
      // A=0x41, \x00=0x00, \xff=0xff, C=0x43
      expect(screen.getByText(/41\s*00\s*ff\s*43/)).toBeTruthy()
    })
  })

  it("shows base64 preview identical to the original payload", async () => {
    render(<RedisValuePanel connectionId="r1" database="db0" table="bin:key" />)
    const b64Tab = await screen.findByRole("button", { name: "base64" })
    fireEvent.click(b64Tab)
    await waitFor(() => {
      expect(screen.getByText(BIN_B64)).toBeTruthy()
    })
  })
})
