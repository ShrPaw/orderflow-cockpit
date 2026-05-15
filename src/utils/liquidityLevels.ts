/**
 * liquidityLevels.ts
 *
 * Derives trader-useful liquidity level information from order book data.
 * Shows where visible liquidity is concentrated with importance scoring.
 *
 * All data is observational — no predictions about future liquidity behavior.
 */

import type { OrderLevel } from '../types/market'

// ─── Types ───
export interface LiquidityLevel {
  side: 'BID' | 'ASK'
  price: number
  qty: number
  notional: number          // qty * price
  distancePct: number       // % from live price
  distanceSign: '+' | '-'
  score: number             // importance score
  relativeStrength: number  // 0-100 normalized
  status: 'visible' | 'near_price' | 'large_visible'
}

// ─── Scoring constants ───
const PROXIMITY_WEIGHT_FACTOR = 5  // Controls how quickly score decays with distance
const TOP_N = 5                    // Show top 5 per side

/**
 * Compute importance score for a liquidity level.
 * score = quantity * proximityWeight
 * proximityWeight = 1 / (1 + distancePct * PROXIMITY_WEIGHT_FACTOR)
 */
function computeScore(qty: number, distancePct: number): number {
  const proximityWeight = 1 / (1 + distancePct * PROXIMITY_WEIGHT_FACTOR)
  return qty * proximityWeight
}

/**
 * Derive liquidity levels from current order book.
 * Returns top 5 bid and top 5 ask levels sorted by importance.
 */
export function deriveLiquidityLevels({
  bids,
  asks,
  livePrice,
}: {
  bids: OrderLevel[]
  asks: OrderLevel[]
  livePrice: number
}): { bidLevels: LiquidityLevel[]; askLevels: LiquidityLevel[] } {
  if (!livePrice || livePrice <= 0 || (bids.length === 0 && asks.length === 0)) {
    return { bidLevels: [], askLevels: [] }
  }

  // Process bids
  const bidLevels: LiquidityLevel[] = bids.map(b => {
    const distancePct = Math.abs(b.price - livePrice) / livePrice * 100
    const score = computeScore(b.qty, distancePct)
    const notional = b.qty * b.price
    let status: LiquidityLevel['status'] = 'visible'
    if (distancePct < 0.1) status = 'near_price'
    else if (b.qty > getAvgQty(bids) * 2) status = 'large_visible'
    return {
      side: 'BID' as const,
      price: b.price,
      qty: b.qty,
      notional,
      distancePct,
      distanceSign: '-' as const,
      score,
      relativeStrength: 0, // computed after sorting
      status,
    }
  })

  // Process asks
  const askLevels: LiquidityLevel[] = asks.map(a => {
    const distancePct = Math.abs(a.price - livePrice) / livePrice * 100
    const score = computeScore(a.qty, distancePct)
    const notional = a.qty * a.price
    let status: LiquidityLevel['status'] = 'visible'
    if (distancePct < 0.1) status = 'near_price'
    else if (a.qty > getAvgQty(asks) * 2) status = 'large_visible'
    return {
      side: 'ASK' as const,
      price: a.price,
      qty: a.qty,
      notional,
      distancePct,
      distanceSign: '+' as const,
      score,
      relativeStrength: 0,
      status,
    }
  })

  // Sort by score descending
  bidLevels.sort((a, b) => b.score - a.score)
  askLevels.sort((a, b) => b.score - a.score)

  // Compute relative strength (0-100)
  const maxBidScore = bidLevels[0]?.score ?? 1
  const maxAskScore = askLevels[0]?.score ?? 1
  for (const l of bidLevels) {
    l.relativeStrength = Math.round((l.score / maxBidScore) * 100)
  }
  for (const l of askLevels) {
    l.relativeStrength = Math.round((l.score / maxAskScore) * 100)
  }

  return {
    bidLevels: bidLevels.slice(0, TOP_N),
    askLevels: askLevels.slice(0, TOP_N),
  }
}

/**
 * Average quantity across levels.
 */
function getAvgQty(levels: OrderLevel[]): number {
  if (levels.length === 0) return 0
  return levels.reduce((s, l) => s + l.qty, 0) / levels.length
}

/**
 * Format distance for display: "+0.12%" or "-0.08%"
 */
export function formatDistance(level: LiquidityLevel): string {
  const sign = level.distanceSign
  return `${sign}${level.distancePct.toFixed(2)}%`
}
