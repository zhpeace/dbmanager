import { useCallback, useRef, useEffect, useState } from "react"
import Editor, { type OnMount } from "@monaco-editor/react"
import {
  Play,
  Plus,
  FolderOpen,
  Save,
  History,
  Wand2,
  FileSearch,
  ListTodo,
  Square,
  Braces,
  Database,
  Check,
  Undo2,
  Pin,
  PinOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import type { SchemaCache } from "@/lib/db"
import { formatSql, splitSqlStatements, statementAtOffset, type SqlStatement } from "@/lib/sql"
import { SQL_SNIPPETS } from "@/lib/snippets"

interface SqlEditorProps {
  value: string
  onChange: (sql: string) => void
  onExecute: (sql: string, startLine?: number) => void
  onRunAll: (sql: string) => void
  onExplain: (sql: string) => void
  onCancel: () => void
  onSave: () => void
  onOpen: () => void
  onHistoryRun: (sql: string) => void
  onToggleFavorite: (sql: string) => void
  favorites: string[]
  onNewTab: () => void
  onBeginTransaction: () => void
  onCommitTransaction: () => void
  onRollbackTransaction: () => void
  txActive: boolean
  executing: boolean
  lastExec: { duration: string; count: number } | null
  connectionId?: string | null
  currentDatabase?: string | null
  dbType: string
  history: string[]
  errorMarker: { line: number; message: string } | null
}

export function SqlEditor({
  value,
  onChange,
  onExecute,
  onRunAll,
  onExplain,
  onCancel,
  onSave,
  onOpen,
  onHistoryRun,
  onToggleFavorite,
  favorites,
  onNewTab,
  onBeginTransaction,
  onCommitTransaction,
  onRollbackTransaction,
  txActive,
  executing,
  lastExec,
  connectionId,
  currentDatabase,
  dbType,
  history,
  errorMarker,
}: SqlEditorProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<any>(null)
  const disposerRef = useRef<(() => void) | null>(null)
  const suppressRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [historyOpen, setHistoryOpen] = useState(false)
  const [snippetOpen, setSnippetOpen] = useState(false)

  const handlersRef = useRef({
    execute: () => {},
    runAll: () => {},
    nextStatement: () => {},
    save: () => {},
    open: () => {},
    toggleHistory: () => {},
  })

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.onDidChangeModelContent(() => {
      if (suppressRef.current) return
      onChangeRef.current(editor.getValue())
    })

    const KC = monaco.KeyMod
    const key = monaco.KeyCode
    editor.addCommand(KC.CtrlCmd | key.Enter, () => handlersRef.current.execute())
    editor.addCommand(KC.CtrlCmd | KC.Shift | key.Enter, () => handlersRef.current.runAll())
    editor.addCommand(key.F5, () => handlersRef.current.execute())
    editor.addCommand(KC.Shift | key.F5, () => handlersRef.current.runAll())
    editor.addCommand(KC.CtrlCmd | key.Semicolon, () => handlersRef.current.nextStatement())
    editor.addCommand(KC.CtrlCmd | key.KeyS, () => handlersRef.current.save())
    editor.addCommand(KC.CtrlCmd | key.KeyO, () => handlersRef.current.open())
    editor.addCommand(KC.CtrlCmd | key.UpArrow, () => handlersRef.current.toggleHistory())
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
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    if (errorMarker) {
      monaco.editor.setModelMarkers(editor.getModel(), "dbmanager", [
        {
          startLineNumber: errorMarker.line,
          startColumn: 1,
          endLineNumber: errorMarker.line,
          endColumn: 1,
          message: errorMarker.message,
          severity: monaco.MarkerSeverity.Error,
        },
      ])
      editor.revealLineInCenter(errorMarker.line)
      editor.setPosition({ lineNumber: errorMarker.line, column: 1 })
    } else {
      monaco.editor.setModelMarkers(editor.getModel(), "dbmanager", [])
    }
  }, [errorMarker])

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

  function getRunTarget(): { sql: string; startLine: number } {
    const editor = editorRef.current
    if (!editor) return { sql: value, startLine: 1 }
    const model = editor.getModel()!
    const sel = editor.getSelection()
    if (sel && (sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn)) {
      return { sql: model.getValueInRange(sel), startLine: sel.startLineNumber }
    }
    const pos = editor.getPosition()!
    const offset = model.getOffsetAt(pos)
    const full = model.getValue()
    const stmt = statementAtOffset(full, offset)
    if (stmt) return { sql: stmt.text, startLine: stmt.startLine }
    return { sql: full, startLine: 1 }
  }

  const handleExecute = () => {
    const target = getRunTarget()
    if (target.sql.trim()) onExecute(target.sql, target.startLine)
  }

  const handleRunAll = () => {
    const sql = editorRef.current?.getValue() ?? value
    if (sql.trim()) onRunAll(sql)
  }

  const handleExplain = () => {
    const sql = editorRef.current?.getValue() ?? value
    if (sql.trim()) onExplain(sql)
  }

  const handleFormat = () => {
    const sql = editorRef.current?.getValue() ?? value
    if (!sql.trim()) return
    const formatted = formatSql(sql, dbType)
    suppressRef.current = true
    editorRef.current?.setValue(formatted)
    suppressRef.current = false
    onChange(formatted)
  }

  const handleNextStatement = () => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()!
    const pos = editor.getPosition()!
    const offset = model.getOffsetAt(pos)
    const statements = splitSqlStatements(model.getValue())
    let next: SqlStatement | null = null
    for (const s of statements) {
      if (s.start > offset) {
        next = s
        break
      }
    }
    if (!next && statements.length > 0) next = statements[0]
    if (next) {
      const p = model.getPositionAt(next.start)
      editor.setPosition(p)
      editor.revealLineInCenter(p.lineNumber)
    }
  }

  const handleInsertSnippet = (sql: string) => {
    const editor = editorRef.current
    if (!editor) return
    setSnippetOpen(false)
    editor.trigger("snippet", "editor.action.insertSnippet", { snippet: sql })
    editor.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setHistoryOpen(false)
      setSnippetOpen(false)
    }
  }

  handlersRef.current = {
    execute: handleExecute,
    runAll: handleRunAll,
    nextStatement: handleNextStatement,
    save: onSave,
    open: onOpen,
    toggleHistory: () => setHistoryOpen((prev) => !prev),
  }

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t('editor.title')}</span>
        <div className="flex items-center gap-1">
          {lastExec && !executing && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {t('editor.last_exec', { duration: lastExec.duration, count: lastExec.count })}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onOpen} title={t('editor.open_file')}>
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onSave} title={t('editor.save_file')}>
            <Save className="h-3.5 w-3.5" />
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setHistoryOpen((prev) => !prev)}
              title={t('editor.history')}
            >
              <History className="h-3.5 w-3.5" />
            </Button>
            {historyOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} />
                <div className="absolute right-0 top-8 z-50 w-80 rounded-md border bg-popover shadow-md">
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b flex items-center justify-between">
                    <span>{t('editor.history')}</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {favorites.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/80 bg-muted/40 sticky top-0">
                          {t('editor.favorites')}
                        </div>
                        {favorites.map((h, i) => (
                          <div key={`f${i}`} className="flex items-center border-b border-border/50 last:border-b-0 group">
                            <button
                              className="flex-1 px-3 py-1.5 text-left text-xs hover:bg-muted/60 font-mono truncate"
                              onClick={() => {
                                setHistoryOpen(false)
                                onHistoryRun(h)
                              }}
                            >
                              {h}
                            </button>
                            <button
                              className="px-2 py-1.5 text-amber-500 hover:bg-muted/60"
                              title={t('editor.unpin')}
                              onClick={() => onToggleFavorite(h)}
                            >
                              <Pin className="h-3 w-3 fill-current" />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                    <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/80 bg-muted/40 sticky top-0">
                      {t('editor.recent')}
                    </div>
                    {history.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">{t('editor.history_empty')}</div>
                    )}
                    {history.map((h, i) => (
                      <div key={i} className="flex items-center border-b border-border/50 last:border-b-0 group">
                        <button
                          className="flex-1 px-3 py-1.5 text-left text-xs hover:bg-muted/60 font-mono truncate"
                          onClick={() => {
                            setHistoryOpen(false)
                            onHistoryRun(h)
                          }}
                        >
                          {h}
                        </button>
                        <button
                          className={`px-2 py-1.5 hover:bg-muted/60 ${favorites.includes(h) ? "text-amber-500" : "text-muted-foreground/40 opacity-0 group-hover:opacity-100"}`}
                          title={t('editor.pin')}
                          onClick={() => onToggleFavorite(h)}
                        >
                          {favorites.includes(h) ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onNewTab} title={t('editor.new_tab')}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setSnippetOpen((prev) => !prev)}
              title={t('editor.snippets')}
            >
              <Braces className="h-3.5 w-3.5" />
            </Button>
            {snippetOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSnippetOpen(false)} />
                <div className="absolute right-0 top-8 z-50 w-72 rounded-md border bg-popover shadow-md">
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                    {t('editor.snippets')}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {SQL_SNIPPETS.map((s) => (
                      <button
                        key={s.name}
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/60 border-b border-border/50 last:border-b-0"
                        onClick={() => handleInsertSnippet(s.sql)}
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="block text-[10px] text-muted-foreground">{s.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="w-px h-4 bg-border mx-1" />
          {txActive ? (
            <>
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onCommitTransaction} title={t('editor.commit')}>
                <Check className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('editor.commit')}</span>
              </Button>
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onRollbackTransaction} title={t('editor.rollback')}>
                <Undo2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('editor.rollback')}</span>
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onBeginTransaction} title={t('editor.begin')}>
              <Database className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('editor.begin')}</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={handleFormat} title={t('editor.format')}>
            <Wand2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('editor.format')}</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={handleExplain} title={t('editor.explain')}>
            <FileSearch className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('editor.explain')}</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={handleRunAll} title={t('editor.run_all')}>
            <ListTodo className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('editor.run_all')}</span>
          </Button>
          <Button size="sm" variant="default" className="h-7 gap-1" onClick={executing ? onCancel : handleExecute} title={executing ? t('editor.stop') : t('editor.run')}>
            {executing ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            {executing ? t('editor.stop') : t('editor.run')}
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
