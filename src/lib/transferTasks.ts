import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  clearCheckpoint,
  saveCheckpoint,
  type TransferOptions,
  type TransferResult,
} from "@/lib/db"

export type TransferTaskStatus =
  | "running"
  | "cancelling"
  | "success"
  | "error"
  | "cancelled"

export interface TransferTask {
  id: string
  sourceLabel: string
  targetLabel: string
  total: number
  done: number
  currentTable: string
  status: TransferTaskStatus
  errors: string[]
  logs: string[]
  startedAt: number
  finishedAt?: number
  /** [sourceId, targetId] —— 迁移期间被锁定的连接 */
  lockedConnections: [string, string]
  /** 断点上下文：取消/部分失败后可从任务中心直接恢复 */
  checkpoint: {
    sourceId: string
    sourceDb: string
    targetId: string
    targetDb: string
  } | null
}

let tasks: TransferTask[] = []
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

function updateTask(id: string, fn: (t: TransferTask) => TransferTask) {
  tasks = tasks.map((t) => (t.id === id ? fn(t) : t))
  notify()
}

export function subscribeTransferTasks(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getTransferTasks(): TransferTask[] {
  return tasks
}

export function getRunningTask(): TransferTask | undefined {
  return tasks.find((t) => t.status === "running" || t.status === "cancelling")
}

/** 连接是否正被某个进行中的迁移任务占用 */
export function isConnectionBusy(connectionId: string): boolean {
  const running = getRunningTask()
  if (!running) return false
  return (
    running.lockedConnections[0] === connectionId ||
    running.lockedConnections[1] === connectionId
  )
}

export interface StartTransferParams {
  taskId: string
  opts: TransferOptions
  sourceLabel: string
  targetLabel: string
  checkpoint: {
    sourceId: string
    sourceDb: string
    targetId: string
    targetDb: string
  } | null
}

let logListenerReady: Promise<void> | null = null

/** 全局 migration-log 事件按"当前唯一运行任务"归集（连接锁保证同一时刻只有一个 running） */
function ensureLogListener(): Promise<void> {
  if (logListenerReady) return logListenerReady
  logListenerReady = listen<string>("migration-log", (event) => {
    const msg = event.payload ?? ""
    const running = getRunningTask()
    if (!running) return
    updateTask(running.id, (t) => {
      const logs = [...t.logs, msg].slice(-800)
      let done = t.done
      let currentTable = t.currentTable
      if (msg.startsWith("Completed table:")) {
        done = Math.min(t.total, done + 1)
      } else if (msg.startsWith("Starting table:")) {
        currentTable = msg.slice("Starting table:".length).trim()
      } else if (/Table '[^']+' (failed|error)/i.test(msg)) {
        done = Math.min(t.total, done + 1)
      }
      return { ...t, logs, done, currentTable }
    })
  }).then(() => undefined)
  return logListenerReady
}

export async function startTransferTask(p: StartTransferParams): Promise<void> {
  if (isConnectionBusy(p.opts.source_id) || isConnectionBusy(p.opts.target_id)) {
    throw new Error("connection_busy")
  }
  const task: TransferTask = {
    id: p.taskId,
    sourceLabel: p.sourceLabel,
    targetLabel: p.targetLabel,
    total: p.opts.tables.length,
    done: 0,
    currentTable: "",
    status: "running",
    errors: [],
    logs: [],
    startedAt: Date.now(),
    lockedConnections: [p.opts.source_id, p.opts.target_id],
    checkpoint: p.checkpoint,
  }
  // 同断点上下文的历史已取消任务被新任务取代（恢复/重新开始后不再堆积重复记录）
  if (p.checkpoint) {
    const cp = p.checkpoint
    tasks = tasks.filter((t) => {
      if (t.status !== "cancelled" || !t.checkpoint) return true
      return !(
        t.checkpoint.sourceId === cp.sourceId &&
        t.checkpoint.sourceDb === cp.sourceDb &&
        t.checkpoint.targetId === cp.targetId &&
        t.checkpoint.targetDb === cp.targetDb
      )
    })
  }
  tasks = [task, ...tasks].slice(0, 50)
  notify()
  await ensureLogListener()

  try {
    const res: TransferResult = await invoke("transfer_data", {
      opts: p.opts,
      taskId: p.taskId,
    })
    const errs = res.errors ?? []
    updateTask(p.taskId, (t) => ({
      ...t,
      done: t.total,
      status: errs.length > 0 ? "error" : "success",
      errors: errs,
      finishedAt: Date.now(),
    }))
    if (p.checkpoint) {
      if (errs.length === 0) {
        await clearCheckpoint(
          p.checkpoint.sourceId,
          p.checkpoint.sourceDb,
          p.checkpoint.targetId,
          p.checkpoint.targetDb,
        )
      } else {
        const partial = p.opts.tables.filter((t) =>
          res.tables_transferred.includes(t),
        )
        await saveCheckpoint(
          p.checkpoint.sourceId,
          p.checkpoint.sourceDb,
          p.checkpoint.targetId,
          p.checkpoint.targetDb,
          partial,
          res.rows_transferred,
        )
      }
    }
  } catch (e: any) {
    const msg = String(e ?? "")
    const cancelled = /cancel/i.test(msg)
    if (cancelled && p.checkpoint) {
      // 取消时也保存断点：已结束（完成或失败）的表 = 前 done 个，恢复时从其后继续
      const t = tasks.find((x) => x.id === p.taskId)
      const doneTables = p.opts.tables.slice(0, t?.done ?? 0)
      await saveCheckpoint(
        p.checkpoint.sourceId,
        p.checkpoint.sourceDb,
        p.checkpoint.targetId,
        p.checkpoint.targetDb,
        doneTables,
        0,
      )
    }
    updateTask(p.taskId, (t) => ({
      ...t,
      status: cancelled ? "cancelled" : "error",
      errors: cancelled ? [] : [msg],
      finishedAt: Date.now(),
    }))
  }
}

export async function cancelRunningTask(): Promise<void> {
  const running = getRunningTask()
  if (!running || running.status !== "running") return
  updateTask(running.id, (t) => ({ ...t, status: "cancelling" }))
  try {
    await invoke("cancel_transfer", { taskId: running.id })
  } catch {
    // 忽略取消命令自身失败；Rust 侧循环仍会完成或报错
  }
}

export function removeTask(id: string) {
  tasks = tasks.filter((t) => t.id !== id)
  notify()
}

export function clearTaskHistory() {
  tasks = tasks.filter((t) => t.status === "running" || t.status === "cancelling")
  notify()
}

/** 仅测试用：重置模块级状态 */
export function __resetTransferTasksForTest() {
  tasks = []
  listeners.clear()
}
