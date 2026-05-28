import type { Ticker24h, Instrument } from '../types/market'
import { registryAdd, registryRemove } from './connectionRegistry'

const CACHE = new Map<string, { data: Ticker24h; ts: number }>()
const CACHE_TTL = 5_000

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

// ─── Fetch all available USDT-M perpetual instruments ───
const INSTRUMENT_CACHE_KEY = '__futures_instruments_v2'
const INSTRUMENT_CACHE_TTL = 3600_000 // 1h

interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string
    pair: string
    contractType: string
    status: string
    baseAsset: string
    quoteAsset: string
    filters: Array<{
      filterType: string
      tickSize?: string
      stepSize?: string
    }>
  }>
}

// Category heuristics based on market cap tiers
const MAJOR_BASES = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP'])
const MEME_BASES = new Set(['DOGE', 'SHIB', 'PEPE', 'WIF', 'FLOKI', 'BONK', '1000SHIB', '1000PEPE', '1000BONK', '1000FLOKI'])
const DEFI_BASES = new Set(['LINK', 'UNI', 'AAVE', 'MKR', 'SNX', 'COMP', 'SUSHI', 'CRV', 'YFI', 'BAL', 'DYDX', 'INJ', 'RUNE', 'ARB', 'OP', 'GMX', 'PENDLE', 'JUP'])

function categorize(base: string): 'major' | 'alt' | 'defi' | 'meme' {
  if (MAJOR_BASES.has(base)) return 'major'
  if (MEME_BASES.has(base)) return 'meme'
  if (DEFI_BASES.has(base)) return 'defi'
  return 'alt'
}

export async function fetchFuturesInstruments(): Promise<Instrument[]> {
  // Check sessionStorage cache
  try {
    const cached = sessionStorage.getItem(INSTRUMENT_CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0 && Date.now() - parsed.ts < INSTRUMENT_CACHE_TTL) {
        return parsed.data
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const info: BinanceExchangeInfo = await res.json()

    const instruments: Instrument[] = info.symbols
      .filter(s =>
        s.contractType === 'PERPETUAL' &&
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING'
      )
      .map(s => {
        const tickFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER')
        const lotFilter = s.filters.find(f => f.filterType === 'LOT_SIZE')
        const tickSize = tickFilter ? parseFloat(tickFilter.tickSize!) : 0.01
        const stepSize = lotFilter ? parseFloat(lotFilter.stepSize!) : 0.001

        // Compute qty precision from stepSize
        const stepStr = stepSize.toString()
        const dotIdx = stepStr.indexOf('.')
        const qtyPrecision = dotIdx >= 0 ? stepStr.length - dotIdx - 1 : 0

        return {
          symbol: s.symbol,
          base: s.baseAsset,
          quote: 'USDT',
          category: categorize(s.baseAsset),
          tickSize,
          qtyPrecision,
        }
      })
      .sort((a, b) => {
        const catOrder = { major: 0, defi: 1, alt: 2, meme: 3 }
        const diff = catOrder[a.category] - catOrder[b.category]
        return diff !== 0 ? diff : a.symbol.localeCompare(b.symbol)
      })

    // Cache in sessionStorage
    try {
      sessionStorage.setItem(INSTRUMENT_CACHE_KEY, JSON.stringify({ data: instruments, ts: Date.now() }))
    } catch { /* ignore */ }

    return instruments
  } catch (err) {
    console.warn('[Instruments] Failed to fetch, using fallback:', err)
    return []
  }
}

// ─── WebSocket-based live price ticker ───
export type PriceCallback = (price: number, change: number, changePct: number) => void

// ─── Exponential backoff with jitter ───
const TICKER_BACKOFF_INITIAL = 1_000
const TICKER_BACKOFF_MAX = 60_000
const TICKER_BACKOFF_FACTOR = 1.5

function getTickerBackoffDelay(attempt: number): number {
  const base = Math.min(TICKER_BACKOFF_INITIAL * Math.pow(TICKER_BACKOFF_FACTOR, attempt), TICKER_BACKOFF_MAX)
  const jitter = base * 0.25 * (Math.random() * 2 - 1)
  return Math.max(500, base + jitter)
}

const STREAM_NAME = 'miniTicker'

export function connectMiniTicker(
  symbol: string,
  onPrice: PriceCallback
): () => void {
  const wsSymbol = symbol.toLowerCase() + '@miniTicker'
  const url = `wss://fstream.binance.com/ws/${wsSymbol}`
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let generation = 0
  let reconnectAttempt = 0

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
    console.log(`[MiniTicker] Connecting: ${url} (gen=${myGen}, attempt=${reconnectAttempt})`)
    registryAdd(STREAM_NAME, symbol, myGen, url)
    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      console.log(`[MiniTicker] Connected: ${symbol} (gen=${myGen})`)
      reconnectAttempt = 0
    }

    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.e === '24hrMiniTicker') {
          const price = parseFloat(msg.c)
          const open = parseFloat(msg.o)
          if (!isFinite(price) || !isFinite(open) || price <= 0 || open <= 0) return
          const change = price - open
          const changePct = (change / open) * 100
          onPrice(price, change, changePct)
        }
      } catch { /* ignore */ }
    }

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) {
        console.log(`[MiniTicker] Ignoring close from stale socket (gen=${myGen})`)
        return
      }
      console.log(`[MiniTicker] Disconnected: ${symbol} code=${ev.code} wasClean=${ev.wasClean} (gen=${myGen})`)
      ws = null
      if (!disposed) {
        const delay = getTickerBackoffDelay(reconnectAttempt++)
        console.log(`[MiniTicker] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          if (!disposed && generation === myGen) connect()
        }, delay)
      }
    }

    socket.onerror = () => {
      if (disposed || generation !== myGen) return
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
