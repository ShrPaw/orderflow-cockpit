/**
 * levelMemory.ts
 *
 * Track price levels from bubble events, round prices, and orderbook liquidity.
 * A level becomes meaningful only after 2+ interactions.
 *
 * This is observational — it records WHERE the market reacted,
 * not WHETHER it will react again.
 */

import type { Bubble, LevelInteraction, OrderLevel } from '../types/market'

// ─── Level Record ───

export interface LevelRecord {
  price: number
  type: 'ROUND' | 'LIQUIDITY_BID' | 'LIQUIDITY_ASK' | 'BUBBLE_CLUSTER'
  touches: number
  rejectedCount: number
  acceptedCount: number
  absorbedCount: number
  lastTouchedAt: number
  lastState: 'TOUCHED' | 'REJECTED_LEVEL' | 'ACCEPTED_LEVEL' | 'ABSORBED_LEVEL' | 'FLIPPED_SUPPORT' | 'FLIPPED_RESISTANCE'
  flippedSupport: boolean
  flippedResistance: boolean
}

// ─── Age phases for level fading ───
const LEVEL_FRESH_MS = 60_000       // 1 min
const LEVEL_ACTIVE_MS = 600_000     // 10 min
const LEVEL_FADE_MS = 1_800_000     // 30 min
const LEVEL_EXPIRE_MS = 3_600_000   // 1 hour

// ─── In-memory level store ───
let levelStore: LevelRecord[] = []

/**
 * Quantize a price to a bin for clustering nearby events.
 */
function priceBin(price: number, binSize?: number): number {
  if (!binSize) {
    if (price > 50000) binSize = 50
    else if (price > 10000) binSize = 25
    else if (price > 1000) binSize = 10
    else if (price > 100) binSize = 5
    else if (price > 10) binSize = 1
    else binSize = 0.5
  }
  return Math.round(price / binSize) * binSize
}

/**
 * Find or create a level at a given price.
 */
function findOrCreateLevel(
  price: number,
  type: LevelRecord['type'],
  tolerance: number
): LevelRecord {
  const existing = levelStore.find(
    l => l.type === type && Math.abs(l.price - price) < tolerance
  )
  if (existing) return existing

  const level: LevelRecord = {
    price,
    type,
    touches: 0,
    rejectedCount: 0,
    acceptedCount: 0,
    absorbedCount: 0,
    lastTouchedAt: 0,
    lastState: 'TOUCHED',
    flippedSupport: false,
    flippedResistance: false,
  }
  levelStore.push(level)
  return level
}

/**
 * Remove expired levels.
 */
function pruneExpiredLevels(now: number): void {
  levelStore = levelStore.filter(l => (now - l.lastTouchedAt) < LEVEL_EXPIRE_MS)
}

/**
 * Update levels from bubble events, orderbook data, and round prices.
 */
export function updateLevelsFromBubbles(
  bubbles: Bubble[],
  bids: OrderLevel[],
  asks: OrderLevel[],
  livePrice: number
): LevelRecord[] {
  const now = Date.now()
  pruneExpiredLevels(now)

  const tolerance = livePrice > 0 ? livePrice * 0.001 : 0.01

  // 1. Bubble event prices → BUBBLE_CLUSTER levels
  for (const bubble of bubbles) {
    if (!bubble.price || bubble.price <= 0) continue
    const binned = priceBin(bubble.price)
    const level = findOrCreateLevel(binned, 'BUBBLE_CLUSTER', tolerance)
    level.touches++
    level.lastTouchedAt = Math.max(level.lastTouchedAt, bubble.timestamp)

    if (bubble.state === 'REJECTED') level.rejectedCount++
    else if (bubble.state === 'ACCEPTED') level.acceptedCount++
    else if (bubble.state === 'ABSORBED') level.absorbedCount++

    if (level.touches >= 2) {
      if (level.rejectedCount > level.acceptedCount) {
        level.lastState = 'REJECTED_LEVEL'
      } else if (level.acceptedCount > level.rejectedCount) {
        level.lastState = 'ACCEPTED_LEVEL'
      } else if (level.absorbedCount >= 2) {
        level.lastState = 'ABSORBED_LEVEL'
      }
    }
  }

  // 2. Round prices near live price → ROUND levels
  if (livePrice > 0) {
    const roundLevels = getRoundPrices(livePrice)
    for (const rp of roundLevels) {
      const level = findOrCreateLevel(rp, 'ROUND', tolerance)
      if (level.touches === 0) {
        level.touches = 1
        level.lastTouchedAt = now
      }
    }
  }

  // 3. Orderbook liquidity → LIQUIDITY_BID / LIQUIDITY_ASK levels
  const topBids = bids.sort((a, b) => b.qty - a.qty).slice(0, 5)
  const topAsks = asks.sort((a, b) => b.qty - a.qty).slice(0, 5)

  for (const bid of topBids) {
    const binned = priceBin(bid.price)
    const level = findOrCreateLevel(binned, 'LIQUIDITY_BID', tolerance)
    if (level.touches === 0) {
      level.touches = 1
      level.lastTouchedAt = now
    }
  }

  for (const ask of topAsks) {
    const binned = priceBin(ask.price)
    const level = findOrCreateLevel(binned, 'LIQUIDITY_ASK', tolerance)
    if (level.touches === 0) {
      level.touches = 1
      level.lastTouchedAt = now
    }
  }

  return levelStore
}

