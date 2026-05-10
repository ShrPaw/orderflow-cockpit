/**
 * lightweightCoordinateAdapter.ts
 *
 * Maps between Lightweight Charts coordinate space and overlay canvas pixels.
 *
 * Lightweight Charts APIs used:
 *   chart.timeScale().timeToCoordinate(timeSec) → x | null
 *   candleSeries.priceToCoordinate(price) → y | null
 *
 * Returns null for off-screen or invalid coordinates — callers must skip.
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { PixelCoord } from '../types/executionChart'

/**
 * Convert a millisecond timestamp + price to pixel coordinates.
 * Returns null if either coordinate is off-screen or invalid.
 */
export function timePriceToPixel(
  timestampMs: number,
  price: number,
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>
): PixelCoord | null {
  const timeSec = Math.floor(timestampMs / 1000) as UTCTimestamp
  const x = chart.timeScale().timeToCoordinate(timeSec)
  const y = candleSeries.priceToCoordinate(price)

  if (x === null || y === null) return null
  if (!isFinite(x) || !isFinite(y)) return null

  return { x, y }
}

/**
 * Convert just a price to a y-coordinate.
 * Returns null if off-screen.
 */
export function priceToY(
  price: number,
  candleSeries: ISeriesApi<'Candlestick'>
): number | null {
  const y = candleSeries.priceToCoordinate(price)
  if (y === null || !isFinite(y)) return null
  return y
}

/**
 * Get the visible logical range from the time scale.
 * Returns { from, to } in logical index space, or null.
 */
export function getVisibleLogicalRange(
  chart: IChartApi
): { from: number; to: number } | null {
  const range = chart.timeScale().getVisibleLogicalRange()
  if (!range) return null
  return { from: range.from as number, to: range.to as number }
}

/**
 * Get the number of visible candles from the logical range.
 */
export function getVisibleCandleCount(chart: IChartApi): number {
  const range = getVisibleLogicalRange(chart)
  if (!range) return 100
  return Math.abs(range.to - range.from)
}

/**
 * Estimate the candle slot width in pixels.
 * Uses timeToCoordinate on two adjacent seconds to measure pixel density.
 */
export function estimateCandleSlotWidth(chart: IChartApi): number {
  const now = Math.floor(Date.now() / 1000)
  const x1 = chart.timeScale().timeToCoordinate(now as UTCTimestamp)
  const x2 = chart.timeScale().timeToCoordinate((now + 1) as UTCTimestamp)
  if (x1 === null || x2 === null) return 8
  const pxPerSec = Math.abs(x2 - x1)
  // Typical candle intervals: 10s to 300s
  // This gives a rough candle width estimate
  return Math.max(2, pxPerSec * 40) // ~40s default interval
}

/**
 * Get chart plot area dimensions (excluding price scale and time axis).
 * Lightweight Charts manages its own layout, so the overlay canvas
 * matches the full container — we just need to know the container size.
 */
export function getChartDimensions(
  container: HTMLElement
): { width: number; height: number } {
  const rect = container.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
}
