import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LicenseDialog, loadLicenseStatus } from "../LicenseDialog"
import { invoke } from "@tauri-apps/api/core"
import { getLicenseStatus } from "@/lib/db"

const mockOnActivated = vi.fn()

const defaultProps = {
  open: true,
  onActivated: mockOnActivated,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Rendering ──

it("renders with title", () => {
  render(<LicenseDialog {...defaultProps} />)
  expect(screen.getByText("Activate DBManager")).toBeInTheDocument()
})

it("shows activate button disabled when key is empty", () => {
  render(<LicenseDialog {...defaultProps} />)
  expect(screen.getByRole("button", { name: /activate/i })).toBeDisabled()
})

it("enables activate button when key is entered", async () => {
  const user = userEvent.setup()
  render(<LicenseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "XXXX-XXXX-XXXX")
  expect(screen.getByRole("button", { name: /activate/i })).toBeEnabled()
})

// ── Activation flow ──

it("calls activateLicense on submit", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue({ activated: true, key: "LIC-KEY" })

  render(<LicenseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "LIC-KEY")
  await user.click(screen.getByRole("button", { name: /activate/i }))

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("activate_license", {
      key: "LIC-KEY",
    })
  })
})

it("shows success message on activation", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue({ activated: true, key: "LIC-KEY" })

  render(<LicenseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "LIC-KEY")
  await user.click(screen.getByRole("button", { name: /activate/i }))

  await waitFor(() => {
    expect(screen.getByText(/activated/i)).toBeInTheDocument()
  })
})

it("calls onActivated after successful activation", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue({ activated: true, key: "LIC-KEY" })

  render(<LicenseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "LIC-KEY")
  await user.click(screen.getByRole("button", { name: /activate/i }))

  await waitFor(() => {
    expect(mockOnActivated).toHaveBeenCalledWith({ activated: true, key: "LIC-KEY" })
  })
})

it("shows error message on activation failure", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockRejectedValue(new Error("invalid key"))

  render(<LicenseDialog {...defaultProps} />)
  await user.type(screen.getByRole("textbox"), "BAD-KEY")
  await user.click(screen.getByRole("button", { name: /activate/i }))

  await waitFor(() => {
    expect(screen.getByText(/invalid key/)).toBeInTheDocument()
  })
})

it("supports Enter key to activate", async () => {
  const user = userEvent.setup()
  vi.mocked(invoke).mockResolvedValue({ activated: true, key: "K" })

  render(<LicenseDialog {...defaultProps} />)
  const input = screen.getByRole("textbox")
  await user.type(input, "K")
  // Press Enter on the input - the component has onKeyDown handler for Enter
  await user.keyboard("{Enter}")

  await waitFor(() => {
    expect(invoke).toHaveBeenCalled()
  })
})

// ── loadLicenseStatus ──

it("loadLicenseStatus returns activated false on error", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("no license"))
  const status = await loadLicenseStatus()
  expect(status).toEqual({ activated: false, key: null })
})

it("loadLicenseStatus returns the license status", async () => {
  vi.mocked(invoke).mockResolvedValue({ activated: true, key: "ACTIVE" })
  const status = await loadLicenseStatus()
  expect(status).toEqual({ activated: true, key: "ACTIVE" })
})
