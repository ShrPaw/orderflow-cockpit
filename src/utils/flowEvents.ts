/**
 * flowEvents.ts
 *
 * Converts raw market activity into readable observational events.
 * Events describe WHAT happened, never advise on what TO DO.
 *
 * Deduplication via fingerprinting + cooldowns per event type.
 */

import type { Trade, OrderLevel, Bubble } from '../types/market'

// ─── Types ───
export type FlowEventType =
  | 'LARGE_BUY'
  | 'LARGE_SELL'
  | 'LIQUIDITY_CLUSTER_BID'
  | 'LIQUIDITY_CLUSTER_ASK'
  | 'SPREAD_WIDENED'
  | 'IMBALANCE_SHIFT'
  | 'BUBBLE_ABSORBED'
  | 'BUBBLE_REJECTED'
  | 'FLOW_BURST'
  | 'LIQUIDITY_LEVEL_TOUCHED'

export type FlowEventSeverity = 'info' | 'watch' | 'critical'

export interface FlowEvent {
  id: string
  timestamp: number
  type: FlowEventType
  severity: FlowEventSeverity
  title: string
  description: string
  source: 'trades' | 'book' | 'bubbles' | 'spread' | 'liquidity'
  price?: number
  notional?: number
  side?: 'buy' | 'sell'
}

// ─── Constants ───
const MAX_EVENTS = 30
const LARGE_TRADE_THRESHOLD = 50_000   // $50K
const BURST_THRESHOLD = 10             // 10 trades in 10s
const BURST_WINDOW_MS = 10_000
const CLUSTER_qty_THRESHOLD = 5.0      // qty units for liquidity cluster
const SPREAD_WIDEN_THRESHOLD = 0.08    // 0.08% spread = widened
const IMBALANCE_SHIFT_THRESHOLD = 60   // 60% one-sided

// Cooldowns (ms) — prevent spam per event fingerprint
const COOLDOWNS: Record<FlowEventType, number> = {
  LARGE_BUY: 3_000,
  LARGE_SELL: 3_000,
  LIQUIDITY_CLUSTER_BID: 15_000,
  LIQUIDITY_CLUSTER_ASK: 15_000,
  SPREAD_WIDENED: 10_000,
  IMBALANCE_SHIFT: 15_000,
  BUBBLE_ABSORBED: 5_000,
  BUBBLE_REJECTED: 5_000,
  FLOW_BURST: 20_000,
  LIQUIDITY_LEVEL_TOUCHED: 15_000,
}

// ─── Fingerprinting & dedup state ───
const recentFingerprints = new Map<string, number>() // fingerprint → lastTriggerTime

function fingerprint(type: FlowEventType, key: string): string {
  return `${type}:${key}`
}

function isDuplicate(type: FlowEventType, key: string): boolean {
  const fp = fingerprint(type, key)
  const last = recentFingerprints.get(fp) ?? 0
  const cooldown = COOLDOWNS[type] ?? 10_000
  if (Date.now() - last < cooldown) return true
  recentFingerprints.set(fp, Date.now())
  return false
}

// Cleanup old fingerprints periodically
let lastCleanup = 0
function cleanupFingerprints() {
  const now = Date.now()
  if (now - lastCleanup < 30_000) return
  lastCleanup = now
  for (const [fp, time] of recentFingerprints) {
    if (now - time > 60_000) recentFingerprints.delete(fp)
  }
}

// ─── ID generator ───
let eventCounter = 0
function nextId(): string {
  return `fe_${Date.now()}_${++eventCounter}`
}

// ─── Event generation ───

/**
 * Generate new flow events from current market state.
 * Returns only NEW events (not already in previousEvents).
 */
