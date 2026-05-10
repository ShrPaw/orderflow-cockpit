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
  let generation = 0

  tradeDiag = { url, symbol, opened: false, messageCount: 0, lastMessageTime: 0, parseErrors: 0, closeCount: 0, lastError: null }

  function cancelReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function closeSocket() {
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try { ws.close() } catch { /* ignore */ }
      ws = null
    }
  }

  function connect() {
    if (disposed) return
    cancelReconnectTimer()
    closeSocket()

    const myGen = ++generation
    console.log(`[Binance trade] Connecting: ${url} (gen=${myGen})`)
    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      console.log(`[Binance trade] Connected: ${symbol} (gen=${myGen})`)
      tradeDiag.opened = true
      tradeDiag.lastError = null
      onStatus(true)
    }

    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
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

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) {
        console.log(`[Binance trade] Ignoring close from stale socket (gen=${myGen})`)
        return
      }
      console.log(`[Binance trade] Disconnected: ${symbol} code=${ev.code} (gen=${myGen})`)
      tradeDiag.opened = false
      tradeDiag.closeCount++
      ws = null
      onStatus(false)
      if (!disposed) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          if (!disposed && generation === myGen) connect()
        }, 3000)
      }
    }

    socket.onerror = (ev) => {
      if (disposed || generation !== myGen) return
      tradeDiag.lastError = 'WebSocket error'
      console.error('[Binance trade] Error:', ev)
      // onerror is always followed by onclose — let onclose handle reconnect
      socket.close()
    }
  }

  connect()

  return () => {
    disposed = true
    generation++ // invalidate pending events
    cancelReconnectTimer()
    closeSocket()
  }
}