/**
 * Get round prices near a given price.
 */
function getRoundPrices(price: number): number[] {
  let step: number
  if (price > 50000) step = 1000
  else if (price > 10000) step = 500
  else if (price > 1000) step = 100
  else if (price > 100) step = 50
  else if (price > 10) step = 5
  else step = 1

  const center = Math.round(price / step) * step
  const levels: number[] = []
  for (let i = -3; i <= 3; i++) {
    const level = center + i * step
    if (level > 0) levels.push(level)
  }
  return levels
}

/**
 * Find a level near a given price within tolerance.
 */
export function getLevelAtPrice(price: number, tolerance: number): LevelRecord | null {
  const now = Date.now()
  // Only return meaningful levels (2+ touches) that haven't expired
  const candidates = levelStore.filter(
    l => Math.abs(l.price - price) < tolerance
      && l.touches >= 2
      && (now - l.lastTouchedAt) < LEVEL_EXPIRE_MS
  )
  if (candidates.length === 0) return null
  // Return the most-touched level
  return candidates.sort((a, b) => b.touches - a.touches)[0]
}

/**
 * Check if a bubble interacts with a tracked level.
 * Conservative — only reports interaction when level is meaningful (2+ touches).
 */
export function checkLevelInteraction(
  bubble: Bubble,
  levels: LevelRecord[],
  livePrice: number
): LevelInteraction | null {
  if (!bubble.price || bubble.price <= 0) return null

  const tolerance = livePrice > 0 ? livePrice * 0.0015 : 0.02

  for (const level of levels) {
    if (level.touches < 2) continue
    if (Math.abs(level.price - bubble.price) > tolerance) continue

    const now = Date.now()
    if ((now - level.lastTouchedAt) > LEVEL_EXPIRE_MS) continue

    // Determine level state based on bubble and level history
    let levelState: LevelInteraction['levelState'] = 'TOUCHED'

    if (level.flippedSupport) {
      levelState = 'FLIPPED_SUPPORT'
    } else if (level.flippedResistance) {
      levelState = 'FLIPPED_RESISTANCE'
    } else if (level.rejectedCount >= 2 && level.rejectedCount > level.acceptedCount) {
      levelState = 'REJECTED_LEVEL'
    } else if (level.acceptedCount >= 2 && level.acceptedCount > level.rejectedCount) {
      levelState = 'ACCEPTED_LEVEL'
    } else if (level.absorbedCount >= 2) {
      levelState = 'ABSORBED_LEVEL'
    }

    // Check for flip conditions
    // FLIPPED_SUPPORT: resistance level breaks and price retests from above
    if (level.type === 'BUBBLE_CLUSTER' && level.rejectedCount >= 2 && bubble.side === 'sell') {
      if (bubble.price < level.price && livePrice > level.price) {
        level.flippedSupport = true
        levelState = 'FLIPPED_SUPPORT'
      }
    }

    // FLIPPED_RESISTANCE: support level breaks and price retests from below
    if (level.type === 'BUBBLE_CLUSTER' && level.acceptedCount >= 2 && bubble.side === 'buy') {
      if (bubble.price > level.price && livePrice < level.price) {
        level.flippedResistance = true
        levelState = 'FLIPPED_RESISTANCE'
      }
    }

    return {
      levelPrice: level.price,
      levelType: level.type,
      levelState,
    }
  }

  return null
}

/**
 * Get all tracked levels (for external display).
 */
export function getAllLevels(): LevelRecord[] {
  return [...levelStore]
}

/**
 * Reset level memory (on symbol switch).
 */
export function resetLevels(): void {
  levelStore = []
}
