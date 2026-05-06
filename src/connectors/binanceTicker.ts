import type { Ticker24h } from '../types/market'

const CACHE = new Map<string, { data: Ticker24h; ts: number }>()
const CACHE_TTL = 5_000 // 5s cache

export async function fetchTicker24h(symbol: string): Promise<Ticker24h | null> {
  const cached = CACHE.get(symbol)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  try {
    const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()

    const ticker: Ticker24h = {
      price: parseFloat(d.lastPrice),
      change: parseFloat(d.priceChange),
      changePct: parseFloat(d.priceChangePercent),
      high: parseFloat(d.highPrice),
      low: parseFloat(d.lowPrice),
      volume: parseFloat(d.volume),
      quoteVolume: parseFloat(d.quoteVolume),
      trades: parseInt(d.count),
    }

    CACHE.set(symbol, { data: ticker, ts: Date.now() })
    return ticker
  } catch (err) {
    console.warn(`[Ticker24h] Failed for ${symbol}:`, err)
    return null
  }
}

// WebSocket-based live price ticker (lightweight)
export type PriceCallback = (price: number, change: number, changePct: number) => void

export function connectMiniTicker(
  symbol: string,
  onPrice: PriceCallback
): () => void {
  const wsSymbol = symbol.toLowerCase() + '@miniTicker'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function connect() {
    if (disposed) return
    ws = new WebSocket(url)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.e === '24hrMiniTicker') {
          const price = parseFloat(msg.c)
          const open = parseFloat(msg.o)
          const change = price - open
          const changePct = open > 0 ? (change / open) * 100 : 0
          onPrice(price, change, changePct)
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      if (!disposed) reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws?.close()
  }

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
  }
}
