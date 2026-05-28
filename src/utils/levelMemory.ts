/**
 * levelMemory.ts
 *
 * Track price levels from bubble events, round prices, and orderbook liquidity.
 * A level becomes meaningful only after 2+ interactions.
 *
 * This is observational — it records WHERE the market reacted,
 * not WHETHER it will react again.
 *
 * ALL returned objects are fresh copies — never mutate and return
 * the same reference, so Zustand/React immutability is preserved.
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
  countedBubbleIds: Set<string>
  countedStateTransitions: Set<string>
}

// ─── Age phases for level fading ───
const LEVEL_FRESH_MS = 60_000 // 1 min
const LEVEL_ACTIVE_MS = 600_000 // 10 min
const LEVEL_FADE_MS = 1_800_000 // 30 min
export const LEVEL_EXPIRE_MS = 3_600_000 // 1 hour

// ─── In-memory level store (internal mutable accumulator) ───
// This is NOT React state — it's an internal data structure.
// Consumers receive deep copies, never references into this array.
let levelStore: LevelRecord[] = []

/**
 * Quantize a price to a bin for clustering nearby events.
 * Result is rounded to avoid floating-point drift producing
 * different keys for prices that should share the same bin.
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
  const raw = Math.round(price / binSize) * binSize
  // Fix floating-point drift: round to 8 decimal places
  return parseFloat(raw.toFixed(8))
}

/**
 * Find or create a level at a given price.
 * Returns the LIVE reference from levelStore (internal use only).
 */
