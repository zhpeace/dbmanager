import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ConnectionConfig, DatabaseType } from "@/lib/db"
import { DB_DISPLAY_NAMES, DEFAULT_PORTS, saveConnectionSecret } from "@/lib/db"

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (config: ConnectionConfig) => void
  editingConfig?: ConnectionConfig | null
}

export function ConnectionDialog({ open, onOpenChange, onSave, editingConfig }: ConnectionDialogProps) {
  const { t } = useTranslation()
  const [type, setType] = useState<DatabaseType>(editingConfig?.type || "mysql")
  const [name, setName] = useState(editingConfig?.name || "")
  const [host, setHost] = useState(editingConfig?.host || "localhost")
  const [port, setPort] = useState(String(editingConfig?.port || DEFAULT_PORTS[type]))
  const [user, setUser] = useState(editingConfig?.user || "root")
  const [password, setPassword] = useState(editingConfig?.password || "")
  const [database, setDatabase] = useState(editingConfig?.database || "")
  const [filePath, setFilePath] = useState(editingConfig?.filePath || "")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const isEditing = !!editingConfig
  const isSqlite = type === "sqlite"
  const isRedis = type === "redis"

  useEffect(() => {
    if (!open) return
    setType(editingConfig?.type || "mysql")
    setName(editingConfig?.name || "")
    setHost(editingConfig?.host || "localhost")
    setPort(String(editingConfig?.port || DEFAULT_PORTS[editingConfig?.type || "mysql"]))
    setUser(editingConfig?.user || "root")
    setPassword(editingConfig?.password || "")
    setDatabase(editingConfig?.database || "")
    setFilePath(editingConfig?.filePath || "")
    setTestResult(null)
    setTesting(false)
    if (editingConfig?.type === "redis") {
      setUser("")
    }
  }, [open, editingConfig])

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await invoke<string>("test_connection", {
        type: type,
        host: host || "localhost",
        port: Number(port) || DEFAULT_PORTS[type],
        user: user || "",
        password: password || "",
        database: database || null,
      })
      setTestResult({ ok: true, message: result })
    } catch (e) {
      setTestResult({ ok: false, message: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const id = editingConfig?.id || crypto.randomUUID()
    const connPassword = isSqlite ? "" : password
    if (!isSqlite && connPassword) {
      try {
        await saveConnectionSecret(id, connPassword)
      } catch {
        // keyring unavailable; fall back to storing in config
      }
    }
    onSave({
      id,
      name,
      type,
      host: isSqlite ? undefined : host,
      port: isSqlite ? undefined : Number(port),
      user: isSqlite || isRedis ? undefined : user,
      password: isSqlite ? undefined : (connPassword || undefined),
      database: isSqlite ? undefined : database,
      filePath: isSqlite ? filePath : undefined,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('connection.edit_title') : t('connection.new_title')}</DialogTitle>
          <DialogDescription>
            {t('connection.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>{t('connection.database_type')}</Label>
            <Select value={type} onValueChange={(v) => {
              setType(v as DatabaseType)
              setPort(String(DEFAULT_PORTS[v as DatabaseType]))
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DB_DISPLAY_NAMES).map(([key, name]) => (
                  <SelectItem key={key} value={key}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{t('connection.name')}</Label>
            <Input
              placeholder={t('connection.name_placeholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {isSqlite ? (
            <div className="grid gap-2">
              <Label>{t('connection.file_path')}</Label>
              <Input
                placeholder={t('connection.file_path_placeholder')}
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
              />
            </div>
          ) : isRedis ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 grid gap-2">
                  <Label>{t('connection.host')}</Label>
                  <Input
                    placeholder={t('connection.host_placeholder')}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t('connection.port')}</Label>
                  <Input
                    placeholder={t('connection.port_placeholder')}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t('connection.password')}</Label>
                <Input
                  type="password"
                  placeholder={t('connection.password_placeholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('connection.database_index')}</Label>
                <Input
                  placeholder={t('connection.database_index_placeholder')}
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 grid gap-2">
                  <Label>{t('connection.host')}</Label>
                  <Input
                    placeholder={t('connection.host_placeholder')}
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t('connection.port')}</Label>
                  <Input
                    placeholder={t('connection.port_placeholder')}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>{t('connection.user')}</Label>
                  <Input
                    placeholder={t('connection.user_placeholder')}
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t('connection.password')}</Label>
                  <Input
                    type="password"
                    placeholder={t('connection.password_placeholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t('connection.database')}</Label>
                <Input
                  placeholder={t('connection.database_placeholder')}
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        {testResult && (
          <div className={`px-4 py-2 rounded-md text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {testResult.message}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleTestConnection} disabled={testing || (isSqlite && !filePath)}>
            {testing ? t('connection.testing') : t('connection.test')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('connection.cancel')}</Button>
          <Button onClick={handleSave} disabled={!name || (isSqlite ? !filePath : !host)}>
            {isEditing ? t('connection.save') : t('connection.connect')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
