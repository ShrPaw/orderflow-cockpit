/**
 * bookValidation.ts
 *
 * Shared order book integrity validation.
 * Used by localOrderBook.ts and display components.
 */

import type { OrderLevel } from '../types/market'

export interface BookIntegrityResult {
  valid: boolean
  reason?: string
  details?: Record<string, unknown>
}

// Realistic spread thresholds for BTC/large-cap futures
// BTC typically has spreads of 0.001% — 0.05% during normal trading
// Anything above 0.5% is suspicious; above 1% is almost certainly bad data
const MAX_SPREAD_PCT = 0.5
const WARN_SPREAD_PCT = 0.1

/**
 * Validate order book integrity for display purposes.
 * Returns { valid: true } if the book is sane, or { valid: false, reason } if not.
 */
export function validateBookIntegrity({
  bids,
  asks,
  livePrice,
  source,
  now,
  lastMessageTime,
}: {
  bids: OrderLevel[]
  asks: OrderLevel[]
  livePrice?: number
  source: string
  now: number
  lastMessageTime: number
}): BookIntegrityResult {
  // Must have both sides
  if (bids.length === 0 || asks.length === 0) {
    return { valid: false, reason: 'empty book', details: { bidCount: bids.length, askCount: asks.length } }
  }

  // All prices must be finite and positive
  for (const b of bids) {
    if (!isFinite(b.price) || b.price <= 0) return { valid: false, reason: `invalid bid price: ${b.price}` }
    if (!isFinite(b.qty) || b.qty <= 0) return { valid: false, reason: `invalid bid qty: ${b.qty}` }
  }
  for (const a of asks) {
    if (!isFinite(a.price) || a.price <= 0) return { valid: false, reason: `invalid ask price: ${a.price}` }
    if (!isFinite(a.qty) || a.qty <= 0) return { valid: false, reason: `invalid ask qty: ${a.qty}` }
  }

  // Bids must be sorted descending
  for (let i = 1; i < bids.length; i++) {
    if (bids[i].price >= bids[i - 1].price) {
      return { valid: false, reason: 'bids not sorted descending', details: { idx: i, price: bids[i].price, prev: bids[i - 1].price } }
    }
  }

  // Asks must be sorted ascending
  for (let i = 1; i < asks.length; i++) {
    if (asks[i].price <= asks[i - 1].price) {
      return { valid: false, reason: 'asks not sorted ascending', details: { idx: i, price: asks[i].price, prev: asks[i - 1].price } }
    }
  }

  const bestBid = bids[0].price
  const bestAsk = asks[0].price

  // Best bid must be below best ask
  if (bestBid >= bestAsk) {
    return { valid: false, reason: 'crossed book', details: { bestBid, bestAsk } }
  }

  const spread = bestAsk - bestBid
  const midPrice = (bestBid + bestAsk) / 2
  const spreadPct = (spread / bestBid) * 100

  // Unrealistic spread check
  if (spreadPct > MAX_SPREAD_PCT) {
    return {
      valid: false,
      reason: `unrealistic spread ${spreadPct.toFixed(3)}%`,
      details: { bestBid, bestAsk, spread, spreadPct, midPrice },
    }
  }

  // Mid-price proximity to live price (if available)
  if (livePrice && livePrice > 0) {
    const priceDriftPct = Math.abs((midPrice - livePrice) / livePrice) * 100
    if (priceDriftPct > 1.0) {
      return {
        valid: false,
        reason: `mid-price drift ${priceDriftPct.toFixed(3)}% from live`,
        details: { midPrice, livePrice, driftPct: priceDriftPct },
      }
    }
  }

  // Staleness check (only if we have a message time)
  if (lastMessageTime > 0) {
    const ageMs = now - lastMessageTime
    if (ageMs > 30_000) {
      return {
        valid: false,
        reason: `stale data (${Math.round(ageMs / 1000)}s old)`,
        details: { ageMs, lastMessageTime, now },
      }
    }
  }

  return { valid: true }
}

/**
 * Quick sanity check for spread — lighter than full validation.
 * Used in hot paths (every depth20 update).
 */
export function isSpreadSane(bestBid: number, bestAsk: number): boolean {
  if (bestBid <= 0 || bestAsk <= 0 || bestBid >= bestAsk) return false
  const spreadPct = ((bestAsk - bestBid) / bestBid) * 100
  return spreadPct <= MAX_SPREAD_PCT
}

/**
 * Get spread info for display.
 */
export function getSpreadInfo(bids: OrderLevel[], asks: OrderLevel[]): {
  spread: number
  spreadPct: number
  midPrice: number
  sane: boolean
} {
  if (bids.length === 0 || asks.length === 0) {
    return { spread: 0, spreadPct: 0, midPrice: 0, sane: false }
  }
  const bestBid = bids[0].price
  const bestAsk = asks[0].price
  const spread = bestAsk - bestBid
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0
  const midPrice = (bestBid + bestAsk) / 2
  const sane = isSpreadSane(bestBid, bestAsk)
  return { spread, spreadPct, midPrice, sane }
}
