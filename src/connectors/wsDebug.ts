/**
 * wsDebug.ts
 *
 * Centralized WebSocket diagnostic logging.
 * Only active in dev mode (import.meta.env.DEV).
 * Set window.__WS_DEBUG = false to silence at runtime.
 */

const isDev = import.meta.env?.DEV ?? false

// Runtime toggle: window.__WS_DEBUG = false to silence
function isEnabled(): boolean {
  if (!isDev) return false
  try { return (window as any).__WS_DEBUG !== false } catch { return true }
}

export function wsLog(stream: string, symbol: string, msg: string, extra?: Record<string, unknown>) {
  if (!isEnabled()) return
  const tag = `[WS:${stream}:${symbol}]`
  if (extra) {
    console.log(`${tag} ${msg}`, extra)
  } else {
    console.log(`${tag} ${msg}`)
  }
}

export function wsWarn(stream: string, symbol: string, msg: string, extra?: Record<string, unknown>) {
  if (!isEnabled()) return
  const tag = `[WS:${stream}:${symbol}]`
  if (extra) {
    console.warn(`${tag} ${msg}`, extra)
  } else {
    console.warn(`${tag} ${msg}`)
  }
}

export function wsError(stream: string, symbol: string, msg: string, extra?: Record<string, unknown>) {
  if (!isEnabled()) return
  const tag = `[WS:${stream}:${symbol}]`
  if (extra) {
    console.error(`${tag} ${msg}`, extra)
  } else {
    console.error(`${tag} ${msg}`)
  }
}

export function wsTable(stream: string, symbol: string, data: Record<string, unknown>) {
  if (!isEnabled()) return
  console.log(`[WS:${stream}:${symbol}]`)
  console.table(data)
}
