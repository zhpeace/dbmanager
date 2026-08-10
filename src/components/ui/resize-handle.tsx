import * as React from "react"
import { cn } from "@/lib/utils"

interface ResizeHandleProps {
  orientation: "vertical" | "horizontal"
  onDelta: (delta: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  className?: string
}

export function ResizeHandle({
  orientation,
  onDelta,
  onDragStart,
  onDragEnd,
  className,
}: ResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false)
  const start = React.useRef(0)

  return (
    <div
      role="separator"
      aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
      className={cn(
        "z-10 select-none touch-none bg-transparent transition-colors",
        orientation === "vertical"
          ? "w-1.5 shrink-0 cursor-col-resize hover:bg-accent data-[dragging=true]:bg-accent"
          : "h-1.5 shrink-0 cursor-row-resize hover:bg-accent data-[dragging=true]:bg-accent",
        className
      )}
      data-dragging={dragging}
      onPointerDown={(e) => {
        setDragging(true)
        start.current = orientation === "vertical" ? e.clientX : e.clientY
        onDragStart?.()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        const pos = orientation === "vertical" ? e.clientX : e.clientY
        onDelta(pos - start.current)
      }}
      onPointerUp={() => {
        if (!dragging) return
        setDragging(false)
        onDragEnd?.()
      }}
      onPointerCancel={() => {
        if (!dragging) return
        setDragging(false)
        onDragEnd?.()
      }}
    />
  )
}
