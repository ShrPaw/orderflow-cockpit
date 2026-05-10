/**
 * lightweightChartAdapters.ts
 *
 * Converts the app's Candle[] into Lightweight Charts format.
 * - Does NOT mutate original store objects.
 * - Validates timestamps (ms → seconds).
 * - Sorts ascending by time.
 * - Drops invalid candles.
 * - Deduplicates by timestamp (last-write-wins).
 */

import type { Candle } from '../types/market'
import type { UTCTimestamp } from 'lightweight-charts'

export interface LWCandle {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
}

export interface LWVolumeBar {
  time: UTCTimestamp
  value: number
  color: string
}

const VOL_UP = 'rgba(45,212,160,0.25)'
const VOL_DOWN = 'rgba(239,100,97,0.25)'

/**
 * Convert app Candle[] to Lightweight Charts candlestick data.
 * Returns a sorted, deduplicated, validated array.
 */
export function adaptCandles(candles: Candle[]): LWCandle[] {
  if (!candles || candles.length === 0) return []

  const map = new Map<number, LWCandle>()

  for (const c of candles) {
    if (!isValidCandle(c)) continue

    // Lightweight Charts expects seconds, not milliseconds
    const timeSec = Math.floor(c.openTime / 1000) as UTCTimestamp

    map.set(timeSec, {
      time: timeSec,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })
  }

  // Sort ascending by time
  return Array.from(map.values()).sort((a, b) => (a.time as number) - (b.time as number))
}

/**
 * Convert app Candle[] to Lightweight Charts volume histogram data.
 */
export function adaptVolumes(candles: Candle[]): LWVolumeBar[] {
  if (!candles || candles.length === 0) return []

  const map = new Map<number, LWVolumeBar>()

  for (const c of candles) {
    if (!isValidCandle(c) || c.volume <= 0) continue

    const timeSec = Math.floor(c.openTime / 1000) as UTCTimestamp
    const isUp = c.close >= c.open

    map.set(timeSec, {
      time: timeSec,
      value: c.volume,
      color: isUp ? VOL_UP : VOL_DOWN,
    })
  }

  return Array.from(map.values()).sort((a, b) => (a.time as number) - (b.time as number))
}

/**
 * Convert a single live Candle into LWCandle for series.update().
 * Returns null if the candle is invalid.
 */
export function adaptSingleCandle(candle: Candle): LWCandle | null {
  if (!isValidCandle(candle)) return null
  const timeSec = Math.floor(candle.openTime / 1000) as UTCTimestamp
  return {
    time: timeSec,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }
}

/**
 * Convert a single live Candle into a volume bar for series.update().
 * Returns null if volume is zero or candle is invalid.
 */
export function adaptSingleVolume(candle: Candle): LWVolumeBar | null {
  if (!isValidCandle(candle) || candle.volume <= 0) return null
  const timeSec = Math.floor(candle.openTime / 1000) as UTCTimestamp
  const isUp = candle.close >= candle.open
  return {
    time: timeSec,
    value: candle.volume,
    color: isUp ? VOL_UP : VOL_DOWN,
  }
}

function isValidCandle(c: Candle): boolean {
  return (
    typeof c.openTime === 'number' && c.openTime > 0 &&
    typeof c.open === 'number' && isFinite(c.open) &&
    typeof c.high === 'number' && isFinite(c.high) &&
    typeof c.low === 'number' && isFinite(c.low) &&
    typeof c.close === 'number' && isFinite(c.close) &&
    c.high >= c.low
  )
}
