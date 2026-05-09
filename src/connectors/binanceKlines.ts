/**
 * binanceKlines.ts
 *
 * Fetches historical candles from Binance USDT-M Futures REST API.
 * Converts them into the app's Candle shape.
 *
 * Klines do not provide bid/ask volume split, so:
 * - buyVolume = 0
 * - sellVolume = 0
 * - delta = 0
 * - priceMap = {}
 * - bubbles = []
 *
 * These are filled in later as live trades arrive.
 */

import type { Candle } from '../types/market'
import { INTERVAL_MS } from '../types/market'

const FAPI_BASE = 'https://fapi.binance.com'

/**
 * Fetch historical klines from Binance USDT-M Futures.
 * Returns candles sorted ascending by time.
 *
 * @param symbol  e.g. "BTCUSDT"
 * @param interval  app Interval key (e.g. "40s", "1m", "5m")
 * @param limit   max number of candles (Binance allows up to 1500)
 */
export async function fetchHistoricalKlines(
  symbol: string,
  interval: string,
  limit = 1000,
): Promise<Candle[]> {
  // Map app interval to Binance kline interval
  const klineInterval = mapToKlineInterval(interval)
  const url = `${FAPI_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${klineInterval}&limit=${limit}`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[Klines] HTTP ${res.status} for ${symbol}`)
      return []
    }

    const raw: unknown[][] = await res.json()
    if (!Array.isArray(raw) || raw.length === 0) return []

    const candles: Candle[] = raw.map(parseKline).filter(Boolean) as Candle[]

    // Deduplicate by openTime (safety)
    const seen = new Set<number>()
    const deduped: Candle[] = []
    for (const c of candles) {
      if (!seen.has(c.openTime)) {
        seen.add(c.openTime)
        deduped.push(c)
      }
    }

    return deduped
  } catch (err) {
    console.warn(`[Klines] Failed to fetch for ${symbol}:`, err)
    return []
  }
}

/**
 * Parse a single Binance kline array into our Candle shape.
 *
 * Binance kline format:
 * [0] openTime, [1] open, [2] high, [3] low, [4] close, [5] volume,
 * [6] closeTime, [7] quoteVolume, [8] trades, [9] takerBuyBaseVol,
 * [10] takerBuyQuoteVol, [11] ignore
 */
function parseKline(k: unknown[]): Candle | null {
  try {
    const openTime = Number(k[0])
    const open = parseFloat(k[1] as string)
    const high = parseFloat(k[2] as string)
    const low = parseFloat(k[3] as string)
    const close = parseFloat(k[4] as string)
    const volume = parseFloat(k[5] as string)
    const closeTime = Number(k[6])
    const trades = Number(k[8])

    if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) return null
    if (openTime <= 0 || volume < 0) return null

    return {
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume,
      buyVolume: 0,   // klines don't provide bid/ask split
      sellVolume: 0,
      delta: 0,
      tradeCount: trades,
      maxTradeSize: 0,
      largeTradeCount: 0,
      bubbleCount: 0,
      priceMap: {},
      bubbles: [],
    }
  } catch {
    return null
  }
}

/**
 * Map app interval to Binance kline interval string.
 * App uses custom intervals like "10s", "20s", "40s" which don't exist as kline intervals.
 * We use the closest available Binance interval.
 */
function mapToKlineInterval(interval: string): string {
  switch (interval) {
    case '10s':
    case '20s':
    case '40s':
      return '1m'  // smallest Binance kline is 1m; sub-minute intervals accumulate from trades
    case '1m':
      return '1m'
    case '3m':
      return '3m'
    case '5m':
      return '5m'
    default:
      return '1m'
  }
}

/**
 * Get the interval duration in ms for bucketing.
 * Re-exported from market types for convenience.
 */
export function getIntervalMs(interval: string): number {
  return (INTERVAL_MS as Record<string, number>)[interval] ?? 60_000
}
