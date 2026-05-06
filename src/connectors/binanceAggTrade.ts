import type { Trade } from '../types/market'

export type AggTradeCallback = (trade: Trade) => void
export type StatusCallback = (connected: boolean) => void

let tradeIdCounter = 0

export function connectBinanceAggTrade(
  symbol: string,
  onTrade: AggTradeCallback,
  onStatus: StatusCallback
): () => void {
  const wsSymbol = symbol.toLowerCase() + '@aggTrade'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function connect() {
    if (disposed) return
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(`[Binance aggTrade] Connected: ${symbol}`)
      onStatus(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.e === 'aggTrade') {
          const price = parseFloat(msg.p)
          const qty = parseFloat(msg.q)
          const trade: Trade = {
            id: ++tradeIdCounter,
            price,
            qty,
            side: msg.m ? 'sell' : 'buy', // m=true means buyer is maker = seller aggressor
            time: msg.T,
            notional: price * qty,
          }
          onTrade(trade)
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      console.log(`[Binance aggTrade] Disconnected: ${symbol}`)
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
