/**
 * auctionClusters.ts
 *
 * Auction Cluster Bubble System
 *
 * Evolves the bubble system from single-print to auction-cluster logic.
 * Multiple nearby aggressive events fuse into one clearer cluster bubble.
 *
 * Each cluster communicates:
 * - aggressive side (buy or sell)
 * - cumulative notional / volume
 * - auction state (accepted, rejected, absorbed, exhausted, invalidated)
 * - structural role (resistance/support)
 * - auction context labels (NOT signals)
 * - age phase for visual fading
 *
 * Core principle: Reduce visual saturation without losing auction meaning.
 */

import type { Bubble, BubbleState, Interval } from '../types/market'
import { INTERVAL_MS } from '../types/market'

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export type ClusterState =
  | 'FORMING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'ABSORBED'
  | 'EXHAUSTED'
  | 'INVALIDATED'
  | 'RESISTANCE'

export type AuctionContext =
  | 'SELL_AUCTION_DOWN'
  | 'BUY_AUCTION_UP'
  | 'FAILED_SELL_AUCTION'
  | 'FAILED_BUY_AUCTION'
  | 'ABSORPTION_AT_LEVEL'
  | 'RESPONSIVE_BUYING'
  | 'RESPONSIVE_SELLING'
  | 'INITIATIVE_BUYING'
  | 'INITIATIVE_SELLING'
  | 'NONE'

export type StructuralRole = 'NONE' | 'RESISTANCE' | 'SUPPORT'
export type AgePhase = 'FRESH' | 'ACTIVE' | 'FADING' | 'EXPIRED'

export interface AuctionCluster {
  id: string
  side: 'buy' | 'sell'
  startTs: number
  endTs: number
  firstPrice: number
  lastPrice: number
  priceLow: number
  priceHigh: number
  vwapPrice: number
  cumulativeNotional: number
  cumulativeVolume: number
  tradeCount: number
  rawBubbleIds: string[]
  state: ClusterState
  originSide: 'buy' | 'sell'
  absorptionScore: number
  acceptanceScore: number
  rejectionScore: number
  invalidated: boolean
  structuralRole: StructuralRole
  levelKey: number
  agePhase: AgePhase
  auctionContext: AuctionContext
  priceChange: number
  priceChangePct: number
  flowType: 'initiative' | 'responsive' | 'unknown'
  resistanceOrigin?: 'buy' | 'sell'
}

export interface ClusterConfig {
  timeWindowMs: number
  priceBandPct: number
  minEventsForCluster: number
  maxClusterAgeMs: number
}

// ═══════════════════════════════════════════
// ADAPTIVE CLUSTERING RULES (P2)
// ═══════════════════════════════════════════

export function getClusterConfig(interval: Interval): ClusterConfig {
  const intMs = INTERVAL_MS[interval]

  if (intMs <= 10_000) {
    return { timeWindowMs: 1_500, priceBandPct: 0.0008, minEventsForCluster: 2, maxClusterAgeMs: 30_000 }
  } else if (intMs <= 20_000) {
    return { timeWindowMs: 2_500, priceBandPct: 0.001, minEventsForCluster: 2, maxClusterAgeMs: 60_000 }
  } else if (intMs <= 40_000) {
    return { timeWindowMs: 4_000, priceBandPct: 0.0012, minEventsForCluster: 2, maxClusterAgeMs: 120_000 }
  } else if (intMs <= 60_000) {
    return { timeWindowMs: 6_000, priceBandPct: 0.0015, minEventsForCluster: 2, maxClusterAgeMs: 180_000 }
  } else {
    return { timeWindowMs: 10_000, priceBandPct: 0.002, minEventsForCluster: 2, maxClusterAgeMs: 300_000 }
  }
}

// ═══════════════════════════════════════════
// CLUSTER LIFECYCLE
// ═══════════════════════════════════════════

let clusterCounter = 0

