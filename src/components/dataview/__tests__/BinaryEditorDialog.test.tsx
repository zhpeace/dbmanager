import { render, screen, fireEvent } from "@testing-library/react"
import { BinaryEditorDialog } from "../BinaryEditorDialog"

describe("BinaryEditorDialog", () => {
  const baseProps = {
    tableName: "t",
    column: "c",
    rowIndex: 0,
    onSave: vi.fn(),
    onClose: vi.fn(),
  }

  it("renders an editable CodeMirror editor when the XML view is toggled", () => {
    render(<BinaryEditorDialog {...baseProps} open value="<a>hello</a>" />)
    fireEvent.click(screen.getByText("XML"))
    expect(document.querySelector(".cm-editor")).toBeTruthy()
  })

  it("renders an editable CodeMirror editor for JSON binary content", () => {
    render(<BinaryEditorDialog {...baseProps} open value='{"k":1}' />)
    fireEvent.click(screen.getByText("JSON"))
    expect(document.querySelector(".cm-editor")).toBeTruthy()
  })

  it("keeps Hex/Text toggles visible alongside the XML toggle", () => {
    render(<BinaryEditorDialog {...baseProps} open value="<a>hello</a>" />)
    expect(screen.getByText("Hex")).toBeInTheDocument()
    expect(screen.getByText("Text")).toBeInTheDocument()
    expect(screen.getByText("XML")).toBeInTheDocument()
  })
})