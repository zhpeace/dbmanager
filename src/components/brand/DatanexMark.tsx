import type { SVGProps } from "react"

const NODES = [0, 45, 90, 135, 180, 225, 270, 315]

/** Datanex 数据枢纽图形标——中心核心 + 8 节点辐射，随 currentColor 自动适配主题 */
export function DatanexMark({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
      {...rest}
    >
      <circle cx="12" cy="12" r="2.8" fill="currentColor" stroke="none" />
      {NODES.map((a) => {
        const rad = (a * Math.PI) / 180
        return (
          <line
            key={a}
            x1={12 + 2.8 * Math.cos(rad)}
            y1={12 + 2.8 * Math.sin(rad)}
            x2={12 + 8 * Math.cos(rad)}
            y2={12 + 8 * Math.sin(rad)}
          />
        )
      })}
      {NODES.map((a) => {
        const rad = (a * Math.PI) / 180
        return (
          <circle
            key={`n${a}`}
            cx={12 + 8 * Math.cos(rad)}
            cy={12 + 8 * Math.sin(rad)}
            r="1.5"
            fill="currentColor"
            stroke="none"
          />
        )
      })}
    </svg>
  )
}
