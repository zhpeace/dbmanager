// 列表级编辑：批量修改列的取值计算（纯函数，便于单元测试）。
// mode 取值：
//   constant   —— 常量（原样写入）
//   expression —— 表达式，用「原值」引用当前行值做数字运算，如 原值+1、原值*0.9
//   now        —— 当前本地时间（YYYY-MM-DD HH:MM:SS）
//   uuid       —— 随机 UUID v4
//   null       —— 置空（NULL）
//   sequence   —— 序号：起始值 + 行内序号 * 步长

export type BulkEditMode = "constant" | "expression" | "now" | "uuid" | "null" | "sequence"

export interface BulkEditApply {
  column: string
  mode: BulkEditMode
  /** constant / expression 的值 */
  value: string
  /** sequence 模式的起始值 */
  seqStart: number
  /** sequence 模式的步长 */
  seqStep: number
}

export interface BulkEditResult {
  value: string | number | null
  error?: string
}

/** 表达式求值：只允许数字与四则运算，禁止任意代码执行 */
export function evalBulkExpression(base: number, expr: string): number {
  let clean = expr.trim()
  if (clean.startsWith("=")) clean = clean.slice(1).trim()
  // 用括号包住 base，避免 原值+1 解析成 原值(+1)
  clean = clean.replace(/原值/g, `(${Number.isFinite(base) ? base : 0})`)
  if (clean === "") return base
  if (!/^[0-9+\-*/().\s]+$/.test(clean)) {
    throw new Error("表达式仅支持数字与 + - * / ( ) 运算")
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${clean});`)
  const v = fn()
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error("表达式结果不是有效数字")
  }
  return v
}

function nowLocal(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 计算某一行应用批量修改后的新值。
 * @param orig 该行当前值（可能为 null/undefined/数字/字符串）
 * @param spec 修改规格
 * @param seqPos 该行在选中集合中的序号（0 起），用于 sequence 模式
 */
export function computeBulkValue(orig: unknown, spec: BulkEditApply, seqPos: number): BulkEditResult {
  switch (spec.mode) {
    case "constant":
      return { value: spec.value }
    case "expression": {
      const base = typeof orig === "number" ? orig : Number(String(orig ?? ""))
      if (!Number.isFinite(base)) {
        return { value: spec.value, error: "当前值不是数字，无法执行表达式运算" }
      }
      try {
        return { value: evalBulkExpression(base, spec.value) }
      } catch (e: any) {
        return { value: spec.value, error: String(e?.message ?? e) }
      }
    }
    case "now":
      return { value: nowLocal() }
    case "uuid":
      try {
        return { value: crypto.randomUUID() }
      } catch {
        // 非安全环境兜底：时间戳 + 随机段
        return { value: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
      }
    case "null":
      return { value: null }
    case "sequence":
      return { value: spec.seqStart + seqPos * spec.seqStep }
    default:
      return { value: spec.value, error: "未知的修改方式" }
  }
}
