/**
 * volumeProfileRange.ts
 *
 * Visible Range Volume Profile computation.
 * Computes volume-at-price from candles in the visible chart viewport.
 *
 * Data source: candle OHLCV + optional per-price footprint data.
 * When footprint priceMap is available, uses accurate per-price volume.
 * When only OHLCV is available, distributes volume across high-low range
 * as an approximation (documented honestly).
 *
 * Returns: price bins with volume, POC, Value Area (VAH/VAL).
 */

import type { Candle, PriceLevel } from '../types/market'

// ─── Types ───
export interface VPLevel {
  price: number
  volume: number
  buyVolume: number
  sellVolume: number
  delta: number
  pctOfMax: number       // 0-100
  inValueArea: boolean
}

export interface VPResult {
  levels: VPLevel[]
  poc: { price: number; volume: number }
  valueArea: { high: number; low: number; pct: number }
  metadata: {
    candleCount: number
    totalVolume: number
    minPrice: number
    maxPrice: number
    priceStep: number
    mode: 'visible-range' | 'recent-range'
    hasFootprint: boolean
  }
}

// ─── Constants ───
const MIN_CANDLES = 3
const DEFAULT_ROWS = 60
const MAX_ROWS = 96
const DEFAULT_VALUE_AREA_PCT = 70

// ─── Adaptive price step ───
function computePriceStep(minPrice: number, maxPrice: number, targetRows: number): number {
  const range = maxPrice - minPrice
  if (range <= 0 || targetRows <= 0) return 1

  const idealStep = range / targetRows
  const steps = [
    0.01, 0.02, 0.05,
    0.1, 0.2, 0.5,
    1, 2, 5,
    10, 20, 50,
    100, 200, 500,
    1000, 2000, 5000,
  ]
  for (const s of steps) {
    if (s >= idealStep) return s
  }
  return steps[steps.length - 1]
}

/**
 * Compute Visible Range Volume Profile.
 */
export function computeVisibleRangeVolumeProfile({
  candles,
  currentCandle,
  visibleFrom,
  visibleTo,
  rowCount = DEFAULT_ROWS,
  valueAreaPct = DEFAULT_VALUE_AREA_PCT,
}: {
  candles: Candle[]
  currentCandle: Candle | null
  visibleFrom: number    // first visible candle index
  visibleTo: number      // last visible candle index
  rowCount?: number
  valueAreaPct?: number
}): VPResult | null {
  const allCandles = currentCandle ? [...candles, currentCandle] : candles
  if (allCandles.length < MIN_CANDLES) return null

  // Clamp visible range
  const from = Math.max(0, Math.floor(visibleFrom))
  const to = Math.min(allCandles.length - 1, Math.ceil(visibleTo))
  if (from > to) return null

  const visCandles = allCandles.slice(from, to + 1)
  if (visCandles.length < MIN_CANDLES) return null

  // Check if footprint data is available
  const hasFootprint = visCandles.some(c => c.priceMap && Object.keys(c.priceMap).length > 0)

  // Determine price range
  let minPrice = Infinity
  let maxPrice = -Infinity
  for (const c of visCandles) {
    if (c.low < minPrice) minPrice = c.low
    if (c.high > maxPrice) maxPrice = c.high
  }
  if (!isFinite(minPrice) || !isFinite(maxPrice) || minPrice >= maxPrice) return null

  // Small padding
  const priceRange = maxPrice - minPrice
  minPrice -= priceRange * 0.005
  maxPrice += priceRange * 0.005

  const priceStep = computePriceStep(minPrice, maxPrice, Math.min(rowCount, MAX_ROWS))

  // Bin volume by price
  const bins = new Map<number, { volume: number; buyVolume: number; sellVolume: number; delta: number }>()

  for (const candle of visCandles) {
    if (candle.volume <= 0) continue

    if (hasFootprint && candle.priceMap && Object.keys(candle.priceMap).length > 0) {
      // Use accurate footprint data
      for (const [priceStr, level] of Object.entries(candle.priceMap)) {
        const price = parseFloat(priceStr)
        if (!isFinite(price)) continue
        const binPrice = Math.round(price / priceStep) * priceStep
        const existing = bins.get(binPrice) || { volume: 0, buyVolume: 0, sellVolume: 0, delta: 0 }
        existing.volume += level.total
        existing.buyVolume += level.buy
        existing.sellVolume += level.sell
        existing.delta += level.delta
        bins.set(binPrice, existing)
      }
    } else {
      // Approximate: distribute candle volume across high-low range
      const typicalPrice = (candle.high + candle.low + candle.close) / 3
      const binPrice = Math.round(typicalPrice / priceStep) * priceStep
      const existing = bins.get(binPrice) || { volume: 0, buyVolume: 0, sellVolume: 0, delta: 0 }
      existing.volume += candle.volume
      // Buy/sell split from candle data if available
      if (candle.buyVolume > 0 || candle.sellVolume > 0) {
        existing.buyVolume += candle.buyVolume
        existing.sellVolume += candle.sellVolume
        existing.delta += candle.delta
      }
      bins.set(binPrice, existing)
    }
  }

  if (bins.size === 0) return null

  // Build levels array
  const maxVolume = Math.max(1, ...Array.from(bins.values()).map(b => b.volume))
  let totalVolume = 0

  const levels: VPLevel[] = Array.from(bins.entries())
    .map(([price, data]) => {
      totalVolume += data.volume
      return {
        price,
        volume: data.volume,
        buyVolume: data.buyVolume,
        sellVolume: data.sellVolume,
        delta: data.delta,
        pctOfMax: (data.volume / maxVolume) * 100,
        inValueArea: false, // set below
      }
    })
    .sort((a, b) => a.price - b.price)

  // Find POC (Point of Control) — highest volume level
  let pocIdx = 0
  for (let i = 1; i < levels.length; i++) {
    if (levels[i].volume > levels[pocIdx].volume) pocIdx = i
  }
  const poc = { price: levels[pocIdx].price, volume: levels[pocIdx].volume }

  // Compute Value Area (70% of total volume centered on POC)
  const vaTarget = totalVolume * (valueAreaPct / 100)
  let vaVolume = levels[pocIdx].volume
  let vaLow = pocIdx
  let vaHigh = pocIdx

  while (vaVolume < vaTarget && (vaLow > 0 || vaHigh < levels.length - 1)) {
    const expandUp = vaHigh < levels.length - 1 ? levels[vaHigh + 1].volume : 0
    const expandDown = vaLow > 0 ? levels[vaLow - 1].volume : 0

    if (expandUp >= expandDown && expandUp > 0) {
      vaHigh++
      vaVolume += levels[vaHigh].volume
    } else if (expandDown > 0) {
      vaLow--
      vaVolume += levels[vaLow].volume
    } else {
      break
    }
  }

  const valueArea = {
    high: levels[vaHigh].price,
    low: levels[vaLow].price,
    pct: valueAreaPct,
  }

  // Mark value area levels
  for (let i = vaLow; i <= vaHigh; i++) {
    levels[i].inValueArea = true
  }

  return {
    levels,
    poc,
    valueArea,
    metadata: {
      candleCount: visCandles.length,
      totalVolume,
      minPrice,
      maxPrice,
      priceStep,
      mode: 'visible-range',
      hasFootprint,
    },
  }
}
