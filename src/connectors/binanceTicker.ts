import type { Ticker24h, Instrument } from '../types/market'

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
const INSTRUMENT_CACHE_KEY = '__futures_instruments'
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
      const { data, ts } = JSON.parse(cached)
      if (Date.now() - ts < INSTRUMENT_CACHE_TTL) return data
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
        // Sort: majors first, then by symbol
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
