/**
 * bookValidation.ts
 *
 * Symbol-aware order book integrity validation.
 * Spread thresholds are calibrated per-symbol based on typical market microstructure.
 *
 * BTCUSDT / ETHUSDT: extremely tight spreads (~0.001–0.01%)
 * SOLUSDT / liquid large caps: tight spreads (~0.01–0.05%)
 * Smaller alts: wider spreads (~0.02–0.10%)
 */

import type { OrderLevel } from '../types/market'

export interface BookIntegrityResult {
  valid: boolean
  reason?: string
  details?: Record<string, unknown>
}

// ─── Symbol-aware spread thresholds ───
interface SpreadThresholds {
  warn: number    // above this → warn (dim display, show warning)
  invalid: number // above this → reject book entirely
}

// Tier 1: Ultra-liquid (BTC, ETH)
const TIER1_THRESHOLDS: SpreadThresholds = { warn: 0.02, invalid: 0.05 }
// Tier 2: Liquid large caps (SOL, BNB, XRP, etc.)
const TIER2_THRESHOLDS: SpreadThresholds = { warn: 0.05, invalid: 0.10 }
// Tier 3: Smaller alts / memes
const TIER3_THRESHOLDS: SpreadThresholds = { warn: 0.10, invalid: 0.30 }
// Default fallback
const DEFAULT_THRESHOLDS: SpreadThresholds = { warn: 0.05, invalid: 0.15 }

// Symbol → tier mapping
const TIER1_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT'])
const TIER2_SYMBOLS = new Set([
  'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'UNIUSDT',
  'ATOMUSDT', 'LTCUSDT', 'NEARUSDT', 'ARBUSDT', 'OPUSDT',
  'APTUSDT', 'SUIUSDT',
])

function getSpreadThresholds(symbol: string): SpreadThresholds {
  const upper = symbol.toUpperCase()
  if (TIER1_SYMBOLS.has(upper)) return TIER1_THRESHOLDS
  if (TIER2_SYMBOLS.has(upper)) return TIER2_THRESHOLDS
  // Check for common alt/meme patterns
  if (upper.endsWith('USDT')) return TIER3_THRESHOLDS
  return DEFAULT_THRESHOLDS
}

/**
 * Get spread thresholds for a specific symbol.
 * Exported for use in connectors.
 */