function priceBucket(price: number): number {
  if (price > 50000) return Math.round(price / 50) * 50
  if (price > 10000) return Math.round(price / 25) * 25
  if (price > 1000) return Math.round(price / 10) * 10
  if (price > 100) return Math.round(price / 5) * 5
  if (price > 10) return Math.round(price / 1) * 1
  return Math.round(price / 0.5) * 0.5
}

function computeVWAPFromCluster(cluster: AuctionCluster): number {
  const priceRange = cluster.priceHigh - cluster.priceLow
  const midPrice = (cluster.priceHigh + cluster.priceLow) / 2
  if (priceRange / midPrice < 0.001) return midPrice
  return cluster.lastPrice * 0.6 + cluster.vwapPrice * 0.4
}

function canMergeIntoCluster(
  cluster: AuctionCluster,
  bubble: Bubble,
  config: ClusterConfig,
  now: number
): boolean {
  if (cluster.side !== bubble.side) return false
  const timeGap = bubble.timestamp - cluster.endTs
  if (timeGap > config.timeWindowMs) return false
  if (timeGap < -5_000) return false
  const priceRef = cluster.vwapPrice || cluster.lastPrice
  const priceDist = Math.abs(bubble.price - priceRef) / priceRef
  if (priceDist > config.priceBandPct) return false
  const clusterAge = now - cluster.startTs
  if (clusterAge > config.maxClusterAgeMs) return false
  if (cluster.invalidated) return false
  return true
}

function createCluster(bubble: Bubble): AuctionCluster {
  return {
    id: `cl-${++clusterCounter}-${bubble.timestamp}`,
    side: bubble.side,
    startTs: bubble.timestamp,
    endTs: bubble.timestamp,
    firstPrice: bubble.price,
    lastPrice: bubble.price,
    priceLow: bubble.price,
    priceHigh: bubble.price,
    vwapPrice: bubble.price,
    cumulativeNotional: bubble.notional,
    cumulativeVolume: bubble.volume,
    tradeCount: 1,
    rawBubbleIds: [bubble.id],
    state: 'FORMING',
    originSide: bubble.side,
    absorptionScore: 0,
    acceptanceScore: 0,
    rejectionScore: 0,
    invalidated: false,
    structuralRole: 'NONE',
    levelKey: priceBucket(bubble.price),
    agePhase: 'FRESH',
    auctionContext: 'NONE',
    priceChange: 0,
    priceChangePct: 0,
    flowType: 'unknown',
  }
}

function mergeBubbleIntoCluster(cluster: AuctionCluster, bubble: Bubble): AuctionCluster {
  const updated = { ...cluster }
  updated.endTs = Math.max(updated.endTs, bubble.timestamp)
  updated.lastPrice = bubble.price
  updated.priceLow = Math.min(updated.priceLow, bubble.price)
  updated.priceHigh = Math.max(updated.priceHigh, bubble.price)
  updated.cumulativeNotional += bubble.notional
  updated.cumulativeVolume += bubble.volume
  updated.tradeCount++
  updated.rawBubbleIds = [...updated.rawBubbleIds, bubble.id]
  updated.vwapPrice = computeVWAPFromCluster(updated)
  updated.priceChange = updated.lastPrice - updated.firstPrice
  updated.priceChangePct = updated.firstPrice > 0
    ? updated.priceChange / updated.firstPrice
    : 0
  return updated
}

// ═══════════════════════════════════════════
// CLUSTER STATE CLASSIFICATION (P3)
// ═══════════════════════════════════════════

