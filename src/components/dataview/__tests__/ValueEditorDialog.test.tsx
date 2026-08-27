import { render, screen, fireEvent } from "@testing-library/react"
import { ValueEditorDialog } from "../ValueEditorDialog"

describe("ValueEditorDialog", () => {
  const baseProps = {
    tableName: "users",
    column: "ts",
    rowIndex: 0,
    onSave: vi.fn(),
    onClose: vi.fn(),
  }

  it("shows a calendar + time picker for a datetime (timestamp) column", () => {
    render(
      <ValueEditorDialog
        {...baseProps}
        open
        columnType="timestamp"
        value="2023-01-02 03:04:05"
      />,
    )
    expect(screen.getByRole("grid")).toBeInTheDocument() // calendar
    expect(screen.getByText("时间")).toBeInTheDocument() // time selectors
  })

  it("shows only a calendar for a date column (no time selectors)", () => {
    render(
      <ValueEditorDialog {...baseProps} open columnType="date" value="2023-01-02" />,
    )
    expect(screen.getByRole("grid")).toBeInTheDocument()
    expect(screen.queryByText("时间")).not.toBeInTheDocument()
  })

  it("renders an editable CodeMirror editor when the XML view is toggled", () => {
    render(
      <ValueEditorDialog {...baseProps} open columnType="text" value="<a>hi</a>" />,
    )
    fireEvent.click(screen.getByText("XML"))
    expect(document.querySelector(".cm-editor")).toBeTruthy()
  })

  it("renders an editable CodeMirror editor for JSON content", () => {
    render(
      <ValueEditorDialog {...baseProps} open columnType="text" value='{"k":1}' />,
    )
    fireEvent.click(screen.getByText("JSON"))
    expect(document.querySelector(".cm-editor")).toBeTruthy()
  })
})