export function getSymbolSpreadThresholds(symbol: string): SpreadThresholds {
  return getSpreadThresholds(symbol)
}

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
  symbol,
}: {
  bids: OrderLevel[]
  asks: OrderLevel[]
  livePrice?: number
  source: string
  now: number
  lastMessageTime: number
  symbol?: string
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

  // Symbol-aware spread check
  const thresholds = symbol ? getSpreadThresholds(symbol) : DEFAULT_THRESHOLDS
  if (spreadPct > thresholds.invalid) {
    return {
      valid: false,
      reason: `spread ${spreadPct.toFixed(4)}% exceeds ${thresholds.invalid}% limit for ${symbol ?? 'unknown'}`,
      details: { bestBid, bestAsk, spread, spreadPct, midPrice, threshold: thresholds.invalid, symbol },
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
 * Returns true if spread is acceptable, false if it should be rejected.
 */
export function isSpreadSane(bestBid: number, bestAsk: number, symbol?: string): boolean {
  if (bestBid <= 0 || bestAsk <= 0 || bestBid >= bestAsk) return false
  const spreadPct = ((bestAsk - bestBid) / bestBid) * 100
  const thresholds = symbol ? getSpreadThresholds(symbol) : DEFAULT_THRESHOLDS
  return spreadPct <= thresholds.invalid
}

/**
 * Check if spread is in warning range (valid but abnormal).
 * Returns true if spread exceeds warning threshold.
 */
export function isSpreadWarning(bestBid: number, bestAsk: number, symbol?: string): boolean {
  if (bestBid <= 0 || bestAsk <= 0 || bestBid >= bestAsk) return false
  const spreadPct = ((bestAsk - bestBid) / bestBid) * 100
  const thresholds = symbol ? getSpreadThresholds(symbol) : DEFAULT_THRESHOLDS
  return spreadPct > thresholds.warn
}

/**
 * Get spread info for display with symbol-aware thresholds.
 */
export function getSpreadInfo(bids: OrderLevel[], asks: OrderLevel[], symbol?: string): {
  spread: number
  spreadPct: number
  midPrice: number
  sane: boolean
  warning: boolean
  thresholds: SpreadThresholds
} {
  if (bids.length === 0 || asks.length === 0) {
    return { spread: 0, spreadPct: 0, midPrice: 0, sane: false, warning: false, thresholds: DEFAULT_THRESHOLDS }
  }
  const bestBid = bids[0].price
  const bestAsk = asks[0].price
  const spread = bestAsk - bestBid
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0
  const midPrice = (bestBid + bestAsk) / 2
  const thresholds = symbol ? getSpreadThresholds(symbol) : DEFAULT_THRESHOLDS
  const sane = spreadPct <= thresholds.invalid
  const warning = spreadPct > thresholds.warn
  return { spread, spreadPct, midPrice, sane, warning, thresholds }
}

// ─── Single source of truth for book display state ───

export type BookDisplayStatus =
  | 'LIVE_TOP20'
  | 'STRICT_DEPTH'
  | 'VALIDATION_PENDING'
  | 'STALE'
  | 'INVALID'
  | 'DISCONNECTED'

export interface BookDisplayState {
  status: BookDisplayStatus
  valid: boolean
  spread: number
  spreadPct: number
  midPrice: number
  warning: boolean
  invalidReason: string | null
  thresholds: SpreadThresholds
  canShowBookMetrics: boolean
  sourceLabel: string
}

/**
 * Single source of truth for whether book data should be displayed.
 * All panels (Market Snapshot, Order Book, etc.) must use this
 * instead of computing their own validation.
 */
export function getBookDisplayState({
  bids,
  asks,
  symbol,
  orderBookSource,
  orderBookHealth,
  depthStale,
}: {
  bids: OrderLevel[]
  asks: OrderLevel[]
  symbol: string
  orderBookSource: string
  orderBookHealth: string
  depthStale: boolean
}): BookDisplayState {
  const thresholds = getSpreadThresholds(symbol)

  // No data at all
  if (bids.length === 0 || asks.length === 0) {
    const status: BookDisplayStatus =
      orderBookHealth === 'DISCONNECTED' ? 'DISCONNECTED' :
      orderBookHealth === 'ERROR' ? 'INVALID' :
      'VALIDATION_PENDING'
    return {
      status,
      valid: false,
      spread: 0,
      spreadPct: 0,
      midPrice: 0,
      warning: false,
      invalidReason: null,
      thresholds,
      canShowBookMetrics: false,
      sourceLabel: status === 'DISCONNECTED' ? 'Disconnected' : 'Validation Pending',
    }
  }

  // Stale book
  if (depthStale) {
    return {
      status: 'STALE',
      valid: false,
      spread: 0,
      spreadPct: 0,
      midPrice: 0,
      warning: false,
      invalidReason: 'Book data may be stale',
      thresholds,
      canShowBookMetrics: false,
      sourceLabel: 'Stale',
    }
  }

  // Compute spread
  const bestBid = bids[0].price
  const bestAsk = asks[0].price
  const spread = bestAsk - bestBid
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0
  const midPrice = (bestBid + bestAsk) / 2

  // Invalid spread
  if (spreadPct > thresholds.invalid) {
    return {
      status: 'INVALID',
      valid: false,
      spread,
      spreadPct,
      midPrice,
      warning: true,
      invalidReason: `Spread ${spreadPct.toFixed(4)}% exceeds ${symbol} limit ${thresholds.invalid}%`,
      thresholds,
      canShowBookMetrics: false,
      sourceLabel: 'Validation Failed',
    }
  }

  // Warning spread (valid but abnormal)
  const warning = spreadPct > thresholds.warn

  // Determine display status based on source + health
  let status: BookDisplayStatus
  let sourceLabel: string

  if (orderBookSource === 'strict' && orderBookHealth === 'HEALTHY') {
    status = 'STRICT_DEPTH'
    sourceLabel = 'Strict Depth'
  } else if (orderBookHealth === 'TOP20' || orderBookHealth === 'DEGRADED' || orderBookHealth === 'HEALTHY') {
    status = 'LIVE_TOP20'
    sourceLabel = 'Live Top-20'
  } else if (orderBookHealth === 'STALE') {
    status = 'STALE'
    sourceLabel = 'Stale'
  } else if (orderBookHealth === 'ERROR') {
    status = 'INVALID'
    sourceLabel = 'Error'
  } else {
    status = 'VALIDATION_PENDING'
    sourceLabel = 'Validation Pending'
  }

  return {
    status,
    valid: !warning,     // valid for display only if not in warning range
    spread,
    spreadPct,
    midPrice,
    warning,
    invalidReason: warning ? `Spread ${spreadPct.toFixed(4)}% — abnormal for ${symbol}` : null,
    thresholds,
    canShowBookMetrics: !warning,  // hide book metrics if spread is abnormal
    sourceLabel,
  }
}
