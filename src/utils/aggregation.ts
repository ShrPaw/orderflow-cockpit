import type { Candle, Trade, PriceLevel, Bubble, BubbleState } from '../types/market'
import { priceBin } from './formatters'
import { getLevelAtPrice, checkLevelInteraction, getAllLevels } from './levelMemory'

let bubbleCounter = 0

export function resetBubbleCounter() { bubbleCounter = 0 }

export function newCandle(openTime: number, price: number, intervalMs: number = 60_000): Candle {
  return {
    openTime,
    closeTime: openTime + intervalMs,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    tradeCount: 0,
    maxTradeSize: 0,
    largeTradeCount: 0,
    bubbleCount: 0,
    priceMap: {},
    bubbles: [],
  }
}

/**
 * Canonicalize a binned price to a string key, avoiding floating-point drift.
 * Floating-point multiplication (Math.round(p/bin)*bin) can produce
 * 67890.00000000001 or 67889.99999999999 for prices near bin boundaries.
 * Using toFixed(8) and parseFloat produces a canonical number, and
 * toKey() produces a canonical string for use as object keys.
 */
function binPrice(price: number): number {
  const bin = priceBin(price)
  const raw = Math.round(price / bin) * bin
  return parseFloat(raw.toFixed(8))
}

function toKey(price: number): string {
  return binPrice(price).toString()
}

export function processTradeIntoCandle(candle: Candle, trade: Trade): Candle {
  const { price, qty, side, notional } = trade

  const updated = { ...candle }
  updated.high = Math.max(updated.high, price)
  updated.low = Math.min(updated.low, price)
  updated.close = price
  updated.volume += qty
  updated.tradeCount++
  updated.maxTradeSize = Math.max(updated.maxTradeSize, qty)

  if (side === 'buy') {
    updated.buyVolume += qty
    updated.delta += qty
  } else {
    updated.sellVolume += qty
    updated.delta -= qty
  }

  if (notional > 10000) updated.largeTradeCount++

  // Footprint price level — use canonical string keys to avoid float drift
  const rounded = binPrice(price)
  const key = toKey(price)
  const levels = { ...updated.priceMap }
  const existing = levels[key] || { buy: 0, sell: 0, total: 0, delta: 0, maxPrint: 0, trades: 0 }
  const level: PriceLevel = { ...existing }
  if (side === 'buy') {
    level.buy += qty
    level.delta += qty
  } else {
    level.sell += qty
    level.delta -= qty
  }
  level.total += qty
  level.trades++
  level.maxPrint = Math.max(level.maxPrint, qty)
  // Store with canonical string key only
  levels[key] = level
  updated.priceMap = levels

  // Bubble detection
  const threshold = bubbleThreshold(price)
  if (notional > threshold) {
    const bubble: Bubble = {
      id: `b-${++bubbleCounter}-${trade.time}`,
      timestamp: trade.time,
      candleTime: candle.openTime,
      price,
      side,
      volume: qty,
      notional,
      state: 'PENDING',
      confidence: 0.5,
      responseAt3s: null,
      responseAt10s: null,
    }
    updated.bubbles = [...updated.bubbles, bubble]
    updated.bubbleCount++
  }

  return updated
}

function bubbleThreshold(price: number): number {
  if (price > 10000) return 5000
  if (price > 1000) return 3000
  if (price > 100) return 2000
  return 500
}