export function classifyCluster(
  cluster: AuctionCluster,
  currentPrice: number,
  candleHigh: number,
  candleLow: number,
  now: number
): AuctionCluster {
  const updated = { ...cluster }
  updated.agePhase = getClusterAgePhase(updated, now)
  if (updated.tradeCount < 1) return updated

  const priceChange = currentPrice - updated.firstPrice
  const priceChangePct = updated.firstPrice > 0 ? priceChange / updated.firstPrice : 0
  const expectedDir = updated.side === 'buy' ? 1 : -1
  const aligned = priceChangePct * expectedDir
  const age = now - updated.startTs

  // State classification
  if (age >= 3_000 && updated.state === 'FORMING') {
    if (!aligned && Math.abs(priceChangePct) < 0.001 && updated.cumulativeNotional > 20_000) {
      updated.state = 'ABSORBED'
      updated.absorptionScore = Math.min(1, updated.cumulativeNotional / 50_000)
    } else if (!aligned && Math.abs(priceChangePct) > 0.002) {
      updated.state = 'REJECTED'
      updated.rejectionScore = Math.min(1, Math.abs(priceChangePct) / 0.005)
    } else if (aligned > 0 && Math.abs(priceChangePct) > 0.001) {
      updated.state = 'ACCEPTED'
      updated.acceptanceScore = Math.min(1, Math.abs(priceChangePct) / 0.003)
    }
  }

  if (age >= 10_000 && updated.state === 'FORMING') {
    if (!aligned && Math.abs(priceChangePct) > 0.003) {
      updated.state = 'REJECTED'
      updated.rejectionScore = 0.75
    } else if (aligned > 0 && Math.abs(priceChangePct) > 0.001) {
      updated.state = 'ACCEPTED'
      updated.acceptanceScore = 0.8
    } else if (Math.abs(priceChangePct) < 0.001) {
      updated.state = 'EXHAUSTED'
    }
  }

  if (age >= 40_000 && updated.state === 'FORMING') {
    updated.state = 'EXHAUSTED'
  }

  // Invalidated: accepted then price returned
  if (updated.state === 'ACCEPTED' && age >= 15_000) {
    const returnDist = Math.abs(currentPrice - updated.firstPrice) / updated.firstPrice
    if (returnDist < 0.002) {
      updated.state = 'INVALIDATED'
      updated.invalidated = true
    }
  }

  // Resistance: repeated rejection at this price zone
  if (updated.state === 'REJECTED' || updated.state === 'ABSORBED') {
    if (updated.tradeCount >= 3 && updated.rejectionScore > 0.5) {
      updated.structuralRole = 'RESISTANCE'
      updated.state = 'RESISTANCE'
      updated.resistanceOrigin = updated.side
    }
  }

  updated.auctionContext = classifyAuctionContext(updated, priceChangePct, aligned)
  updated.priceChange = priceChange
  updated.priceChangePct = priceChangePct

  if (updated.state === 'ACCEPTED' && Math.abs(priceChangePct) > 0.002) {
    updated.flowType = 'initiative'
  } else if (updated.state === 'REJECTED' || updated.state === 'ABSORBED') {
    updated.flowType = 'responsive'
  }

  return updated
}

function classifyAuctionContext(
  cluster: AuctionCluster,
  priceChangePct: number,
  aligned: number
): AuctionContext {
  const { side, state, cumulativeNotional, tradeCount } = cluster

  if (side === 'sell' && state === 'ACCEPTED' && priceChangePct < -0.001) return 'SELL_AUCTION_DOWN'
  if (side === 'buy' && state === 'ACCEPTED' && priceChangePct > 0.001) return 'BUY_AUCTION_UP'
  if (side === 'sell' && state === 'REJECTED' && priceChangePct > 0.001) return 'FAILED_SELL_AUCTION'
  if (side === 'buy' && state === 'REJECTED' && priceChangePct < -0.001) return 'FAILED_BUY_AUCTION'
  if (state === 'ABSORBED' && cumulativeNotional > 15_000) return 'ABSORPTION_AT_LEVEL'
  if (side === 'buy' && state === 'ACCEPTED' && priceChangePct > 0 && priceChangePct < 0.002) return 'RESPONSIVE_BUYING'
  if (side === 'sell' && state === 'ACCEPTED' && priceChangePct < 0 && priceChangePct > -0.002) return 'RESPONSIVE_SELLING'
  if (side === 'buy' && state === 'ACCEPTED' && priceChangePct > 0.002 && tradeCount >= 3) return 'INITIATIVE_BUYING'
  if (side === 'sell' && state === 'ACCEPTED' && priceChangePct < -0.002 && tradeCount >= 3) return 'INITIATIVE_SELLING'
  return 'NONE'
}

