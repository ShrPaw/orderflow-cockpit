/**
 * vwap.ts
 *
 * Volume-Weighted Average Price computation from candle data.
 * Uses cumulative typical price × volume / cumulative volume.
 *
 * typicalPrice = (high + low + close) / 3
 * vwap = Σ(typicalPrice * volume) / Σ(volume)
 *
 * Session VWAP resets at UTC day boundary.
 * Only renders when sufficient volume data exists.
 */

import type { Candle } from '../types/market'

export interface VWAPPoint {
  time: number   // candle openTime
  price: number  // VWAP value at this candle
}

const MIN_CANDLES = 5
const MIN_VOLUME = 0

/**
 * Compute session VWAP from candles.
 * Resets at UTC day boundaries.
 * Returns array of VWAP points aligned with candle times.
 */
export function computeSessionVWAP(candles: Candle[]): VWAPPoint[] {
  if (candles.length < MIN_CANDLES) return []

  const result: VWAPPoint[] = []
  let cumTPV = 0   // cumulative (typical price × volume)
  let cumVol = 0    // cumulative volume
  let currentDay = -1

  for (const candle of candles) {
    // Reset on UTC day boundary
    const day = Math.floor(candle.openTime / 86_400_000)
    if (day !== currentDay) {
      cumTPV = 0
      cumVol = 0
      currentDay = day
    }

    if (candle.volume <= 0) continue

    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumTPV += typicalPrice * candle.volume
    cumVol += candle.volume

    if (cumVol > MIN_VOLUME) {
      result.push({
        time: candle.openTime,
        price: cumTPV / cumVol,
      })
    }
  }

  return result
}

/**
 * Compute a single current VWAP value from all candles.
 * Returns null if insufficient data.
 */
export function computeCurrentVWAP(candles: Candle[], currentCandle: Candle | null): number | null {
  const all = currentCandle ? [...candles, currentCandle] : candles
  if (all.length < MIN_CANDLES) return null

  let cumTPV = 0
  let cumVol = 0

  // Use current UTC day's candles only
  const today = Math.floor(Date.now() / 86_400_000)

  for (const candle of all) {
    const day = Math.floor(candle.openTime / 86_400_000)
    if (day !== today) continue
    if (candle.volume <= 0) continue

    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    cumTPV += typicalPrice * candle.volume
    cumVol += candle.volume
  }

  return cumVol > MIN_VOLUME ? cumTPV / cumVol : null
}
