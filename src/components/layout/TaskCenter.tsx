import { useSyncExternalStore, useState } from "react"
import { useTranslation } from "react-i18next"
import { ListTodo, Loader2, X, CheckCircle2, XCircle, Ban, ChevronDown, ChevronRight, Trash2, Clock, Table2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  subscribeTransferTasks,
  getTransferTasks,
  getRunningTask,
  cancelRunningTask,
  removeTask,
  clearTaskHistory,
  type TransferTask,
} from "@/lib/transferTasks"

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}m${r.toString().padStart(2, "0")}s` : `${r}s`
}

function StatusIcon({ t }: { t: TransferTask }) {
  switch (t.status) {
    case "success": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    case "error": return <XCircle className="h-4 w-4 text-red-500" />
    case "cancelled": return <Ban className="h-4 w-4 text-muted-foreground" />
    default: return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  }
}

function TaskSummary({ t }: { t: TransferTask }) {
  const { t: tr } = useTranslation()
  if (t.status === "success") {
    return <span className="text-emerald-600 dark:text-emerald-400">{tr("task.summary_success", { done: t.done, total: t.total })}</span>
  }
  if (t.status === "error") {
    return <span className="text-red-600 dark:text-red-400">{tr("task.summary_error", { done: t.done, total: t.total, errs: t.errors.length })}</span>
  }
  if (t.status === "cancelled") {
    return <span className="text-muted-foreground">{tr("task.summary_cancelled", { done: t.done, total: t.total })}</span>
  }
  return (
    <span className="text-muted-foreground">
      {tr("task.summary_running", { done: t.done, total: t.total })}
    </span>
  )
}

function RunningCard({ task }: { task: TransferTask }) {
  const { t } = useTranslation()
  const [cancelling, setCancelling] = useState(false)
  const pct = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <span className="text-sm font-medium truncate">
            {task.sourceLabel} <span className="text-muted-foreground">→</span> {task.targetLabel}
          </span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{fmtDuration(Date.now() - task.startedAt)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1 truncate">
          <Table2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{task.currentTable || t("task.preparing")}</span>
        </span>
        <span className="shrink-0 pl-2">{task.done}/{task.total} · {pct}%</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={task.status === "cancelling" || cancelling}
        onClick={async () => {
          setCancelling(true)
          await cancelRunningTask()
          setCancelling(false)
        }}
      >
        {task.status === "cancelling" || cancelling ? (
          <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t("task.cancelling")}</>
        ) : (
          <><X className="h-3.5 w-3.5 mr-1" />{t("task.cancel")}</>
        )}
      </Button>
    </div>
  )
}

function HistoryItem({ task }: { task: TransferTask }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border bg-card">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 rounded-lg"
        onClick={() => setExpanded(!expanded)}
      >
        <StatusIcon t={task} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">
            {task.sourceLabel} <span className="text-muted-foreground">→</span> {task.targetLabel}
          </div>
          <div className="text-[11px] flex items-center gap-1.5">
            <TaskSummary t={task} />
            <span className="text-muted-foreground/70">·</span>
            <span className="text-muted-foreground/70 flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {task.finishedAt ? fmtDuration(task.finishedAt - task.startedAt) : "-"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); removeTask(task.id) }}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title={t("task.remove")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </span>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {task.errors.length > 0 && (
            <div className="rounded bg-red-50 dark:bg-red-950/40 p-2 space-y-1 max-h-32 overflow-auto">
              {task.errors.slice(0, 20).map((e, i) => (
                <div key={i} className="text-[11px] text-red-600 dark:text-red-400 break-all">{e}</div>
              ))}
              {task.errors.length > 20 && (
                <div className="text-[11px] text-muted-foreground">{t("task.more_errors", { n: task.errors.length - 20 })}</div>
              )}
            </div>
          )}
          {task.logs.length > 0 && (
            <pre className="rounded bg-muted/60 p-2 text-[10px] leading-relaxed max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {task.logs.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskCenter() {
  const { t } = useTranslation()
  const tasks = useSyncExternalStore(subscribeTransferTasks, getTransferTasks)
  const running = getRunningTask()
  const history = tasks.filter((task) => task.status !== "running" && task.status !== "cancelling")
  const hasRunning = !!running

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="relative">
          <ListTodo className="h-4 w-4 mr-1" />
          {t("task.title")}
          {hasRunning && (
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">{t("task.title")}</span>
          {history.length > 0 && (
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={clearTaskHistory}>
              {t("task.clear")}
            </Button>
          )}
        </div>
        <div className="p-3 space-y-2">
          {running ? (
            <RunningCard task={running} />
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("task.empty")}</div>
          ) : null}
          {history.length > 0 && (
            <>
              <div className="pt-1 text-xs font-medium text-muted-foreground">{t("task.history")}</div>
              <ScrollArea className="max-h-72">
                <div className="space-y-2 pr-2">
                  {history.map((task) => (
                    <HistoryItem key={task.id} task={task} />
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