export function classifyBubble(bubble: Bubble, currentPrice: number, candleHigh: number, candleLow: number): Bubble {
  const now = Date.now()
  const age = now - bubble.timestamp

  if (bubble.state === 'ACCEPTED' && age >= 15_000) {
    const returnDist = Math.abs(currentPrice - bubble.price) / bubble.price
    if (returnDist < 0.002) {
      const updated: Bubble = {
        ...bubble,
        state: 'INVALIDATED' as BubbleState,
        invalidated: true,
        invalidatedAt: now,
        invalidationReason: 'Price returned to event level after acceptance',
      }
      const levels = getAllLevels()
      const interaction = checkLevelInteraction(updated, levels, currentPrice)
      if (interaction) updated.levelInteraction = interaction
      return updated
    }
  }

  if (bubble.state !== 'PENDING') {
    const updated = { ...bubble }
    const levels = getAllLevels()
    const interaction = checkLevelInteraction(updated, levels, currentPrice)
    if (interaction && !updated.levelInteraction) {
      updated.levelInteraction = interaction
    }
    return updated
  }

  const priceChange = currentPrice - bubble.price
  const priceChangePct = bubble.price > 0 ? priceChange / bubble.price : 0
  const expectedDir = bubble.side === 'buy' ? 1 : -1
  const aligned = priceChangePct * expectedDir

  const updated = { ...bubble }

  if (age >= 3000 && !updated.responseAt3s) {
    updated.responseAt3s = {
      price: currentPrice,
      change: priceChange,
      changePct: priceChangePct,
      aligned: aligned > 0,
      magnitude: Math.abs(priceChangePct),
    }
  }

  if (age >= 10000 && !updated.responseAt10s) {
    updated.responseAt10s = {
      price: currentPrice,
      change: priceChange,
      changePct: priceChangePct,
      aligned: aligned > 0,
      magnitude: Math.abs(priceChangePct),
    }
  }

  const range = candleHigh - candleLow
  const mid = (candleHigh + candleLow) / 2
  const rangeRatio = mid > 0 ? range / mid : 0

  if (age >= 3000) {
    if (!aligned && Math.abs(priceChangePct) < 0.001 && bubble.notional > 20000) {
      updated.state = 'ABSORBED'
      updated.confidence = 0.8
    } else if (rangeRatio < 0.002 && bubble.notional > 15000) {
      updated.state = 'ABSORBED'
      updated.confidence = 0.7
    } else if (!aligned && Math.abs(priceChangePct) > 0.002) {
      updated.state = 'REJECTED'
      updated.confidence = 0.85
    } else if (aligned > 0 && Math.abs(priceChangePct) > 0.001) {
      updated.state = 'ACCEPTED'
      updated.confidence = 0.9
    }
  }

  if (age >= 10000 && updated.state === 'PENDING') {
    if (!aligned && Math.abs(priceChangePct) > 0.003) {
      updated.state = 'REJECTED'
      updated.confidence = 0.75
    } else if (aligned > 0 && Math.abs(priceChangePct) > 0.001) {
      updated.state = 'ACCEPTED'
      updated.confidence = 0.8
    } else if (Math.abs(priceChangePct) < 0.001) {
      updated.state = 'EXHAUSTED'
      updated.confidence = 0.6
    }
  }

  if (age >= 40000 && updated.state === 'PENDING') {
    updated.state = 'EXHAUSTED'
    updated.confidence = 0.4
  }

  const levels = getAllLevels()
  const interaction = checkLevelInteraction(updated, levels, currentPrice)
  if (interaction) updated.levelInteraction = interaction

  if (updated.state === 'REJECTED' || updated.state === 'ABSORBED') {
    const tolerance = currentPrice > 0 ? currentPrice * 0.002 : 0.02
    for (const level of levels) {
      if (level.touches < 3) continue
      if (Math.abs(level.price - updated.price) > tolerance) continue
      if (level.rejectedCount >= 3 && level.rejectedCount > level.acceptedCount) {
        updated.state = 'RESISTANCE' as BubbleState
        updated.resistanceOrigin = updated.side
        updated.confidence = Math.min(0.95, updated.confidence + 0.1)
        break
      }
    }
  }

  return updated
}

export function computeVolumeProfile(candles: Candle[]): Array<{ price: number; buy: number; sell: number; total: number; delta: number }> {
  const map = new Map<string, { price: number; buy: number; sell: number; total: number; delta: number }>()

  for (const candle of candles) {
    for (const [priceStr, level] of Object.entries(candle.priceMap)) {
      const price = parseFloat(priceStr)
      if (!isFinite(price)) continue
      const binned = binPrice(price)
      const key = binned.toString()
      const existing = map.get(key) || { price: binned, buy: 0, sell: 0, total: 0, delta: 0 }
      existing.buy += level.buy
      existing.sell += level.sell
      existing.total += level.total
      existing.delta += level.delta
      map.set(key, existing)
    }
  }

  const result: Array<{ price: number; buy: number; sell: number; total: number; delta: number }> = []
  for (const data of map.values()) {
    result.push(data)
  }
  result.sort((a, b) => a.price - b.price)
  return result
}
