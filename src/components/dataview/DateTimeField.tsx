import { useState } from "react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"
import { cn } from "@/lib/utils"
import type { TemporalKind } from "@/lib/db"

const pad = (n: number) => String(n).padStart(2, "0")

function parseValue(value: string, kind: TemporalKind): Date | undefined {
  if (!value) return undefined
  if (kind === "time") {
    const m = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (!m) return undefined
    const d = new Date()
    d.setHours(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0, 0)
    return d
  }
  const iso = kind === "datetime" ? value.replace(" ", "T") : value
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso)
  return isNaN(d.getTime()) ? undefined : d
}

function formatValue(date: Date, kind: TemporalKind): string {
  const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const timeStr = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  if (kind === "date") return dateStr
  if (kind === "time") return timeStr
  return `${dateStr}T${timeStr}`
}

function TimeSelect({ value, onChange, max }: { value: number; onChange: (n: number) => void; max: number }) {
  return (
    <select
      className="rounded border bg-background px-1.5 py-1 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {Array.from({ length: max }, (_, i) => i).map((i) => (
        <option key={i} value={i}>
          {pad(i)}
        </option>
      ))}
    </select>
  )
}

interface DateTimeFieldProps {
  kind: TemporalKind
  value: string
  onChange: (value: string) => void
  className?: string
}

// 直接内嵌在弹窗内的时间设置面板（不嵌套第二层弹窗）。
export function DateTimeField({ kind, value, onChange, className }: DateTimeFieldProps) {
  const selected = parseValue(value, kind)
  const [month, setMonth] = useState<Date>(selected ?? new Date())
  const [time, setTime] = useState<{ h: number; m: number; s: number }>(() =>
    selected ? { h: selected.getHours(), m: selected.getMinutes(), s: selected.getSeconds() } : { h: 0, m: 0, s: 0 },
  )

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) return
    const d = new Date(day)
    d.setHours(time.h, time.m, time.s, 0)
    onChange(formatValue(d, kind))
  }

  const handleTime = (part: "h" | "m" | "s", v: number) => {
    const nt = { ...time, [part]: v }
    setTime(nt)
    const base = kind === "time" ? new Date() : selected ?? new Date()
    const d = new Date(base)
    d.setHours(nt.h, nt.m, nt.s, 0)
    onChange(formatValue(d, kind))
  }

  const showCalendar = kind !== "time"
  const showTime = kind !== "date"

  return (
    <div className={cn("rounded-md border bg-background p-3", className)}>
      {showCalendar && (
        <DayPicker
          mode="single"
          selected={selected}
          month={month}
          defaultMonth={month}
          onMonthChange={setMonth}
          onSelect={handleDaySelect}
        />
      )}
      {showTime && (
        <div className="mt-2 flex items-center gap-2 border-t pt-2 text-sm">
          <span className="text-muted-foreground">时间</span>
          <TimeSelect value={time.h} onChange={(v) => handleTime("h", v)} max={24} />
          <span className="text-muted-foreground">:</span>
          <TimeSelect value={time.m} onChange={(v) => handleTime("m", v)} max={60} />
          <span className="text-muted-foreground">:</span>
          <TimeSelect value={time.s} onChange={(v) => handleTime("s", v)} max={60} />
        </div>
      )}
    </div>
  )
}
