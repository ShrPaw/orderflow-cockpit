/**
 * alerts.ts
 *
 * Local alert rule management with localStorage persistence.
 * Alerts produce observational events — never buy/sell signals.
 *
 * Alert types:
 * 1. Large trade above notional threshold
 * 2. Spread above threshold
 * 3. Bid/ask imbalance above threshold
 * 4. Price within X% of top liquidity level
 */

import type { Trade, OrderLevel } from '../types/market'
import type { FlowEvent } from './flowEvents'

// ─── Storage key (versioned) ───
const STORAGE_KEY = 'orderflow.alertRules.v1'

// ─── Types ───
export type AlertType = 'LARGE_TRADE' | 'SPREAD' | 'IMBALANCE' | 'LIQUIDITY_PROXIMITY'

export interface AlertRule {
  id: string
  type: AlertType
  enabled: boolean
  label: string
  threshold: number
  cooldownSeconds: number
  createdAt: number
}

export interface TriggeredAlert {
  ruleId: string
  timestamp: number
  message: string
  severity: 'watch' | 'critical'
}

// ─── Default rules ───
const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'default_large_trade',
    type: 'LARGE_TRADE',
    enabled: true,
    label: 'Large trade above $50,000',
    threshold: 50_000,
    cooldownSeconds: 5,
    createdAt: 0,
  },
  {
    id: 'default_spread',
    type: 'SPREAD',
    enabled: true,
    label: 'Spread above 0.10%',
    threshold: 0.10,
    cooldownSeconds: 10,
    createdAt: 0,
  },
  {
    id: 'default_imbalance',
    type: 'IMBALANCE',
    enabled: true,
    label: 'Book imbalance above 70%',
    threshold: 70,
    cooldownSeconds: 15,
    createdAt: 0,
  },
  {
    id: 'default_liq_proximity',
    type: 'LIQUIDITY_PROXIMITY',
    enabled: true,
    label: 'Price within 0.15% of top level',
    threshold: 0.15,
    cooldownSeconds: 15,
    createdAt: 0,
  },
]

// ─── Cooldown tracking ───
const lastTriggerTime = new Map<string, number>()

function isOnCooldown(ruleId: string, cooldownSeconds: number): boolean {
  const last = lastTriggerTime.get(ruleId) ?? 0
  return Date.now() - last < cooldownSeconds * 1000
}

function markTriggered(ruleId: string): void {
  lastTriggerTime.set(ruleId, Date.now())
}

// ─── Storage ───

export function loadAlertRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_RULES]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_RULES]
    // Validate each rule has required fields
    return parsed.filter(r =>
      r && typeof r.id === 'string'
        && typeof r.type === 'string'
        && typeof r.enabled === 'boolean'
        && typeof r.threshold === 'number'
    )
  } catch {
    return [...DEFAULT_RULES]
  }
}

