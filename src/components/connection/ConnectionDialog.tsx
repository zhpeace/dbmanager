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
import type { ConnectionConfig, DatabaseType, LicenseStatus, SshConfig, SslConfig } from "@/lib/db"
import { DB_DISPLAY_NAMES, DEFAULT_PORTS, isConnectorAvailable, saveConnectionSecret } from "@/lib/db"

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (config: ConnectionConfig) => void
  editingConfig?: ConnectionConfig | null
  license?: LicenseStatus | null
}

function buildSsh(c: {
  sshEnabled: boolean
  sshHost: string
  sshPort: string
  sshUser: string
  sshAuthType: 'password' | 'key'
  sshPassword: string
  sshKey: string
}): SshConfig | undefined {
  if (!c.sshEnabled) return undefined
  return {
    enabled: true,
    host: c.sshHost,
    port: Number(c.sshPort) || 22,
    user: c.sshUser,
    authType: c.sshAuthType,
    password: c.sshAuthType === 'password' ? (c.sshPassword || undefined) : undefined,
    privateKey: c.sshAuthType === 'key' ? (c.sshKey || undefined) : undefined,
  }
}

function buildSsl(c: {
  sslEnabled: boolean
  sslMode: string
  sslCa: string
}): SslConfig | undefined {
  if (!c.sslEnabled) return undefined
  return {
    enabled: true,
    mode: (c.sslMode as SslConfig['mode']) || 'require',
    caPath: c.sslCa || undefined,
  }
}

