/**
 * 迁移任务投递动画：点「开始迁移」后，一个小光点从对话框的开始按钮
 * 沿抛物线轨迹飞向顶栏「任务」按钮，到达后触发 transfer-arrived 事件
 * （TaskCenter 收到后打开任务中心并让徽标弹跳）。
 *
 * 零依赖：原生 Web Animations API + fixed 定位元素，GPU 合成不掉帧。
 * 系统开启「减弱动态效果」时自动降级为直接派发到达事件（不播动画）。
 */

export const TASK_CENTER_TRIGGER_ID = "task-center-trigger"
export const TRANSFER_START_BTN_ID = "transfer-start-btn"
export const TRANSFER_ARRIVED_EVENT = "datanex:transfer-arrived"

function arrived(): void {
  window.dispatchEvent(new CustomEvent(TRANSFER_ARRIVED_EVENT))
}

/**
 * 从起点矩形飞向顶栏「任务」按钮。
 * @param fromRect 开始按钮的 getBoundingClientRect()；为 null 时直接到达
 */
export function launchTransferAnimation(fromRect: DOMRect | null): void {
  const toEl = document.getElementById(TASK_CENTER_TRIGGER_ID)
  if (!fromRect || !toEl) {
    arrived()
    return
  }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  if (reduced) {
    arrived()
    return
  }
  const toRect = toEl.getBoundingClientRect()
  const x0 = fromRect.left + fromRect.width / 2
  const y0 = fromRect.top + fromRect.height / 2
  const x1 = toRect.left + toRect.width / 2
  const y1 = toRect.top + toRect.height / 2

  const dot = document.createElement("div")
  dot.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:12px",
    "height:12px",
    "margin:-6px 0 0 -6px",
    "border-radius:9999px",
    "background:var(--color-primary,#3b82f6)",
    "box-shadow:0 0 14px 4px color-mix(in srgb, var(--color-primary,#3b82f6) 55%, transparent)",
    "z-index:9999",
    "pointer-events:none",
  ].join(";")
  document.body.appendChild(dot)

  const apex = Math.min(y0, y1) - 72
  const anim = dot.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(0.5)`, opacity: 1 },
      {
        transform: `translate(${(x0 + x1) / 2}px, ${apex}px) scale(1)`,
        opacity: 1,
        offset: 0.45,
      },
      { transform: `translate(${x1}px, ${y1}px) scale(0.25)`, opacity: 0.35 },
    ],
    { duration: 720, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  )
  anim.onfinish = () => {
    dot.remove()
    arrived()
  }
  // 极端情况下动画被取消/中断时兜底清理
  anim.oncancel = () => {
    dot.remove()
    arrived()
  }
}
