import type { OrderLevel } from '../types/market'

export type DepthCallback = (bids: OrderLevel[], asks: OrderLevel[]) => void
export type StatusCallback = (connected: boolean) => void

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

  function connect() {
    if (disposed) return
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(`[Binance depth] Connected: ${symbol}`)
      onStatus(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.bids && msg.asks) {
          const bids: OrderLevel[] = msg.bids.map((b: string[]) => ({
            price: parseFloat(b[0]),
            qty: parseFloat(b[1]),
          }))
          const asks: OrderLevel[] = msg.asks.map((a: string[]) => ({
            price: parseFloat(a[0]),
            qty: parseFloat(a[1]),
          }))
          onDepth(bids, asks)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      console.log(`[Binance depth] Disconnected: ${symbol}`)
      onStatus(false)
      if (!disposed) reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
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
