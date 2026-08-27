import { useMemo } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { xml } from "@codemirror/lang-xml"
import { json } from "@codemirror/lang-json"
import { oneDark } from "@codemirror/theme-one-dark"
import { EditorView } from "@codemirror/view"
import { useTheme } from "@/lib/theme"

interface CodeEditorProps {
  value: string
  language: "xml" | "json"
  onChange: (value: string) => void
  readOnly?: boolean
  className?: string
}

export function CodeEditor({ value, language, onChange, readOnly = false, className }: CodeEditorProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const extensions = useMemo(
    () => [language === "xml" ? xml() : json(), EditorView.lineWrapping],
    [language],
  )

  return (
    <div
      className={`flex-1 min-h-0 min-w-0 overflow-hidden rounded-md border bg-background ${className ?? ""}`}
    >
      <CodeMirror
        value={value}
        height="100%"
        theme={isDark ? oneDark : "light"}
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          autocompletion: false,
        }}
        style={{ height: "100%", fontSize: "12px" }}
      />
    </div>
  )
}