export function saveAlertRules(rules: AlertRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function getDefaultRules(): AlertRule[] {
  return DEFAULT_RULES.map(r => ({ ...r }))
}

// ─── Alert evaluation ───

/**
 * Evaluate alert rules against current market state.
 * Returns new triggered alert events (to be added to flow events panel).
 */
export function evaluateAlerts({
  rules,
  recentTrades,
  bids,
  asks,
  livePrice,
  spreadPct,
  now,
}: {
  rules: AlertRule[]
  recentTrades: Trade[]
  bids: OrderLevel[]
  asks: OrderLevel[]
  livePrice: number
  spreadPct: number
  now: number
}): { triggered: TriggeredAlert[]; events: FlowEvent[] } {
  const triggered: TriggeredAlert[] = []
  const events: FlowEvent[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    if (isOnCooldown(rule.id, rule.cooldownSeconds)) continue

    let fired = false
    let message = ''
    let severity: 'watch' | 'critical' = 'watch'
    let price: number | undefined
    let side: 'buy' | 'sell' | undefined
    let notional: number | undefined

    switch (rule.type) {
      case 'LARGE_TRADE': {
        // Check if any recent trade exceeds threshold
        const bigTrade = recentTrades.find(t => now - t.time < 5_000 && t.notional >= rule.threshold)
        if (bigTrade) {
          fired = true
          message = `$${fmtK(bigTrade.notional)} ${bigTrade.side} at ${bigTrade.price.toFixed(1)}`
          severity = bigTrade.notional > rule.threshold * 4 ? 'critical' : 'watch'
          price = bigTrade.price
          side = bigTrade.side
          notional = bigTrade.notional
        }
        break
      }
      case 'SPREAD': {
        if (spreadPct >= rule.threshold && bids.length > 0 && asks.length > 0) {
          fired = true
          message = `Spread at ${spreadPct.toFixed(3)}% (threshold: ${rule.threshold}%)`
          severity = spreadPct > rule.threshold * 2 ? 'critical' : 'watch'
        }
        break
      }
      case 'IMBALANCE': {
        const bidTotal = bids.reduce((s, b) => s + b.qty, 0)
        const askTotal = asks.reduce((s, a) => s + a.qty, 0)
        if (bidTotal + askTotal > 0) {
          const imbalancePct = Math.abs((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
          if (imbalancePct >= rule.threshold) {
            fired = true
            const heavierSide = bidTotal > askTotal ? 'BID' : 'ASK'
            message = `${heavierSide}-heavy at ${imbalancePct.toFixed(0)}%`
            side = heavierSide === 'BID' ? 'buy' : 'sell'
          }
        }
        break
      }
      case 'LIQUIDITY_PROXIMITY': {
        if (livePrice <= 0 || (bids.length === 0 && asks.length === 0)) break
        // Check distance to top bid and top ask
        const topBid = bids[0]?.price ?? 0
        const topAsk = asks[0]?.price ?? Infinity
        const bidDist = topBid > 0 ? Math.abs(livePrice - topBid) / livePrice * 100 : Infinity
        const askDist = topAsk < Infinity ? Math.abs(topAsk - livePrice) / livePrice * 100 : Infinity
        const minDist = Math.min(bidDist, askDist)
        if (minDist <= rule.threshold) {
          fired = true
          const nearSide = bidDist < askDist ? 'bid' : 'ask'
          const nearPrice = nearSide === 'bid' ? topBid : topAsk
          message = `Price ${minDist.toFixed(3)}% from top ${nearSide} @ ${nearPrice.toFixed(1)}`
          side = nearSide === 'bid' ? 'buy' : 'sell'
          price = nearPrice
        }
        break
      }
    }

    if (fired) {
      markTriggered(rule.id)
      triggered.push({
        ruleId: rule.id,
        timestamp: now,
        message,
        severity,
      })

      // Generate a flow event for the alert
      events.push({
        id: `alert_${rule.id}_${now}`,
        timestamp: now,
        type: getFlowEventType(rule.type),
        severity,
        title: rule.label,
        description: message,
        source: getSourceForType(rule.type),
        price,
        notional,
        side,
      })
    }
  }

  return { triggered, events }
}

function getFlowEventType(alertType: AlertType): FlowEvent['type'] {
  switch (alertType) {
    case 'LARGE_TRADE': return 'LARGE_BUY' // will be overridden by actual side
    case 'SPREAD': return 'SPREAD_WIDENED'
    case 'IMBALANCE': return 'IMBALANCE_SHIFT'
    case 'LIQUIDITY_PROXIMITY': return 'LIQUIDITY_LEVEL_TOUCHED'
  }
}

function getSourceForType(alertType: AlertType): FlowEvent['source'] {
  switch (alertType) {
    case 'LARGE_TRADE': return 'trades'
    case 'SPREAD': return 'spread'
    case 'IMBALANCE': return 'book'
    case 'LIQUIDITY_PROXIMITY': return 'liquidity'
  }
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toFixed(0)
}
