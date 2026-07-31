import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TransferDialog } from "../TransferDialog"
import { invoke } from "@tauri-apps/api/core"

const conn1 = { id: "c1", connected: true, config: { id: "c1", name: "MySQL DB", type: "mysql", host: "localhost", port: 3306, user: "root" } }
const conn2 = { id: "c2", connected: true, config: { id: "c2", name: "PG DB", type: "postgresql", host: "localhost", port: 5432, user: "postgres" } }

function getCombobox(text: string): HTMLElement {
  return screen.getByText(text).closest('[role="combobox"]')!
}

// Global error handler to catch React errors
let caughtError: any = null
window.addEventListener('error', (e) => { caughtError = e.error || e.message })

it("debug invoke calls", async () => {
  const user = userEvent.setup()
  const calls: string[] = []
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    calls.push(cmd)
    const mocks: Record<string, any> = {
      get_databases: [{ name: "mydb" }],
      get_tables: [{ name: "users", object_type: "TABLE" }],
    }
    const result = mocks[cmd]
    if (result === undefined) {
      console.log(`UNMOCKED invoke called: ${cmd}`)
      return Promise.resolve(null)
    }
    return Promise.resolve(result)
  })

  render(<TransferDialog open={true} onOpenChange={() => {}} connections={[conn1, conn2]} />)

  await user.click(getCombobox("Select source"))
  await user.click(screen.getByText("MySQL DB (mysql)"))
  await waitFor(() => expect(screen.getByText("Select source database")).toBeInTheDocument())
  
  await user.click(getCombobox("Select source database"))
  await user.click(screen.getByText("mydb"))

  await user.click(getCombobox("Select target"))
  await user.click(screen.getByText("PG DB (postgresql)"))
  await waitFor(() => expect(screen.getByText("Select target db")).toBeInTheDocument())
  
  await user.click(getCombobox("Select target db"))
  
  console.log("target_db exists:", !!screen.queryByText("target_db"))
  console.log("calls so far:", calls)
  
  // Log what's in the body
  console.log("Body HTML:", document.body.innerHTML.substring(0, 500))
  
  // Try to wait for target_db
  try {
    await user.click(screen.getByText("target_db"))
    console.log("Clicked target_db successfully")
  } catch (e: any) {
    console.log("Failed to click target_db:", e.message)
  }
  
  console.log("calls:", calls)
  console.log("caughtError:", caughtError)
  
  // Check if users appears
  await waitFor(() => {
    try {
      expect(screen.getByText("users")).toBeInTheDocument()
    } catch {
      console.log("Body HTML at failure:", document.body.innerHTML.substring(0, 2000))
      throw new Error("Cannot find users")
    }
  })
})
