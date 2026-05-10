/**
 * lightweightOverlayRenderer.ts
 *
 * ─── Hybrid Overlay Architecture ───
 *
 * This module renders orderflow methodology overlays on top of
 * TradingView Lightweight Charts. The Lightweight chart handles:
 * - candles, volume, price scale, time scale, zoom, pan, crosshair
 *
 * This overlay handles:
 * - bubbles (aggressive flow events with state/age encoding)
 * - liquidity levels (orderbook bid/ask bands)
 *
 * The overlay canvas is absolutely positioned over the Lightweight chart
 * container with pointer-events: none so it does not block chart interactions.
 *
 * Coordinate mapping uses Lightweight APIs:
 * - chart.timeScale().timeToCoordinate(time) → x
 * - candleSeries.priceToCoordinate(price) → y
 *
 * Do NOT guess coordinates when API coordinates are available.
 */

import type { Bubble, OrderLevel } from '../types/market'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import {
  getBubbleVisualStyle,
  getRenderableBubbles,
} from './bubbleMethodology'
import { getAllLevels, type LevelRecord } from './levelMemory'
import { INTERVAL_MS } from '../types/market'
import type { AuctionCluster, AgePhase } from './auctionClusters'
import { getRenderableClusters } from './auctionClusters'

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export interface OverlayRenderContext {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  dpr: number
  chart: IChartApi
  candleSeries: ISeriesApi<'Candlestick'>
  now: number
  intervalMs: number
  symbol: string
}

// ═══════════════════════════════════════════
// COORDINATE MAPPING
// ═══════════════════════════════════════════

/**
 * Map a bubble's time/price to pixel coordinates using Lightweight APIs.
 * Returns null if coordinates are outside the chart area or invalid.
 */
function getBubblePixelCoords(
  bubble: Bubble,
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>
): { x: number; y: number } | null {
  // Lightweight Charts expects seconds
  const timeSec = Math.floor(bubble.timestamp / 1000)

  const x = chart.timeScale().timeToCoordinate(timeSec as any)
  const y = candleSeries.priceToCoordinate(bubble.price)

  if (x === null || y === null) return null
  if (!isFinite(x) || !isFinite(y)) return null

  return { x, y }
}

/**
 * Map a price level to y-coordinate.
 */
function getLiquidityY(
  price: number,
  candleSeries: ISeriesApi<'Candlestick'>
): number | null {
  const y = candleSeries.priceToCoordinate(price)
  if (y === null || !isFinite(y)) return null
  return y
}

// ═══════════════════════════════════════════
// BUBBLE RENDERING
// ═══════════════════════════════════════════

/**
 * Draw all relevant bubbles on the overlay canvas.
 *
 * Uses the bubble methodology helpers for:
 * - render relevance filtering (shouldRenderBubble)
 * - visual style computation (getBubbleVisualStyle)
 * - age phase classification (getBubbleAgePhase)
 * - priority sorting (getRenderableBubbles)
 */