export function deriveFlowEvents({
  recentTrades,
  bids,
  asks,
  bubbles,
  livePrice,
  spreadPct,
  previousEvents,
  now,
}: {
  recentTrades: Trade[]
  bids: OrderLevel[]
  asks: OrderLevel[]
  bubbles: Bubble[]
  livePrice: number
  spreadPct: number
  previousEvents: FlowEvent[]
  now: number
}): FlowEvent[] {
  cleanupFingerprints()
  const newEvents: FlowEvent[] = []

  // 1. Large trades
  for (const t of recentTrades) {
    if (now - t.time > 5_000) continue // only recent
    if (t.notional < LARGE_TRADE_THRESHOLD) continue

    const type: FlowEventType = t.side === 'buy' ? 'LARGE_BUY' : 'LARGE_SELL'
    const bucket = Math.round(t.price / 10) * 10 // price bucket for dedup
    if (isDuplicate(type, `${bucket}`)) continue

    newEvents.push({
      id: nextId(),
      timestamp: t.time,
      type,
      severity: t.notional > 200_000 ? 'watch' : 'info',
      title: t.side === 'buy' ? 'Large aggressive buy' : 'Large aggressive sell',
      description: `$${fmtK(t.notional)} at ${t.price.toFixed(1)}`,
      source: 'trades',
      price: t.price,
      notional: t.notional,
      side: t.side,
    })
  }

  // 2. Flow burst detection
  const recentWindow = recentTrades.filter(t => now - t.time < BURST_WINDOW_MS)
  if (recentWindow.length >= BURST_THRESHOLD) {
    const buyCount = recentWindow.filter(t => t.side === 'buy').length
    const sellCount = recentWindow.length - buyCount
    const dominantSide = buyCount > sellCount ? 'buy' : 'sell'
    const dominantCount = Math.max(buyCount, sellCount)
    if (dominantCount >= BURST_THRESHOLD) {
      const burstKey = `${dominantSide}_${Math.round(now / BURST_WINDOW_MS)}`
      if (!isDuplicate('FLOW_BURST', burstKey)) {
        newEvents.push({
          id: nextId(),
          timestamp: now,
          type: 'FLOW_BURST',
          severity: 'watch',
          title: 'Trade flow burst',
          description: `${dominantCount} aggressive ${dominantSide}s in ${(BURST_WINDOW_MS / 1000).toFixed(0)}s`,
          source: 'trades',
          side: dominantSide,
        })
      }
    }
  }

  // 3. Liquidity clusters — top bid/ask levels with large qty
  if (bids.length > 0) {
    const topBid = bids.reduce((max, b) => b.qty > max.qty ? b : max, bids[0])
    if (topBid.qty >= CLUSTER_qty_THRESHOLD) {
      const bucket = Math.round(topBid.price / 50) * 50
      if (!isDuplicate('LIQUIDITY_CLUSTER_BID', `${bucket}`)) {
        newEvents.push({
          id: nextId(),
          timestamp: now,
          type: 'LIQUIDITY_CLUSTER_BID',
          severity: 'info',
          title: 'Bid liquidity cluster',
          description: `${topBid.qty.toFixed(2)} @ ${topBid.price.toFixed(1)}`,
          source: 'book',
          price: topBid.price,
        })
      }
    }
  }
  if (asks.length > 0) {
    const topAsk = asks.reduce((max, a) => a.qty > max.qty ? a : max, asks[0])
    if (topAsk.qty >= CLUSTER_qty_THRESHOLD) {
      const bucket = Math.round(topAsk.price / 50) * 50
      if (!isDuplicate('LIQUIDITY_CLUSTER_ASK', `${bucket}`)) {
        newEvents.push({
          id: nextId(),
          timestamp: now,
          type: 'LIQUIDITY_CLUSTER_ASK',
          severity: 'info',
          title: 'Ask liquidity cluster',
          description: `${topAsk.qty.toFixed(2)} @ ${topAsk.price.toFixed(1)}`,
          source: 'book',
          price: topAsk.price,
        })
      }
    }
  }

  // 4. Spread widened
  if (spreadPct >= SPREAD_WIDEN_THRESHOLD && bids.length > 0 && asks.length > 0) {
    if (!isDuplicate('SPREAD_WIDENED', 'global')) {
      newEvents.push({
        id: nextId(),
        timestamp: now,
        type: 'SPREAD_WIDENED',
        severity: spreadPct > 0.15 ? 'critical' : 'watch',
        title: 'Spread widened',
        description: `Spread at ${spreadPct.toFixed(3)}%`,
        source: 'spread',
      })
    }
  }

  // 5. Book imbalance shift
  const bidTotal = bids.reduce((s, b) => s + b.qty, 0)
  const askTotal = asks.reduce((s, a) => s + a.qty, 0)
  if (bidTotal + askTotal > 0) {
    const imbalancePct = Math.abs((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
    if (imbalancePct > IMBALANCE_SHIFT_THRESHOLD) {
      const heavierSide = bidTotal > askTotal ? 'bid' : 'ask'
      const bucket = `${heavierSide}_${Math.round(imbalancePct / 5) * 5}`
      if (!isDuplicate('IMBALANCE_SHIFT', bucket)) {
        newEvents.push({
          id: nextId(),
          timestamp: now,
          type: 'IMBALANCE_SHIFT',
          severity: imbalancePct > 80 ? 'watch' : 'info',
          title: 'Book imbalance',
          description: `${heavierSide.toUpperCase()}-heavy at ${imbalancePct.toFixed(0)}%`,
          source: 'book',
          side: heavierSide === 'bid' ? 'buy' : 'sell',
        })
      }
    }
  }

  // 6. Bubble events (absorbed/rejected)
  for (const b of bubbles) {
    if (now - b.timestamp > 10_000) continue // only recent
    if (b.state === 'ABSORBED') {
      const bucket = Math.round(b.price / 50) * 50
      if (!isDuplicate('BUBBLE_ABSORBED', `${b.side}_${bucket}`)) {
        newEvents.push({
          id: nextId(),
          timestamp: b.timestamp,
          type: 'BUBBLE_ABSORBED',
          severity: b.notional > LARGE_TRADE_THRESHOLD ? 'watch' : 'info',
          title: 'Absorption detected',
          description: `${b.side} print absorbed near ${b.price.toFixed(1)}`,
          source: 'bubbles',
          price: b.price,
          notional: b.notional,
          side: b.side,
        })
      }
    } else if (b.state === 'REJECTED') {
      const bucket = Math.round(b.price / 50) * 50
      if (!isDuplicate('BUBBLE_REJECTED', `${b.side}_${bucket}`)) {
        newEvents.push({
          id: nextId(),
          timestamp: b.timestamp,
          type: 'BUBBLE_REJECTED',
          severity: 'info',
          title: 'Bubble rejected',
          description: `${b.side} print rejected near ${b.price.toFixed(1)}`,
          source: 'bubbles',
          price: b.price,
          side: b.side,
        })
      }
    }
  }

  // Merge with previous, cap at MAX_EVENTS
  const allEvents = [...newEvents, ...previousEvents]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_EVENTS)

  return allEvents
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toFixed(0)
}
