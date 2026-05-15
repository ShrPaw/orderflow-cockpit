/**
 * marketSnapshot.ts
 *
 * Derives compact market context from existing store data.
 * All metrics are observational — no predictions, no signals.
 */

import type { Trade, OrderLevel, Ticker24h } from '../types/market'
import type { OrderBookHealth, OrderBookSource } from '../types/market'
import { getSpreadInfo } from './bookValidation'

// ─── Constants ───
const FLOW_WINDOW_MS = 60_000       // 60s rolling window for flow metrics
const LARGE_TRADE_THRESHOLD = 50_000 // $50K notional = "large print"

// ─── Types ───
export interface MarketSnapshot {
  // Price context
  price: number
  change24h: number
  changePct24h: number
  sessionHigh: number
  sessionLow: number
  rangePosition: number | null  // 0-100% through session range

  // Book context
  bookSource: OrderBookHealth
  bookSourceLabel: string
  spread: number
  spreadPct: number
  bidAskImbalance: number  // -100 to +100
  topBidQty: number
  topAskQty: number
  bidTotal: number
  askTotal: number

  // Flow context
  buyPressure: number      // aggressive buy volume in window
  sellPressure: number     // aggressive sell volume in window
  netFlow: number          // buy - sell in window
  lastLargePrint: {
    side: 'buy' | 'sell'
    notional: number
    price: number
    timeAgo: number
  } | null

  // Health context
  tickerOk: boolean
  tradesOk: boolean
  bookOk: boolean
  staleWarning: string | null
}

/**
 * Compute market snapshot from current store state.
 */
export function computeMarketSnapshot({
  livePrice,
  ticker,
  recentTrades,
  bids,
  asks,
  orderBookHealth,
  orderBookSource,
  connected,
  tickerConnected,
  depthConnected,
  lastTradeTime,
  depthStale,
}: {
  livePrice: number
  ticker: Ticker24h | null
  recentTrades: Trade[]
  bids: OrderLevel[]
  asks: OrderLevel[]
  orderBookHealth: OrderBookHealth
  orderBookSource: OrderBookSource
  connected: boolean
  tickerConnected: boolean
  depthConnected: boolean
  lastTradeTime: number
  depthStale: boolean
}): MarketSnapshot {
  const now = Date.now()

  // ── Price context ──
  const price = livePrice || ticker?.price || 0
  const change24h = ticker?.change ?? 0
  const changePct24h = ticker?.changePct ?? 0
  const sessionHigh = ticker?.high ?? 0
  const sessionLow = ticker?.low ?? 0

  let rangePosition: number | null = null
  if (sessionHigh > sessionLow && sessionHigh > 0 && price > 0) {
    rangePosition = ((price - sessionLow) / (sessionHigh - sessionLow)) * 100
    rangePosition = Math.max(0, Math.min(100, rangePosition))
  }

  // ── Book context ──
  const spreadInfo = getSpreadInfo(bids, asks)
  const bidTotal = bids.reduce((s, b) => s + b.qty, 0)
  const askTotal = asks.reduce((s, a) => s + a.qty, 0)
  const imbalance = bidTotal + askTotal > 0
    ? ((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
    : 0

  const bookSourceLabel =
    orderBookSource === 'strict' ? 'STRICT DEPTH' :
    orderBookSource === 'depth20' ? 'LIVE TOP-20' :
    orderBookHealth === 'STALE' ? 'STALE' :
    orderBookHealth === 'ERROR' ? 'ERROR' :
    '—'

  // ── Flow context (60s window) ──
  const windowTrades = recentTrades.filter(t => (now - t.time) < FLOW_WINDOW_MS)
  let buyPressure = 0
  let sellPressure = 0
  for (const t of windowTrades) {
    if (t.side === 'buy') buyPressure += t.notional
    else sellPressure += t.notional
  }
  const netFlow = buyPressure - sellPressure

  // Last large print
  let lastLargePrint: MarketSnapshot['lastLargePrint'] = null
  for (const t of recentTrades) {
    if (t.notional >= LARGE_TRADE_THRESHOLD) {
      lastLargePrint = {
        side: t.side,
        notional: t.notional,
        price: t.price,
        timeAgo: now - t.time,
      }
      break
    }
  }

  // ── Health context ──
  const tickerOk = tickerConnected && !!ticker
  const tradesOk = connected && (now - lastTradeTime) < 15_000
  const bookOk = depthConnected && !depthStale && orderBookHealth !== 'ERROR' && orderBookHealth !== 'STALE'

  let staleWarning: string | null = null
  if (!tradesOk && connected) staleWarning = 'Trade stream may be stale'
  else if (depthStale) staleWarning = 'Order book data may be stale'
  else if (!tickerOk) staleWarning = 'Ticker disconnected'

  return {
    price,
    change24h,
    changePct24h,
    sessionHigh,
    sessionLow,
    rangePosition,
    bookSource: orderBookHealth,
    bookSourceLabel,
    spread: spreadInfo.spread,
    spreadPct: spreadInfo.spreadPct,
    bidAskImbalance: imbalance,
    topBidQty: bids[0]?.qty ?? 0,
    topAskQty: asks[0]?.qty ?? 0,
    bidTotal,
    askTotal,
    buyPressure,
    sellPressure,
    netFlow,
    lastLargePrint,
    tickerOk,
    tradesOk,
    bookOk,
    staleWarning,
  }
}