function findOrCreateLevelRef(
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
    countedBubbleIds: new Set(),
    countedStateTransitions: new Set(),
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
 * Deep-copy a level for external consumption.
 * The Set fields are shared (they're write-once dedup trackers),
 * but all scalar fields are copied so the consumer can't
 * accidentally corrupt the internal store.
 */
function copyLevel(l: LevelRecord): LevelRecord {
  return {
    price: l.price,
    type: l.type,
    touches: l.touches,
    rejectedCount: l.rejectedCount,
    acceptedCount: l.acceptedCount,
    absorbedCount: l.absorbedCount,
    lastTouchedAt: l.lastTouchedAt,
    lastState: l.lastState,
    flippedSupport: l.flippedSupport,
    flippedResistance: l.flippedResistance,
  countedBubbleIds: new Set(l.countedBubbleIds),
  countedStateTransitions: new Set(l.countedStateTransitions),
  }
}

/**
 * Update levels from bubble events, orderbook data, and round prices.
 *
 * Mutates the internal levelStore, then returns FRESH COPIES
 * of all levels so consumers get immutable snapshots.
 *
 * This is also where flip detection happens — checkLevelInteraction
 * is now a pure read-only function.
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
    const level = findOrCreateLevelRef(binned, 'BUBBLE_CLUSTER', tolerance)

    if (!level.countedBubbleIds.has(bubble.id)) {
      level.countedBubbleIds.add(bubble.id)
      level.touches++
      level.lastTouchedAt = Math.max(level.lastTouchedAt, bubble.timestamp)
    }

    const stateKey = `${bubble.id}:${bubble.state}`
    if (!level.countedStateTransitions.has(stateKey)) {
      level.countedStateTransitions.add(stateKey)
      if (bubble.state === 'REJECTED') level.rejectedCount++
      else if (bubble.state === 'ACCEPTED') level.acceptedCount++
      else if (bubble.state === 'ABSORBED') level.absorbedCount++
    }

    if (level.touches >= 2) {
      if (level.rejectedCount > level.acceptedCount) {
        level.lastState = 'REJECTED_LEVEL'
      } else if (level.acceptedCount > level.rejectedCount) {
        level.lastState = 'ACCEPTED_LEVEL'
      } else if (level.absorbedCount >= 2) {
        level.lastState = 'ABSORBED_LEVEL'
      }
    }

    // ─── Flip detection (moved from checkLevelInteraction) ───
    // FLIPPED_SUPPORT: resistance level breaks and price retests from above
    if (level.type === 'BUBBLE_CLUSTER' && level.rejectedCount >= 2 && bubble.side === 'sell') {
      if (bubble.price < level.price && livePrice > level.price) {
        level.flippedSupport = true
        level.lastState = 'FLIPPED_SUPPORT'
      }
    }
    // FLIPPED_RESISTANCE: support level breaks and price retests from below
    if (level.type === 'BUBBLE_CLUSTER' && level.acceptedCount >= 2 && bubble.side === 'buy') {
      if (bubble.price > level.price && livePrice < level.price) {
        level.flippedResistance = true
        level.lastState = 'FLIPPED_RESISTANCE'
      }
    }
  }

  // 2. Round prices near live price → ROUND levels
  if (livePrice > 0) {
    const roundLevels = getRoundPrices(livePrice)
    for (const rp of roundLevels) {
      const level = findOrCreateLevelRef(rp, 'ROUND', tolerance)
      if (level.touches === 0) {
        level.touches = 1
        level.lastTouchedAt = now
      }
    }
  }

  // 3. Orderbook liquidity → LIQUIDITY_BID / LIQUIDITY_ASK levels
  const topBids = [...bids].sort((a, b) => b.qty - a.qty).slice(0, 5)
  const topAsks = [...asks].sort((a, b) => b.qty - a.qty).slice(0, 5)

  for (const bid of topBids) {
    const binned = priceBin(bid.price)
    const level = findOrCreateLevelRef(binned, 'LIQUIDITY_BID', tolerance)
    if (level.touches === 0) {
      level.touches = 1
      level.lastTouchedAt = now
    }
  }

  for (const ask of topAsks) {
    const binned = priceBin(ask.price)
    const level = findOrCreateLevelRef(binned, 'LIQUIDITY_ASK', tolerance)
    if (level.touches === 0) {
      level.touches = 1
      level.lastTouchedAt = now
    }
  }

  // Return fresh copies — never expose internal references
  return levelStore.map(copyLevel)
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
 * Returns a FRESH COPY, or null if no meaningful level exists.
 */
export function getLevelAtPrice(price: number, tolerance: number): LevelRecord | null {
  const now = Date.now()
  pruneExpiredLevels(now)
  const candidates = levelStore.filter(
    l => Math.abs(l.price - price) < tolerance
    && l.touches >= 2
    && (now - l.lastTouchedAt) < LEVEL_EXPIRE_MS
  )
  if (candidates.length === 0) return null
  return copyLevel(candidates.sort((a, b) => b.touches - a.touches)[0])
}

/**
 * Check if a bubble interacts with a tracked level.
 * PURE READ-ONLY — does not mutate level state.
 * Flip detection has been moved to updateLevelsFromBubbles.
 */
export function checkLevelInteraction(
  bubble: Bubble,
  levels: LevelRecord[],
  livePrice: number
): LevelInteraction | null {
  if (!bubble.price || bubble.price <= 0) return null

  const tolerance = livePrice > 0 ? livePrice * 0.0015 : 0.02
  const now = Date.now()

  for (const level of levels) {
    if (level.touches < 2) continue
    if (Math.abs(level.price - bubble.price) > tolerance) continue
    if ((now - level.lastTouchedAt) > LEVEL_EXPIRE_MS) continue

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

    // No mutation — just return the interaction info
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
 * Returns FRESH COPIES, and prunes expired first.
 */
export function getAllLevels(): LevelRecord[] {
  pruneExpiredLevels(Date.now())
  return levelStore.map(copyLevel)
}

/**
 * Reset level memory (on symbol or interval switch).
 */
export function resetLevels(): void {
  levelStore = []
}

export function addManualLevel(price: number): void {
  const tolerance = price > 0 ? price * 0.001 : 0.01
  const existing = levelStore.find(
    l => Math.abs(l.price - price) < tolerance
  )
  if (existing) {
    existing.touches = Math.max(existing.touches, 3)
    existing.lastTouchedAt = Date.now()
    if (existing.rejectedCount < 2) existing.rejectedCount = 2
    return
  }
  const level: LevelRecord = {
    price: priceBin(price),
    type: 'ROUND',
    touches: 3,
    rejectedCount: 2,
    acceptedCount: 0,
    absorbedCount: 0,
    lastTouchedAt: Date.now(),
    lastState: 'REJECTED_LEVEL',
    flippedSupport: false,
    flippedResistance: false,
    countedBubbleIds: new Set(),
    countedStateTransitions: new Set(['manual']),
  }
  levelStore.push(level)
}
