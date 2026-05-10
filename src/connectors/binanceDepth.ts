import type { OrderLevel } from '../types/market'

export type DepthCallback = (bids: OrderLevel[], asks: OrderLevel[]) => void
export type StatusCallback = (connected: boolean) => void
export type StaleCallback = (stale: boolean) => void
export type MessageTimeCallback = (time: number) => void

// ─── Diagnostics ───
export interface DepthDiagnostics {
  url: string
  symbol: string
  opened: boolean
  messageCount: number
  lastMessageTime: number
  parseErrors: number
  closeCount: number
  lastError: string | null
  bidLevels: number
  askLevels: number
  resyncCount: number
  consecutiveErrors: number
}

let depthDiag: DepthDiagnostics = {
  url: '', symbol: '', opened: false, messageCount: 0,
  lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null,
  bidLevels: 0, askLevels: 0, resyncCount: 0, consecutiveErrors: 0,
}

export function getDepthDiagnostics(): DepthDiagnostics {
  return { ...depthDiag }
}

const STALE_THRESHOLD_MS = 10_000
const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000

/**
 * Connect to Binance Futures depth20 snapshot stream.
 *
 * Implements:
 * - Exponential backoff reconnect
 * - Staleness detection
 * - Health callbacks for UI
 * - Consecutive error tracking with forced resync
 */
export function connectBinanceDepth(
  symbol: string,
  onDepth: DepthCallback,
  onStatus: StatusCallback,
  onStale?: StaleCallback,
  onMessageTime?: MessageTimeCallback
): () => void {
  const wsSymbol = symbol.toLowerCase() + '@depth20@100ms'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false
  let reconnectDelay = INITIAL_RECONNECT_DELAY

  depthDiag = {
    url, symbol, opened: false, messageCount: 0,
    lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null,
    bidLevels: 0, askLevels: 0, resyncCount: 0, consecutiveErrors: 0,
  }

  function connect() {
    if (disposed) return
    console.log(`[Binance depth] Connecting: ${url}`)
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(`[Binance depth] Connected: ${symbol}`)
      depthDiag.opened = true
      depthDiag.lastError = null
      depthDiag.consecutiveErrors = 0
      reconnectDelay = INITIAL_RECONNECT_DELAY
      onStatus(true)
      if (onStale) onStale(false)
      startStaleMonitor()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        const rawBids = msg.bids ?? msg.b
        const rawAsks = msg.asks ?? msg.a

        if (rawBids && rawAsks) {
          const bids: OrderLevel[] = rawBids.map((b: string[]) => ({
            price: parseFloat(b[0]),
            qty: parseFloat(b[1]),
          }))
          const asks: OrderLevel[] = rawAsks.map((a: string[]) => ({
            price: parseFloat(a[0]),
            qty: parseFloat(a[1]),
          }))

          depthDiag.messageCount++
          depthDiag.lastMessageTime = Date.now()
          depthDiag.bidLevels = bids.length
          depthDiag.askLevels = asks.length
          depthDiag.consecutiveErrors = 0

          if (onMessageTime) onMessageTime(depthDiag.lastMessageTime)
          if (onStale) onStale(false)
          onDepth(bids, asks)
        }
      } catch (err) {
        depthDiag.parseErrors++
        depthDiag.consecutiveErrors++
        console.warn('[Binance depth] Parse error:', err)

        if (depthDiag.consecutiveErrors > 10) {
          console.warn('[Binance depth] Too many consecutive errors, forcing resync')
          depthDiag.resyncCount++
          depthDiag.consecutiveErrors = 0
          ws?.close()
        }
      }
    }

    ws.onclose = (ev) => {
      console.log(`[Binance depth] Disconnected: ${symbol} code=${ev.code}`)
      depthDiag.opened = false
      depthDiag.closeCount++
      onStatus(false)
      if (onStale) onStale(true)
      stopStaleMonitor()

      if (!disposed) {
        reconnectTimer = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY)
      }
    }

    ws.onerror = (ev) => {
      depthDiag.lastError = 'WebSocket error'
      console.error('[Binance depth] Error:', ev)
      ws?.close()
    }
  }

  function startStaleMonitor() {
    stopStaleMonitor()
    staleTimer = setInterval(() => {
      if (depthDiag.lastMessageTime > 0) {
        const elapsed = Date.now() - depthDiag.lastMessageTime
        if (elapsed > STALE_THRESHOLD_MS) {
          if (onStale) onStale(true)
        }
      }
    }, 5_000)
  }

  function stopStaleMonitor() {
    if (staleTimer) {
      clearInterval(staleTimer)
      staleTimer = null
    }
  }

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    stopStaleMonitor()
    ws?.close()
    ws = null
  }
}