// ═══════════════════════════════════════════
// AGE PHASE
// ═══════════════════════════════════════════

const CLUSTER_FRESH_MS = 30_000
const CLUSTER_ACTIVE_MS = 180_000
const CLUSTER_FADE_MS = 600_000
const CLUSTER_EXPIRE_MS = 900_000

export function getClusterAgePhase(cluster: AuctionCluster, now: number): AgePhase {
  const age = now - cluster.endTs
  if (age < 0) return 'FRESH'
  if (age < CLUSTER_FRESH_MS) return 'FRESH'
  if (age < CLUSTER_ACTIVE_MS) return 'ACTIVE'
  if (age < CLUSTER_FADE_MS) return 'FADING'
  return 'EXPIRED'
}

// ═══════════════════════════════════════════
// CLUSTER FORMATION ENGINE
// ═══════════════════════════════════════════

export function formClusters(
  bubbles: Bubble[],
  interval: Interval,
  currentPrice: number,
  candleHigh: number,
  candleLow: number,
  existingClusters: AuctionCluster[] = []
): AuctionCluster[] {
  const now = Date.now()
  const config = getClusterConfig(interval)
  const sorted = [...bubbles].sort((a, b) => a.timestamp - b.timestamp)
  const clusters: AuctionCluster[] = existingClusters.map(c => ({ ...c }))

  for (const bubble of sorted) {
    if (!bubble.price || bubble.price <= 0) continue
    if (!bubble.timestamp || bubble.timestamp <= 0) continue

    let merged = false
    for (let i = clusters.length - 1; i >= 0; i--) {
      if (canMergeIntoCluster(clusters[i], bubble, config, now)) {
        clusters[i] = mergeBubbleIntoCluster(clusters[i], bubble)
        merged = true
        break
      }
    }
    if (!merged) {
      clusters.push(createCluster(bubble))
    }
  }

  const classified = clusters.map(c =>
    classifyCluster(c, currentPrice, candleHigh, candleLow, now)
  )

  const active = classified.filter(c => c.agePhase !== 'EXPIRED')
  return active.slice(-200)
}

// ═══════════════════════════════════════════
// RENDER RELEVANCE (P8 anti-noise)
// ═══════════════════════════════════════════

const MAX_RENDERED_CLUSTERS = 50

export function getRenderableClusters(
  clusters: AuctionCluster[],
  now: number
): AuctionCluster[] {
  const phasePriority: Record<AgePhase, number> = {
    FRESH: 3, ACTIVE: 2, FADING: 1, EXPIRED: 0,
  }

  const scored: Array<{ cluster: AuctionCluster; score: number }> = []
  for (const cluster of clusters) {
    if (cluster.agePhase === 'EXPIRED') continue
    const phase = phasePriority[cluster.agePhase]
    const ageScore = phase * 1_000_000
    const notionalScore = Math.min(999_999, cluster.cumulativeNotional)
    scored.push({ cluster, score: ageScore + notionalScore })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_RENDERED_CLUSTERS).map(s => s.cluster)
}

// ═══════════════════════════════════════════
// DISPLAY MODES (P4)
// ═══════════════════════════════════════════

export type DisplayMode = 'RAW' | 'CLUSTERED' | 'HYBRID'

export interface DisplayConfig {
  mode: DisplayMode
  maxVisibleClusters: number
  minNotionalFilter: number
  hideTinyClusters: boolean
  adaptiveOpacity: boolean
}