export function ConnectionDialog({ open, onOpenChange, onSave, editingConfig, license }: ConnectionDialogProps) {
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

  const [sshEnabled, setSshEnabled] = useState(false)
  const [sshHost, setSshHost] = useState("")
  const [sshPort, setSshPort] = useState("22")
  const [sshUser, setSshUser] = useState("")
  const [sshAuthType, setSshAuthType] = useState<'password' | 'key'>('password')
  const [sshPassword, setSshPassword] = useState("")
  const [sshKey, setSshKey] = useState("")

  const [sslEnabled, setSslEnabled] = useState(false)
  const [sslMode, setSslMode] = useState('require')
  const [sslCa, setSslCa] = useState("")

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
    const ssh = editingConfig?.ssh
    setSshEnabled(!!ssh?.enabled)
    setSshHost(ssh?.host || "")
    setSshPort(String(ssh?.port || 22))
    setSshUser(ssh?.user || "")
    setSshAuthType((ssh?.authType as 'password' | 'key') || 'password')
    setSshPassword(ssh?.password || "")
    setSshKey(ssh?.privateKey || "")
    const ssl = editingConfig?.ssl
    setSslEnabled(!!ssl?.enabled)
    setSslMode(ssl?.mode || 'require')
    setSslCa(ssl?.caPath || "")
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
        ssh: buildSsh({ sshEnabled, sshHost, sshPort, sshUser, sshAuthType, sshPassword, sshKey }) || null,
        ssl: buildSsl({ sslEnabled, sslMode, sslCa }) || null,
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
    const ssh = buildSsh({ sshEnabled, sshHost, sshPort, sshUser, sshAuthType, sshPassword, sshKey })
    const ssl = buildSsl({ sslEnabled, sslMode, sslCa })
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
      ...(ssh ? { ssh } : {}),
      ...(ssl ? { ssl } : {}),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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
                {Object.entries(DB_DISPLAY_NAMES).map(([key, name]) => {
                  const available = isConnectorAvailable(key as DatabaseType, license)
                  return (
                    <SelectItem key={key} value={key} disabled={!available}>
                      {name}{!available ? " (Pro)" : ""}
                    </SelectItem>
                  )
                })}
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
              <SshSslSections
                sshEnabled={sshEnabled} setSshEnabled={setSshEnabled}
                sshHost={sshHost} setSshHost={setSshHost}
                sshPort={sshPort} setSshPort={setSshPort}
                sshUser={sshUser} setSshUser={setSshUser}
                sshAuthType={sshAuthType} setSshAuthType={setSshAuthType}
                sshPassword={sshPassword} setSshPassword={setSshPassword}
                sshKey={sshKey} setSshKey={setSshKey}
                sslEnabled={sslEnabled} setSslEnabled={setSslEnabled}
                sslMode={sslMode} setSslMode={setSslMode}
                sslCa={sslCa} setSslCa={setSslCa}
              />
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
              <SshSslSections
                sshEnabled={sshEnabled} setSshEnabled={setSshEnabled}
                sshHost={sshHost} setSshHost={setSshHost}
                sshPort={sshPort} setSshPort={setSshPort}
                sshUser={sshUser} setSshUser={setSshUser}
                sshAuthType={sshAuthType} setSshAuthType={setSshAuthType}
                sshPassword={sshPassword} setSshPassword={setSshPassword}
                sshKey={sshKey} setSshKey={setSshKey}
                sslEnabled={sslEnabled} setSslEnabled={setSslEnabled}
                sslMode={sslMode} setSslMode={setSslMode}
                sslCa={sslCa} setSslCa={setSslCa}
              />
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

interface SshSslSectionsProps {
  sshEnabled: boolean; setSshEnabled: (v: boolean) => void
  sshHost: string; setSshHost: (v: string) => void
  sshPort: string; setSshPort: (v: string) => void
  sshUser: string; setSshUser: (v: string) => void
  sshAuthType: 'password' | 'key'; setSshAuthType: (v: 'password' | 'key') => void
  sshPassword: string; setSshPassword: (v: string) => void
  sshKey: string; setSshKey: (v: string) => void
  sslEnabled: boolean; setSslEnabled: (v: boolean) => void
  sslMode: string; setSslMode: (v: string) => void
  sslCa: string; setSslCa: (v: string) => void
}

function SshSslSections(props: SshSslSectionsProps) {
  return (
    <>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium select-none">SSH 隧道（跳板机 / 堡垒机）</summary>
        <div className="mt-3 grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={props.sshEnabled} onChange={(e) => props.setSshEnabled(e.target.checked)} />
            通过 SSH 隧道连接
          </label>
          {props.sshEnabled && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 grid gap-2">
                  <Label>SSH 主机</Label>
                  <Input placeholder="bastion.example.com" value={props.sshHost} onChange={(e) => props.setSshHost(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>SSH 端口</Label>
                  <Input value={props.sshPort} onChange={(e) => props.setSshPort(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>SSH 用户</Label>
                  <Input value={props.sshUser} onChange={(e) => props.setSshUser(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>认证方式</Label>
                  <Select value={props.sshAuthType} onValueChange={(v) => props.setSshAuthType(v as 'password' | 'key')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">密码</SelectItem>
                      <SelectItem value="key">私钥</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {props.sshAuthType === 'password' ? (
                <div className="grid gap-2">
                  <Label>SSH 密码</Label>
                  <Input type="password" value={props.sshPassword} onChange={(e) => props.setSshPassword(e.target.value)} />
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label>私钥（文件路径或 PEM 内容）</Label>
                  <Input placeholder="/Users/you/.ssh/id_rsa 或 -----BEGIN ...-----" value={props.sshKey} onChange={(e) => props.setSshKey(e.target.value)} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                数据库地址（上方 host/port）将作为 SSH 服务端可达的目标地址通过隧道转发。
              </p>
            </>
          )}
        </div>
      </details>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium select-none">SSL / TLS 加密</summary>
        <div className="mt-3 grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={props.sslEnabled} onChange={(e) => props.setSslEnabled(e.target.checked)} />
            启用 SSL 连接（PostgreSQL / MySQL）
          </label>
          {props.sslEnabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>模式</Label>
                  <Select value={props.sslMode} onValueChange={(v) => props.setSslMode(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prefer">prefer</SelectItem>
                      <SelectItem value="require">require</SelectItem>
                      <SelectItem value="verify-ca">verify-ca</SelectItem>
                      <SelectItem value="verify-full">verify-full</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>CA 证书路径</Label>
                  <Input placeholder="可选" value={props.sslCa} onChange={(e) => props.setSslCa(e.target.value)} />
                </div>
              </div>
            </>
          )}
        </div>
      </details>
    </>
  )
}
