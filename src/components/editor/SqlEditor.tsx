import { useCallback, useRef, useEffect } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import { Play, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import type { QueryResult, SchemaCache } from "@/lib/db"

function formatSql(sql: string): string {
  const clauseBreaks = [
    "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
    "UNION ALL", "UNION", "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
    "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "JOIN", "CROSS JOIN", "ON", "AND", "OR",
    "CREATE TABLE", "CREATE VIEW", "CREATE PROCEDURE", "CREATE FUNCTION", "CREATE TRIGGER",
    "ALTER TABLE", "DROP TABLE", "BEGIN", "END",
  ]
  let out = sql.replace(/\s+/g, " ").trim()
  for (const kw of clauseBreaks) {
    const re = new RegExp("\\s+" + kw.replace(/ /g, "\\s+") + "\\b", "gi")
    out = out.replace(re, (m) => "\n" + m.trim().toUpperCase())
  }
  const lines = out.split("\n").map((l, i) => (i === 0 ? l.trim() : "  " + l.trim()))
  let result = lines.join("\n").replace(/\n{2,}/g, "\n").trim()
  if (sql.trim().endsWith(";") && !result.endsWith(";")) result += ";"
  return result
}

interface SqlEditorProps {
  onExecute: (sql: string) => void
  result: QueryResult | null
  executing: boolean
  value: string
  onChange: (sql: string) => void
  onNewTab: () => void
  connectionId?: string | null
  currentDatabase?: string | null
}

export function SqlEditor({ onExecute, result, executing, value, onChange, onNewTab, connectionId, currentDatabase }: SqlEditorProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<any>(null)
  const disposerRef = useRef<(() => void) | null>(null)
  const suppressRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.onDidChangeModelContent(() => {
      if (suppressRef.current) return
      onChangeRef.current(editor.getValue())
    })
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (editor && editor.getValue() !== value) {
      suppressRef.current = true
      editor.setValue(value)
      suppressRef.current = false
    }
  }, [value])

  useEffect(() => {
    if (!connectionId || !currentDatabase) return

    const TABLE_CTX_KEYWORDS = ["FROM", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN",
      "CROSS JOIN", "FULL JOIN", "STRAIGHT_JOIN", "UPDATE", "INTO", "TABLE", "VIEW"]

    const SQL_KEYWORDS = new Set([
      "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "BETWEEN", "LIKE",
      "ORDER", "GROUP", "BY", "HAVING", "LIMIT", "OFFSET", "AS", "ON",
      "JOIN", "INNER", "LEFT", "RIGHT", "CROSS", "FULL", "OUTER", "STRAIGHT_JOIN",
      "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
      "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX", "TRIGGER",
      "UNION", "ALL", "DISTINCT", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END",
      "NULL", "IS", "TRUE", "FALSE", "ASC", "DESC",
    ])

    function buildAliasMap(fullText: string): Map<string, string> {
      const m = new Map<string, string>()
      // Pattern: FROM|JOIN|INTO|UPDATE|TABLE  table  [AS]  alias
      const re = /(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(\w+)\s+(?:AS\s+)?(\w+)/gi
      let match
      while ((match = re.exec(fullText)) !== null) {
        const table = match[1]
        const alias = match[2].toUpperCase()
        if (!SQL_KEYWORDS.has(alias)) {
          m.set(alias.toLowerCase(), table)
        }
      }
      return m
    }

    function resolveTable(candidate: string, model: any, cache: SchemaCache) {
      const low = candidate.toLowerCase()
      // direct table name match
      const direct = cache.tables.find(t => t.table.toLowerCase() === low)
      if (direct) return direct
      // alias lookup
      const fullText = model.getValue()
      const aliases = buildAliasMap(fullText)
      const tableName = aliases.get(low)
      if (tableName) return cache.tables.find(t => t.table.toLowerCase() === tableName.toLowerCase())
      return undefined
    }

    function getContext(model: any, position: any): { type: string; tableFilter?: string } {
      const text = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      // check dot-qualifier: "table_alias._"
      const wordUntil = model.getWordUntilPosition(position)
      const beforeWord = text.slice(0, text.length - (wordUntil.word.length || 0)).trimEnd()
      const dotMatch = beforeWord.match(/(\w+)\.$/)
      if (dotMatch) {
        return { type: "column", tableFilter: dotMatch[1] }
      }

      // Find the LAST word that is a table-context keyword.
      const words = text.toUpperCase().split(/[^A-Z_]+/).filter(Boolean)
      for (let i = words.length - 1; i >= 0; i--) {
        if (TABLE_CTX_KEYWORDS.includes(words[i])) {
          return { type: "table" }
        }
      }

      return { type: "column" }
    }

    invoke<SchemaCache>("get_schema_cache", { id: connectionId, database: currentDatabase })
      .then(cache => {
        const editor = editorRef.current
        const monaco = monacoRef.current
        if (!editor || !monaco) return

        // dispose previous provider before registering new one
        disposerRef.current?.()

        const dispose = monaco.languages.registerCompletionItemProvider("sql", {
          triggerCharacters: [".", " "],
          provideCompletionItems: (model: any, position: any) => {
            const ctx = getContext(model, position)
            const word = model.getWordUntilPosition(position)
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            }
            const suggestions: any[] = []

            if (ctx.type === "table") {
              for (const t of cache.tables) {
                suggestions.push({
                  label: t.table,
                  kind: monaco.languages.CompletionItemKind.Class,
                  insertText: t.table,
                  range,
                })
              }
            } else if (ctx.type === "column" && ctx.tableFilter) {
              const table = resolveTable(ctx.tableFilter, model, cache)
              if (table) {
                for (const c of table.columns) {
                  suggestions.push({
                    label: c.name,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: c.name,
                    range,
                    detail: `${table.table}.${c.data_type}`,
                  })
                }
              }
            } else {
              // Column context: label is the column name (Monaco prefix-matches against this),
              // detail shows which table it belongs to for disambiguation.
              const seen = new Set<string>()
              for (const t of cache.tables) {
                for (const c of t.columns) {
                  const key = `${t.table}.${c.name}`
                  if (seen.has(key)) continue
                  seen.add(key)
                  suggestions.push({
                    label: c.name,
                    filterText: c.name,
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: c.name,
                    range,
                    detail: t.table,
                  })
                }
              }
            }

            return { suggestions }
          },
        })
        disposerRef.current = () => dispose.dispose()
      })
      .catch(() => {})
  }, [connectionId, currentDatabase])

  const handleExecute = () => {
    const sql = editorRef.current?.getValue() || ""
    if (sql.trim()) {
      onExecute(sql)
    }
  }

  const handleFormat = () => {
    const sql = editorRef.current?.getValue() || ""
    if (!sql.trim()) return
    const formatted = formatSql(sql)
    suppressRef.current = true
    editorRef.current?.setValue(formatted)
    suppressRef.current = false
    onChange(formatted)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleExecute()
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      onNewTab()
    }
  }

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t('editor.title')}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {result && t('editor.last_exec', { duration: result.duration, count: result.rowCount })}
          </span>
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={onNewTab} title={t('editor.new_tab')}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={handleFormat} title={t('editor.format')}>
            {t('editor.format')}
          </Button>
          <Button size="sm" variant="default" className="h-7 gap-1" onClick={handleExecute} disabled={executing}>
            {executing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            {t('editor.run')}
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="sql"
          theme={theme === "dark" ? "vs-dark" : "light"}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 8 },
            suggestOnTriggerCharacters: true,
          }}
          defaultLanguage="sql"
        />
      </div>
    </div>
  )
}