export function drawHybridBubbles(
  rc: OverlayRenderContext,
  bubbles: Bubble[]
): void {
  if (bubbles.length === 0) return

  const { ctx, width, height, chart, candleSeries, now, intervalMs } = rc

  // Get renderable bubbles (filtered by age, sorted by relevance)
  const renderable = getRenderableBubbles(bubbles, now, intervalMs)
  if (renderable.length === 0) return

  // Compute zoom-adaptive opacity scale based on visible candle count
  const logicalRange = chart.timeScale().getVisibleLogicalRange()
  const visibleCandles = logicalRange
    ? Math.abs((logicalRange.to as number) - (logicalRange.from as number))
    : 100
  // More candles = less detail per bubble
  const zoomAlphaScale = visibleCandles > 200 ? 0.5
    : visibleCandles > 80 ? 0.75
    : visibleCandles > 30 ? 0.9
    : 1.0

  ctx.save()

  for (const bubble of renderable) {
    const coords = getBubblePixelCoords(bubble, chart, candleSeries)
    if (!coords) continue

    const { x, y } = coords

    // Skip if outside chart bounds
    if (x < -30 || x > width + 30) continue
    if (y < -30 || y > height + 30) continue

    // Get visual style from methodology
    const style = getBubbleVisualStyle(bubble, now, intervalMs, zoomAlphaScale)

    if (style.radius < 1) continue
    if (style.fillAlpha < 0.01 && style.strokeAlpha < 0.01) continue

    // ─── Draw circle ───
    ctx.beginPath()
    ctx.arc(x, y, style.radius, 0, Math.PI * 2)

    // Fill — ring-style (absorbed) uses very low fill
    if (style.fillAlpha > 0 && !style.ringStyle) {
      ctx.globalAlpha = style.fillAlpha
      ctx.fillStyle = style.fillColor
      ctx.fill()
    } else if (style.ringStyle) {
      ctx.globalAlpha = Math.min(style.fillAlpha, 0.04)
      ctx.fillStyle = style.fillColor
      ctx.fill()
    }

    // Stroke — state-specific style
    if (style.strokeAlpha > 0) {
      ctx.globalAlpha = style.strokeAlpha
      ctx.strokeStyle = style.strokeColor
      ctx.lineWidth = style.strokeWidth

      if (style.dashed) {
        ctx.setLineDash([3, 2])
      } else {
        ctx.setLineDash([])
      }

      ctx.stroke()
      ctx.setLineDash([])

      // Broken outline for INVALIDATED
      if (style.brokenOutline) {
        ctx.globalAlpha = style.strokeAlpha * 0.6
        ctx.strokeStyle = style.strokeColor
        ctx.lineWidth = 1
        const xLen = style.radius * 0.6
        ctx.beginPath()
        ctx.moveTo(x - xLen, y - xLen)
        ctx.lineTo(x + xLen, y + xLen)
        ctx.moveTo(x + xLen, y - xLen)
        ctx.lineTo(x - xLen, y + xLen)
        ctx.stroke()
      }

      // Resistance outer ring (purple halo)
      if (bubble.state === 'RESISTANCE') {
        ctx.globalAlpha = 0.25
        ctx.strokeStyle = '#a855f7'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(x, y, style.radius + 3, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // ─── Side notch (directional triangle) ───
    if (style.sideNotchSize > 0) {
      ctx.globalAlpha = 0.65
      ctx.fillStyle = style.sideAccentColor
      ctx.beginPath()
      const notchY = y + (style.sideDirection > 0 ? style.radius + 2 : -(style.radius + 2))
      const notchDir = style.sideDirection
      ctx.moveTo(x, notchY + notchDir * style.sideNotchSize)
      ctx.lineTo(x - style.sideNotchSize * 0.6, notchY)
      ctx.lineTo(x + style.sideNotchSize * 0.6, notchY)
      ctx.closePath()
      ctx.fill()
    }

    // ─── Level interaction halo ───
    if (bubble.levelInteraction) {
      ctx.globalAlpha = 0.08
      ctx.fillStyle = style.fillColor
      const haloH = Math.max(2, style.radius * 0.5)
      ctx.fillRect(0, y - haloH / 2, width, haloH)
    }
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

// ═══════════════════════════════════════════
// LIQUIDITY LEVEL RENDERING (P7)
// ═══════════════════════════════════════════

/**
 * Draw orderbook liquidity levels as subtle horizontal bands.
 *
 * Shows top 3 bid and top 3 ask levels nearest to current price.
 * Uses real orderbook data — does not invent levels.
 *
 * TODO: persistent level memory (repeated rejection, absorption at level)
 */
export function drawHybridLiquidityLevels(
  rc: OverlayRenderContext,
  livePrice: number,
  bids: OrderLevel[],
  asks: OrderLevel[]
): void {
  if (!livePrice || livePrice <= 0) return
  if (bids.length === 0 && asks.length === 0) return

  const { ctx, width, height, candleSeries } = rc

  // Select top 3 strongest bid levels below price
  const nearbyBids = bids
    .filter(b => b.price < livePrice)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3)

  // Select top 3 strongest ask levels above price
  const nearbyAsks = asks
    .filter(a => a.price > livePrice)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3)

  const maxQty = Math.max(
    1,
    ...nearbyBids.map(b => b.qty),
    ...nearbyAsks.map(a => a.qty)
  )

  ctx.save()

  // Draw bid liquidity bands (green/cyan)
  for (const bid of nearbyBids) {
    const y = getLiquidityY(bid.price, candleSeries)
    if (y === null || y < 0 || y > height) continue

    const strength = bid.qty / maxQty
    const bandH = Math.max(1, Math.min(3, 1 + strength * 2))
    const alpha = 0.06 + strength * 0.12

    ctx.fillStyle = `rgba(45,212,160,${alpha})`
    ctx.fillRect(0, y - bandH / 2, width, bandH)

    // Label if space allows
    if (width > 200) {
      ctx.fillStyle = `rgba(45,212,160,${alpha + 0.15})`
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('BID LIQ', 4, y - bandH / 2 - 2)
    }
  }

  // Draw ask liquidity bands (red/amber)
  for (const ask of nearbyAsks) {
    const y = getLiquidityY(ask.price, candleSeries)
    if (y === null || y < 0 || y > height) continue

    const strength = ask.qty / maxQty
    const bandH = Math.max(1, Math.min(3, 1 + strength * 2))
    const alpha = 0.06 + strength * 0.12

    ctx.fillStyle = `rgba(239,100,97,${alpha})`
    ctx.fillRect(0, y - bandH / 2, width, bandH)

    if (width > 200) {
      ctx.fillStyle = `rgba(239,100,97,${alpha + 0.15})`
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('ASK LIQ', 4, y + bandH / 2 + 9)
    }
  }

  ctx.restore()
}

// ═══════════════════════════════════════════
// LEVEL MEMORY RENDERING
// ═══════════════════════════════════════════

/**
 * Draw level memory levels as subtle horizontal lines with labels.
 * Only draws levels that have 2+ touches (meaningful interaction).
 * Levels fade over time and are marked with contextual labels.
 */
export function drawHybridLevelMemory(
  rc: OverlayRenderContext,
  livePrice: number
): void {
  const { ctx, width, height, candleSeries } = rc

  const levels = getAllLevels()
  if (levels.length === 0) return

  const now = Date.now()
  const LEVEL_FRESH_MS = 60_000
  const LEVEL_ACTIVE_MS = 600_000
  const LEVEL_FADE_MS = 1_800_000

  ctx.save()

  for (const level of levels) {
    // Only show meaningful levels (2+ touches)
    if (level.touches < 2) continue

    const y = candleSeries.priceToCoordinate(level.price)
    if (y === null || !isFinite(y) || y < 0 || y > height) continue

    // Age-based fading
    const age = now - level.lastTouchedAt
    let alpha = 0.25
    if (age > LEVEL_FADE_MS) alpha = 0.08
    else if (age > LEVEL_ACTIVE_MS) alpha = 0.12
    else if (age > LEVEL_FRESH_MS) alpha = 0.18

    // State-specific color
    let color: string
    let label: string
    switch (level.lastState) {
      case 'REJECTED_LEVEL':
        color = `rgba(239,100,97,${alpha})`
        label = 'REJ LVL'
        break
      case 'ABSORBED_LEVEL':
        color = `rgba(79,195,247,${alpha})`
        label = 'ABSORB LVL'
        break
      case 'FLIPPED_SUPPORT':
        color = `rgba(45,212,160,${alpha})`
        label = 'FLIPPED S'
        break
      case 'FLIPPED_RESISTANCE':
        color = `rgba(228,167,59,${alpha})`
        label = 'FLIPPED R'
        break
      case 'ACCEPTED_LEVEL':
        color = `rgba(45,212,160,${alpha * 0.7})`
        label = 'ACC LVL'
        break
      default:
        color = `rgba(100,130,170,${alpha * 0.5})`
        label = ''
    }

    // Draw subtle horizontal line
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw label if readable
    if (label && width > 250 && alpha > 0.1) {
      ctx.fillStyle = color
      ctx.font = '8px "SF Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText(label, width - 4, y - 3)
    }
  }

  ctx.restore()
}

// ═══════════════════════════════════════════
// CLUSTER RENDERING
// ═══════════════════════════════════════════

const CLUSTER_COLORS: Record<string, { fill: string; stroke: string }> = {
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

const CL_AGE: Record<AgePhase, { f: number; s: number; r: number }> = {
  FRESH: { f: 1, s: 1, r: 1 }, ACTIVE: { f: 0.85, s: 0.9, r: 0.95 },
  FADING: { f: 0.5, s: 0.6, r: 0.85 }, EXPIRED: { f: 0, s: 0, r: 0 },
}
const CL_FILL: Record<string, number> = { FORMING: 0.18, ACCEPTED: 0.22, REJECTED: 0.18, ABSORBED: 0.06, EXHAUSTED: 0.05, INVALIDATED: 0.12, RESISTANCE: 0.14 }
const CL_STROKE: Record<string, number> = { FORMING: 0.4, ACCEPTED: 0.6, REJECTED: 0.7, ABSORBED: 0.8, EXHAUSTED: 0.18, INVALIDATED: 0.55, RESISTANCE: 0.75 }
const CL_LINE: Record<string, number> = { FORMING: 1, ACCEPTED: 1.5, REJECTED: 2, ABSORBED: 2.5, EXHAUSTED: 0.7, INVALIDATED: 1.5, RESISTANCE: 2 }

function drawHybridClusters(rc: OverlayRenderContext, clusters: AuctionCluster[]): void {
  if (clusters.length === 0) return
  const { ctx, width, height, chart, candleSeries, now } = rc
  const renderable = getRenderableClusters(clusters, now)
  if (renderable.length === 0) return

  const logicalRange = chart.timeScale().getVisibleLogicalRange()
  const visibleCandles = logicalRange ? Math.abs((logicalRange.to as number) - (logicalRange.from as number)) : 100
  const zoomAlpha = visibleCandles > 200 ? 0.5 : visibleCandles > 80 ? 0.75 : visibleCandles > 30 ? 0.9 : 1.0

  ctx.save()
  for (const cluster of renderable) {
    const timeSec = Math.floor(cluster.endTs / 1000)
    const x = chart.timeScale().timeToCoordinate(timeSec as any)
    const y = candleSeries.priceToCoordinate(cluster.vwapPrice)
    if (x === null || y === null || !isFinite(x) || !isFinite(y)) continue
    if (x < -40 || x > width + 40 || y < -40 || y > height + 40) continue

    const ageMod = CL_AGE[cluster.agePhase]
    const logN = Math.log10(Math.max(1, cluster.cumulativeNotional))
    const norm = Math.max(0, Math.min(1, (logN - 3) / 3))
    let baseR = 6 + norm * 22
    if (cluster.cumulativeNotional > 100_000) baseR = 34
    let rMul = ageMod.r
    if (cluster.state === 'ABSORBED') {
      const aAge = now - cluster.startTs
      if (aAge > 10_000) rMul *= 1 - Math.min(1, (aAge - 10_000) / 110_000) * 0.55
    }
    const radius = Math.max(6, Math.min(34, baseR * rMul * Math.min(1.2, 1 + (cluster.tradeCount - 1) * 0.03)))

    const ck = `${cluster.side}-${cluster.state}`
    const col = CLUSTER_COLORS[ck] || CLUSTER_COLORS['buy-EXHAUSTED']
    const fa = Math.max(0, Math.min(1, (CL_FILL[cluster.state] ?? 0.15) * ageMod.f * zoomAlpha))
    const sa = Math.max(0, Math.min(1, (CL_STROKE[cluster.state] ?? 0.5) * ageMod.s * zoomAlpha))
    if (radius < 1 || (fa < 0.01 && sa < 0.01)) continue

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    if (cluster.state === 'ABSORBED') { ctx.globalAlpha = Math.min(fa, 0.04) }
    else { ctx.globalAlpha = fa }
    ctx.fillStyle = col.fill
    ctx.fill()

    if (sa > 0) {
      ctx.globalAlpha = sa
      ctx.strokeStyle = col.stroke
      ctx.lineWidth = CL_LINE[cluster.state] ?? 1.5
      ctx.setLineDash(cluster.state === 'FORMING' || cluster.state === 'INVALIDATED' ? [3, 2] : [])
      ctx.stroke()
      ctx.setLineDash([])
      if (cluster.state === 'RESISTANCE') {
        ctx.globalAlpha = 0.25
        ctx.strokeStyle = '#a855f7'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(x, y, radius + 3, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 0.4
        ctx.strokeStyle = cluster.resistanceOrigin === 'sell' ? '#ef6461' : '#22c55e'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Side notch
    const sDir = cluster.side === 'buy' ? -1 : 1
    const ns = Math.max(3, Math.min(6, radius * 0.3))
    ctx.globalAlpha = 0.65
    ctx.fillStyle = cluster.side === 'buy' ? '#22c55e' : '#ef6461'
    ctx.beginPath()
    const ny = y + (sDir > 0 ? radius + 2 : -(radius + 2))
    ctx.moveTo(x, ny + sDir * ns)
    ctx.lineTo(x - ns * 0.6, ny)
    ctx.lineTo(x + ns * 0.6, ny)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ═══════════════════════════════════════════
// FULL OVERLAY REDRAW
// ═══════════════════════════════════════════

/**
 * Perform a complete overlay redraw.
 * Called on: candle update, bubble update, depth update, zoom/pan, resize.
 */
export function drawOverlay(
  rc: OverlayRenderContext,
  bubbles: Bubble[],
  livePrice: number,
  bids: OrderLevel[],
  asks: OrderLevel[],
  options?: {
    showBubbles?: boolean
    showLiquidity?: boolean
    showLevels?: boolean
    clusters?: AuctionCluster[]
    displayMode?: 'RAW' | 'CLUSTERED' | 'HYBRID'
  }
): void {
  const { ctx, width, height, dpr } = rc
  const showBubbles = options?.showBubbles !== false
  const showLiquidity = options?.showLiquidity !== false
  const showLevels = options?.showLevels !== false
  const clusters = options?.clusters
  const displayMode = options?.displayMode || 'CLUSTERED'

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width * dpr, height * dpr)
  ctx.restore()

  if (showLevels) drawHybridLevelMemory(rc, livePrice)
  if (showLiquidity) drawHybridLiquidityLevels(rc, livePrice, bids, asks)

  if (showBubbles) {
    if (displayMode === 'CLUSTERED' && clusters && clusters.length > 0) {
      drawHybridClusters(rc, clusters)
    } else if (displayMode === 'HYBRID' && clusters && clusters.length > 0) {
      drawHybridClusters(rc, clusters)
      drawHybridBubbles(rc, bubbles)
    } else {
      drawHybridBubbles(rc, bubbles)
    }
  }
}
