import type { Trade } from '../types/market'
import { registryAdd, registryRemove } from './connectionRegistry'

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

// ─── Exponential backoff with jitter ───
const BACKOFF_INITIAL = 1_000
const BACKOFF_MAX = 60_000
const BACKOFF_FACTOR = 1.5

function getBackoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_INITIAL * Math.pow(BACKOFF_FACTOR, attempt), BACKOFF_MAX)
  const jitter = base * 0.25 * (Math.random() * 2 - 1)
  return Math.max(500, base + jitter)
}

const STREAM_NAME = 'trade'

export function connectBinanceAggTrade(
  symbol: string,
  onTrade: AggTradeCallback,
  onStatus: StatusCallback
): () => void {
  const wsSymbol = symbol.toLowerCase() + '@trade'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let generation = 0
  let reconnectAttempt = 0

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
    registryAdd(STREAM_NAME, symbol, myGen, url)
    console.log(`[Binance trade] Connecting: ${url} (gen=${myGen}, attempt=${reconnectAttempt})`)
    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      console.log(`[Binance trade] Connected: ${symbol} (gen=${myGen})`)
      tradeDiag.opened = true
      tradeDiag.lastError = null
      reconnectAttempt = 0
      onStatus(true)
    }

    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.e === 'trade' || msg.e === 'aggTrade') {
          const price = parseFloat(msg.p)
          const qty = parseFloat(msg.q)
          if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty <= 0) return

          const time = Number(msg.T)
          if (!isFinite(time) || time <= 0) return

          const trade: Trade = {
            id: msg.t ?? ++tradeIdCounter,
            price,
            qty,
            side: msg.m ? 'sell' : 'buy',
            time,
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
      console.log(`[Binance trade] Disconnected: ${symbol} code=${ev.code} wasClean=${ev.wasClean} (gen=${myGen})`)
      tradeDiag.opened = false
      tradeDiag.closeCount++
      ws = null
      onStatus(false)
      if (!disposed) {
        const delay = getBackoffDelay(reconnectAttempt++)
        console.log(`[Binance trade] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          if (!disposed && generation === myGen) connect()
        }, delay)
      }
    }

    socket.onerror = (ev) => {
      if (disposed || generation !== myGen) return
      tradeDiag.lastError = 'WebSocket error'
      console.error('[Binance trade] Error:', ev)
      socket.close()
    }
  }

  connect()

  return () => {
    disposed = true
    registryRemove(STREAM_NAME, symbol, generation)
    generation++
    cancelReconnectTimer()
    closeSocket()
  }
}
