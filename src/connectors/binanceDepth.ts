import type { OrderLevel } from '../types/market'

export type DepthCallback = (bids: OrderLevel[], asks: OrderLevel[]) => void
export type StatusCallback = (connected: boolean) => void

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
}

let depthDiag: DepthDiagnostics = {
  url: '', symbol: '', opened: false, messageCount: 0,
  lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null,
  bidLevels: 0, askLevels: 0,
}

export function getDepthDiagnostics(): DepthDiagnostics {
  return { ...depthDiag }
}

export function connectBinanceDepth(
  symbol: string,
  onDepth: DepthCallback,
  onStatus: StatusCallback
): () => void {
  const wsSymbol = symbol.toLowerCase() + '@depth20@100ms'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  depthDiag = { url, symbol, opened: false, messageCount: 0, lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null, bidLevels: 0, askLevels: 0 }

  function connect() {
    if (disposed) return
    console.log(`[Binance depth] Connecting: ${url}`)
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(`[Binance depth] Connected: ${symbol}`)
      depthDiag.opened = true
      depthDiag.lastError = null
      onStatus(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)

        // Binance Futures depth20 stream uses "b" and "a" keys (not "bids"/"asks")
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

          onDepth(bids, asks)
        }
      } catch (err) {
        depthDiag.parseErrors++
        console.warn('[Binance depth] Parse error:', err)
      }
    }

    ws.onclose = (ev) => {
      console.log(`[Binance depth] Disconnected: ${symbol} code=${ev.code}`)
      depthDiag.opened = false
      depthDiag.closeCount++
      onStatus(false)
      if (!disposed) reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = (ev) => {
      depthDiag.lastError = 'WebSocket error'
      console.error('[Binance depth] Error:', ev)
      ws?.close()
    }
  }

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }
}