export function getDefaultDisplayConfig(): DisplayConfig {
  return {
    mode: 'CLUSTERED',
    maxVisibleClusters: 50,
    minNotionalFilter: 0,
    hideTinyClusters: true,
    adaptiveOpacity: true,
  }
}

// ═══════════════════════════════════════════
// CLUSTER VISUAL STYLE
// ═══════════════════════════════════════════

export interface ClusterVisualStyle {
  fillColor: string
  fillAlpha: number
  strokeColor: string
  strokeAlpha: number
  strokeWidth: number
  dashed: boolean
  radius: number
  sideDirection: number
  sideAccentColor: string
  sideNotchSize: number
  ringStyle: boolean
  brokenOutline: boolean
  showTradeBadge: boolean
}

const CLUSTER_SIDE_STATE_COLORS: Record<string, { fill: string; stroke: string }> = {
  'buy-FORMING':     { fill: '#34d399', stroke: '#34d399' },
  'buy-ACCEPTED':    { fill: '#2dd4a0', stroke: '#2dd4a0' },
  'buy-REJECTED':    { fill: '#f87171', stroke: '#ef4444' },
  'buy-ABSORBED':    { fill: '#2dd4a0', stroke: '#4fc3f7' },
  'buy-EXHAUSTED':   { fill: '#4a7a6a', stroke: '#3d5f52' },
  'buy-INVALIDATED': { fill: '#f97316', stroke: '#ea580c' },
  'buy-RESISTANCE':  { fill: '#a855f7', stroke: '#22c55e' },
  'sell-FORMING':     { fill: '#f87171', stroke: '#f87171' },
  'sell-ACCEPTED':    { fill: '#ef6461', stroke: '#ef6461' },
  'sell-REJECTED':    { fill: '#34d399', stroke: '#2dd4a0' },
  'sell-ABSORBED':    { fill: '#ef6461', stroke: '#4fc3f7' },
  'sell-EXHAUSTED':   { fill: '#7a4a4a', stroke: '#5f3d3d' },
  'sell-INVALIDATED': { fill: '#f97316', stroke: '#ea580c' },
  'sell-RESISTANCE':  { fill: '#a855f7', stroke: '#ef6461' },
}

const CLUSTER_AGE_MODIFIERS: Record<AgePhase, { f: number; s: number; r: number }> = {
  FRESH:   { f: 1.0, s: 1.0, r: 1.0 },
  ACTIVE:  { f: 0.85, s: 0.9, r: 0.95 },
  FADING:  { f: 0.5, s: 0.6, r: 0.85 },
  EXPIRED: { f: 0.0, s: 0.0, r: 0.0 },
}

const CLUSTER_FILL_ALPHA: Record<string, number> = {
  FORMING: 0.18, ACCEPTED: 0.22, REJECTED: 0.18,
  ABSORBED: 0.06, EXHAUSTED: 0.05, INVALIDATED: 0.12, RESISTANCE: 0.14,
}

const CLUSTER_STROKE_ALPHA: Record<string, number> = {
  FORMING: 0.40, ACCEPTED: 0.60, REJECTED: 0.70,
  ABSORBED: 0.80, EXHAUSTED: 0.18, INVALIDATED: 0.55, RESISTANCE: 0.75,
}

const CLUSTER_LINE_WIDTH: Record<string, number> = {
  FORMING: 1.0, ACCEPTED: 1.5, REJECTED: 2.0,
  ABSORBED: 2.5, EXHAUSTED: 0.7, INVALIDATED: 1.5, RESISTANCE: 2.0,
}

const CLUSTER_RADIUS_MIN = 6
const CLUSTER_RADIUS_MAX = 30
const CLUSTER_RADIUS_LOG_MIN = 3   // log10(1000)
const CLUSTER_RADIUS_LOG_MAX = 6   // log10(1_000_000)

