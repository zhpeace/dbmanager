import { invoke } from "@tauri-apps/api/core"

export function invokeWithTimeout<T>(command: string, args: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<T>((resolve, reject) => {
    let settled = false
    timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`${command} timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)
    invoke<T>(command, args).then(
      (v) => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      },
      (e) => {
        if (!settled) {
          settled = true
          reject(e)
        }
      }
    )
  }).finally(() => {
    if (timer) clearTimeout(timer)
  })
}