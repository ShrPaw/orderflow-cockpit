import type { Trade } from '../types/market'

export type AggTradeCallback = (trade: Trade) => void
export type StatusCallback = (connected: boolean) => void

let tradeIdCounter = 0

// ─── Diagnostics ───
export interface TradeDiagnostics {
  url: string
  symbol: string
  opened: boolean
  messageCount: number
  lastMessageTime: number
  parseErrors: number
  closeCount: number
  lastError: string | null
}

let tradeDiag: TradeDiagnostics = {
  url: '', symbol: '', opened: false, messageCount: 0,
  lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null,
}

export function getTradeDiagnostics(): TradeDiagnostics {
  return { ...tradeDiag }
}

export function connectBinanceAggTrade(
  symbol: string,
  onTrade: AggTradeCallback,
  onStatus: StatusCallback
): () => void {
  // Binance Futures @aggTrade stream is dead — use @trade instead
  const wsSymbol = symbol.toLowerCase() + '@trade'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  tradeDiag = { url, symbol, opened: false, messageCount: 0, lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null }

  function connect() {
    if (disposed) return
    console.log(`[Binance trade] Connecting: ${url}`)
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log(`[Binance trade] Connected: ${symbol}`)
      tradeDiag.opened = true
      tradeDiag.lastError = null
      onStatus(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        // @trade stream uses e="trade", @aggTrade uses e="aggTrade"
        // Accept both for resilience
        if (msg.e === 'trade' || msg.e === 'aggTrade') {
          const price = parseFloat(msg.p)
          const qty = parseFloat(msg.q)
          if (isNaN(price) || isNaN(qty) || price <= 0 || qty <= 0) return

          const trade: Trade = {
            id: msg.t ?? ++tradeIdCounter,
            price,
            qty,
            side: msg.m ? 'sell' : 'buy', // m=true means buyer is maker = seller aggressor
            time: msg.T,
            notional: price * qty,
          }
          tradeDiag.messageCount++
          tradeDiag.lastMessageTime = Date.now()
          onTrade(trade)
        }
      } catch (err) {
        tradeDiag.parseErrors++
        console.warn('[Binance trade] Parse error:', err)
      }
    }

    ws.onclose = (ev) => {
      console.log(`[Binance trade] Disconnected: ${symbol} code=${ev.code}`)
      tradeDiag.opened = false
      tradeDiag.closeCount++
      onStatus(false)
      if (!disposed) reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = (ev) => {
      tradeDiag.lastError = 'WebSocket error'
      console.error('[Binance trade] Error:', ev)
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