/**
 * Compute the complete visual style for an auction cluster.
 *
 * PRIMARY IDENTITY: side (green=buy, red=sell)
 * SECONDARY: state (accepted/rejected/absorbed/exhausted/invalidated/resistance)
 * SIZE: cumulativeNotional (log scale, bounded)
 * AGE: intensity modifier (does NOT erase identity)
 */
export function getClusterVisualStyle(
  cluster: AuctionCluster,
  now: number,
  zoomAlphaScale: number = 1.0
): ClusterVisualStyle {
  const ageMod = CLUSTER_AGE_MODIFIERS[cluster.agePhase]

  // ─── Side × State color lookup ───
  const colorKey = `${cluster.side}-${cluster.state}`
  const colors = CLUSTER_SIDE_STATE_COLORS[colorKey] || CLUSTER_SIDE_STATE_COLORS['buy-EXHAUSTED']

  // ─── Radius: log-scale from cumulativeNotional, bounded ───
  const logNotional = Math.log10(Math.max(1, cluster.cumulativeNotional))
  const normalized = Math.max(0, Math.min(1,
    (logNotional - CLUSTER_RADIUS_LOG_MIN) / (CLUSTER_RADIUS_LOG_MAX - CLUSTER_RADIUS_LOG_MIN)
  ))
  let baseRadius = CLUSTER_RADIUS_MIN + normalized * (CLUSTER_RADIUS_MAX - CLUSTER_RADIUS_MIN)
  if (cluster.cumulativeNotional > 100_000) baseRadius = 34

  // ─── Absorption shrink ───
  let radiusMul = ageMod.r
  if (cluster.state === 'ABSORBED') {
    const absorbedAge = now - cluster.startTs
    if (absorbedAge > 10_000) {
      const shrinkProgress = Math.min(1, (absorbedAge - 10_000) / 110_000)
      radiusMul *= 1 - shrinkProgress * 0.55
    }
  }

  // ─── Trade count bonus (diminishing) ───
  const countBonus = Math.min(1.2, 1 + (cluster.tradeCount - 1) * 0.03)
  const radius = Math.max(CLUSTER_RADIUS_MIN, Math.min(34, baseRadius * radiusMul * countBonus))

  // ─── Fill alpha ───
  const baseFillAlpha = CLUSTER_FILL_ALPHA[cluster.state] ?? 0.15
  const fillAlpha = Math.max(0, Math.min(1, baseFillAlpha * ageMod.f * zoomAlphaScale))

  // ─── Stroke alpha ───
  const baseStrokeAlpha = CLUSTER_STROKE_ALPHA[cluster.state] ?? 0.5
  const strokeAlpha = Math.max(0, Math.min(1, baseStrokeAlpha * ageMod.s * zoomAlphaScale))
  const strokeWidth = CLUSTER_LINE_WIDTH[cluster.state] ?? 1.5

  // ─── Side encoding ───
  const sideDirection = cluster.side === 'buy' ? -1 : 1
  const sideAccentColor = cluster.side === 'buy' ? '#22c55e' : '#ef6461'
  const sideNotchSize = Math.max(3, Math.min(6, radius * 0.3))

  // ─── State-specific modifiers ───
  const ringStyle = cluster.state === 'ABSORBED'
  const brokenOutline = cluster.state === 'INVALIDATED'
  const dashed = cluster.state === 'FORMING' || cluster.state === 'INVALIDATED'

  // ─── Resistance origin accent ───
  let strokeColor = colors.stroke
  if (cluster.state === 'RESISTANCE') {
    strokeColor = cluster.resistanceOrigin === 'sell' ? '#ef6461' : '#22c55e'
  }

  return {
    fillColor: colors.fill,
    fillAlpha,
    strokeColor,
    strokeAlpha,
    strokeWidth,
    dashed,
    radius,
    sideDirection,
    sideAccentColor,
    sideNotchSize,
    ringStyle,
    brokenOutline,
    showTradeBadge: cluster.tradeCount >= 3,
  }
}
