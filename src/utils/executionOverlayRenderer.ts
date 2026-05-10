/**
 * executionOverlayRenderer.ts
 *
 * Draws orderflow methodology overlays on a canvas positioned on top of
 * TradingView Lightweight Charts.
 *
 * Layer order (bottom → top):
 *   1. Liquidity levels (orderbook bid/ask bands)
 *   2. Level memory (horizontal dashed lines)
 *   3. Footprint cells (per-candle volume-at-price)
 *   4. Bubbles (aggressive flow events) — SMART FLOW: always render raw bubbles,
 *      enrich with cluster context when available
 *   5. Tooltip (bubble hover info)
 *   6. Order book state badge (DEGRADED, RESYNCING, etc.)
 *   7. GO LIVE badge / LIVE indicator
 *
 * Coordinate mapping uses Lightweight Charts APIs — no guessing.
 *
 * SAFETY RULES:
 * - Overlay canvas background is always transparent
 * - First operation per frame: clearRect
 * - No full-screen fills except state badge tint (which uses extremely low alpha)
 * - ctx.save()/ctx.restore() around every layer
 * - globalAlpha reset after every layer
 * - Invalid coordinates are skipped
 * - Debug disabled by default (DEBUG_OVERLAY flag)
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { OverlayRenderContext, OverlayFrame } from '../types/executionChart'
import type { Bubble, OrderLevel, OrderBookHealth, Candle } from '../types/market'
import type { AuctionCluster } from '../utils/auctionClusters'
import { getBubbleVisualStyle, getRenderableBubbles } from './bubbleMethodology'
import { getRenderableClusters, getClusterVisualStyle } from './auctionClusters'
import { getAllLevels } from './levelMemory'
import { timePriceToPixel, priceToY, getVisibleCandleCount } from './lightweightCoordinateAdapter'

// ─── Color System — Midnight Slate (matches chartRenderer.ts) ───
const COL = {
  candleUp: '#2dd4a0',
  candleDown: '#ef6461',
  footprintBuy: 'rgba(45,212,160,0.50)',
  footprintSell: 'rgba(239,100,97,0.50)',
  bubblePending: '#e4a73b',
  bubbleAccepted: '#2dd4a0',
  bubbleRejected: '#ef6461',
  bubbleAbsorbed: '#4fc3f7',
  bubbleExhausted: '#4a5e78',
  text: '#6b7d96',
  textBright: '#cdd6e4',
  surface: '#0c1019',
  accent: '#4fc3f7',
  amber: '#e4a73b',
  liveDot: '#2dd4a0',
}

const BUBBLE_MIN_R = 3
const BUBBLE_MAX_R = 22

// ═══════════════════════════════════════════
// FULL OVERLAY REDRAW
// ═══════════════════════════════════════════

/**
 * Perform a complete overlay redraw.
 * Called from the RAF loop when overlay data changes.
 */
// ─── Debug overlay (disabled by default, enable via localStorage) ───
let _debugEnabled: boolean | null = null
function isDebugOverlay(): boolean {
  if (_debugEnabled === null) {
    try { _debugEnabled = localStorage.getItem('DEBUG_OVERLAY') === '1' } catch { _debugEnabled = false }
  }
  return _debugEnabled
}

export function drawExecutionOverlay(rc: OverlayRenderContext): void {
  const { ctx, width, height, dpr, chart, candleSeries, frame } = rc

  // SAFETY: Always start with transparent canvas
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width * dpr, height * dpr)
  ctx.scale(dpr, dpr)

  const visibleCandles = getVisibleCandleCount(chart)
  const zoomAlphaScale = visibleCandles > 200 ? 0.5
    : visibleCandles > 80 ? 0.75
    : visibleCandles > 30 ? 0.9
    : 1.0

  // DEBUG_OVERLAY: Show diagnostic info (localStorage.DEBUG_OVERLAY = '1')
  if (isDebugOverlay()) {
    const allBubbleCount = frame.allCandles.reduce((n, c) => n + c.bubbles.length, 0)
    const clusterCount = frame.clusters.length
    const renderable = getRenderableBubbles(
      frame.allCandles.flatMap(c => c.bubbles), frame.now, frame.intervalMs
    )
    ctx.fillStyle = 'rgba(79,195,247,0.6)'
    ctx.font = '9px "SF Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillText(
      `OVERLAY: ${frame.allCandles.length} candles, ${allBubbleCount} bubbles (${renderable.length} renderable), ${clusterCount} clusters, book:${frame.orderBookHealth}, price:${frame.livePrice.toFixed(1)}`,
      8, height - 24
    )
    ctx.fillText(
      `ZOOM: ${visibleCandles} visible candles, alpha:${zoomAlphaScale.toFixed(2)}`,
      8, height - 8
    )
  }

  // Layer 1: Liquidity levels — uses best available book, dimmed for non-HEALTHY
  // SKIP entirely during transitional states (CONNECTING/BUFFERING/SNAPSHOT_LOADING/SYNCING)
  // — bids/asks in store may be stale from previous connection, not validated
  const isTransitionalState = frame.orderBookHealth === 'CONNECTING'
    || frame.orderBookHealth === 'BUFFERING'
    || frame.orderBookHealth === 'SNAPSHOT_LOADING'
    || frame.orderBookHealth === 'SYNCING'
  if (!isTransitionalState && frame.livePrice > 0 && frame.bids.length > 0 && frame.asks.length > 0) {
    drawLiquidityLevels(rc, zoomAlphaScale)
  }

  // Layer 1.5: Spread line — skip during transitional states
  if (!isTransitionalState && frame.bids.length > 0 && frame.asks.length > 0) {
    drawSpreadLine(rc)
  }

  // Layer 2: Level memory
  if (frame.levelRecords.length > 0) {
    drawLevelMemory(rc)
  }

  // Layer 3: Footprint cells (per-candle) — depends on trade/cluster data, not book health
  drawFootprint(rc, zoomAlphaScale)

  // Layer 4: SMART FLOW Bubbles — always render if trade data exists, regardless of book health
  drawSmartFlowBubbles(rc, zoomAlphaScale)

  // Layer 5: Order book state badge — compact, non-destructive
  drawOrderBookStateBadge(rc)

  // Layer 6: LIVE / GO LIVE badge — drawn by caller (ExecutionChart RAF loop)
  // to capture goLiveRect for click hit-testing. NOT drawn here to avoid double-render.

  // SAFETY: Ensure globalAlpha is reset
  ctx.globalAlpha = 1
  ctx.restore()
}

// ═══════════════════════════════════════════
// LAYER 1: LIQUIDITY LEVELS
// ═══════════════════════════════════════════

function drawLiquidityLevels(rc: OverlayRenderContext, _zoomAlpha: number): void {
  const { ctx, width, height, chart, candleSeries, frame } = rc
  const { livePrice, bids, asks, orderBookHealth } = frame

  // Compute visible price range for proximity filtering
  const visibleRange = chart.timeScale().getVisibleLogicalRange()
  let rangeThreshold = livePrice * 0.02 // default 2%
  if (visibleRange) {
    const pricePerPixel = (livePrice * 0.001) // rough estimate
    rangeThreshold = Math.min(livePrice * 0.02, height * pricePerPixel * 0.3)
  }

  // Filter to nearby levels, then take top 5 by quantity
  // SAFETY: strict distance limit prevents distant levels from creating huge bands
  const maxDist = livePrice * 0.015 // 1.5% max distance
  const nearbyBids = bids
    .filter(b => b.price < livePrice && (livePrice - b.price) < maxDist)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  // Fallback: if not enough nearby, use closer global top-5 but still within 3%
  const effectiveBids = nearbyBids.length >= 3 ? nearbyBids
    : bids.filter(b => b.price < livePrice && (livePrice - b.price) < livePrice * 0.03)
      .sort((a, b) => b.qty - a.qty).slice(0, 5)

  const nearbyAsks = asks
    .filter(a => a.price > livePrice && (a.price - livePrice) < maxDist)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)

  const effectiveAsks = nearbyAsks.length >= 3 ? nearbyAsks
    : asks.filter(a => a.price > livePrice && (a.price - livePrice) < livePrice * 0.03)
      .sort((a, b) => b.qty - a.qty).slice(0, 5)

  const maxQty = Math.max(1, ...effectiveBids.map(b => b.qty), ...effectiveAsks.map(a => a.qty))

  // Dimming for non-HEALTHY states — book-based tool, uses best available book
  const isHealthy = orderBookHealth === 'HEALTHY'
  const stateDimFactor = isHealthy ? 1.0
    : orderBookHealth === 'DEGRADED' ? 0.7
    : orderBookHealth === 'RESYNCING' ? 0.4
    : orderBookHealth === 'STALE' ? 0.25
    : 0.3

  ctx.save()

  for (const bid of effectiveBids) {
    const y = priceToY(bid.price, candleSeries)
    if (y === null || y < 0 || y > height) continue

    const strength = bid.qty / maxQty
    const bandH = Math.max(2, Math.min(6, 2 + strength * 4))
    const alpha = (0.08 + strength * 0.18) * stateDimFactor

    ctx.fillStyle = `rgba(45,212,160,${alpha})`
    ctx.fillRect(0, y - bandH / 2, width, bandH)

    if (width > 250) {
      const qtyLabel = fmtCompactQty(bid.qty)
      ctx.fillStyle = `rgba(45,212,160,${Math.min(0.85, alpha + 0.3)})`
      ctx.font = '10px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`BID ${qtyLabel}`, 6, y + 3)
    }
  }

  for (const ask of effectiveAsks) {
    const y = priceToY(ask.price, candleSeries)
    if (y === null || y < 0 || y > height) continue

    const strength = ask.qty / maxQty
    const bandH = Math.max(2, Math.min(6, 2 + strength * 4))
    const alpha = (0.08 + strength * 0.18) * stateDimFactor

    ctx.fillStyle = `rgba(239,100,97,${alpha})`
    ctx.fillRect(0, y - bandH / 2, width, bandH)

    if (width > 250) {
      const qtyLabel = fmtCompactQty(ask.qty)
      ctx.fillStyle = `rgba(239,100,97,${Math.min(0.85, alpha + 0.3)})`
      ctx.font = '10px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`ASK ${qtyLabel}`, 6, y + 3)
    }
  }

  ctx.restore()
}

// ─── Spread Line ───
function drawSpreadLine(rc: OverlayRenderContext): void {
  const { ctx, width, height, candleSeries, frame } = rc
  const { bids, asks } = frame
  if (bids.length === 0 || asks.length === 0) return

  const bestBid = bids[0].price
  const bestAsk = asks[0].price
  const midPrice = (bestBid + bestAsk) / 2
  const spreadPct = bestBid > 0 ? ((bestAsk - bestBid) / bestBid * 100) : 0

  const y = priceToY(midPrice, candleSeries)
  if (y === null || y < 0 || y > height) return

  ctx.save()
  ctx.strokeStyle = 'rgba(79,195,247,0.20)'
  ctx.lineWidth = 1
  ctx.setLineDash([2, 4])
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(width, y)
  ctx.stroke()
  ctx.setLineDash([])

  if (width > 300) {
    ctx.fillStyle = 'rgba(79,195,247,0.45)'
    ctx.font = '9px "SF Mono", monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`SPREAD ${spreadPct.toFixed(3)}%`, width - 60, y - 4)
  }

  ctx.restore()
}

// ═══════════════════════════════════════════
// LAYER 2: LEVEL MEMORY
// ═══════════════════════════════════════════

function drawLevelMemory(rc: OverlayRenderContext): void {
  const { ctx, width, height, candleSeries, frame } = rc
  const levels = frame.levelRecords

  const now = frame.now
  const LEVEL_FRESH_MS = 60_000
  const LEVEL_ACTIVE_MS = 600_000
  const LEVEL_FADE_MS = 1_800_000

  ctx.save()

  for (const level of levels) {
    if (level.touches < 2) continue

    const y = priceToY(level.price, candleSeries)
    if (y === null || y < 0 || y > height) continue

    const age = now - level.lastTouchedAt
    let alpha = 0.25
    if (age > LEVEL_FADE_MS) alpha = 0.08
    else if (age > LEVEL_ACTIVE_MS) alpha = 0.12
    else if (age > LEVEL_FRESH_MS) alpha = 0.18

    let color: string
    let label: string
    switch (level.lastState) {
      case 'REJECTED_LEVEL':
        color = `rgba(239,100,97,${alpha})`; label = 'REJ LVL'; break
      case 'ABSORBED_LEVEL':
        color = `rgba(79,195,247,${alpha})`; label = 'ABSORB LVL'; break
      case 'FLIPPED_SUPPORT':
        color = `rgba(45,212,160,${alpha})`; label = 'FLIPPED S'; break
      case 'FLIPPED_RESISTANCE':
        color = `rgba(228,167,59,${alpha})`; label = 'FLIPPED R'; break
      case 'ACCEPTED_LEVEL':
        color = `rgba(45,212,160,${alpha * 0.7})`; label = 'ACC LVL'; break
      default:
        color = `rgba(100,130,170,${alpha * 0.5})`; label = ''
    }

    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.setLineDash([])

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
// LAYER 3: FOOTPRINT CELLS
// ═══════════════════════════════════════════

function drawFootprint(rc: OverlayRenderContext, _zoomAlpha: number): void {
  const { ctx, width, height, chart, candleSeries, frame } = rc
  const { allCandles, intervalMs } = frame

  ctx.save()

  for (const candle of allCandles) {
    const entries = Object.entries(candle.priceMap)
    if (entries.length === 0) continue

    const coords = timePriceToPixel(candle.openTime, candle.close, chart, candleSeries)
    if (!coords) continue

    const slotWidth = estimateSlotWidth(chart, intervalMs)
    if (slotWidth < 12) continue

    const sorted = entries
      .map(([p, l]) => ({ price: parseFloat(p), ...l }))
      .filter(e => isFinite(e.price))
      .sort((a, b) => b.total - a.total)
      .slice(0, slotWidth >= 35 ? 40 : 20)

    const maxLevel = Math.max(1, ...sorted.map(l => l.total))

    const bodyLeft = coords.x - slotWidth / 2 + 1
    const bodyRight = coords.x + slotWidth / 2 - 1

    ctx.save()
    ctx.beginPath()
    ctx.rect(bodyLeft, 0, bodyRight - bodyLeft, height)
    ctx.clip()

    for (const level of sorted) {
      const ly = priceToY(level.price, candleSeries)
      if (ly === null || ly < -10 || ly > height + 10) continue

      const ratio = level.total / maxLevel
      const cellW = Math.max(2, Math.min(slotWidth - 2, (slotWidth - 2) * ratio))
      const buyRatio = level.total > 0 ? level.buy / level.total : 0.5
      const alpha = 0.10 + ratio * 0.35

      ctx.fillStyle = buyRatio > 0.5
        ? `rgba(0,212,160,${alpha})`
        : `rgba(239,100,97,${alpha})`
      ctx.fillRect(bodyLeft, ly - 2, cellW, 4)

      if (slotWidth >= 25 && level.total > 0) {
        const fontSize = Math.max(7, Math.min(10, 8))
        ctx.font = `${fontSize}px "SF Mono", monospace`
        ctx.textAlign = 'left'
        ctx.fillStyle = buyRatio > 0.5
          ? `rgba(45,212,160,${Math.min(0.8, alpha + 0.3)})`
          : `rgba(239,100,97,${Math.min(0.8, alpha + 0.3)})`
        const label = level.delta >= 0 ? `+${fmtCompact(level.delta)}` : `${fmtCompact(level.delta)}`
        ctx.fillText(label, bodyLeft + 2, ly + 3)
      }
    }

    ctx.restore()
  }

  ctx.restore()
}

function estimateSlotWidth(chart: IChartApi, intervalMs: number): number {
  const now = Math.floor(Date.now() / 1000)
  const x1 = chart.timeScale().timeToCoordinate(now as any)
  const x2 = chart.timeScale().timeToCoordinate((now + 1) as any)
  if (x1 === null || x2 === null) return 8
  const pxPerSec = Math.abs(x2 - x1)
  return Math.max(2, pxPerSec * (intervalMs / 1000))
}

/**
 * Snap a trade timestamp (ms) to its parent candle's open time (ms).
 * This ensures the time exists in Lightweight Charts data for coordinate mapping.
 */
function snapToCandleTime(timestampMs: number, intervalMs: number): number {
  return Math.floor(timestampMs / intervalMs) * intervalMs
}

// ═══════════════════════════════════════════
// LAYER 4: SMART FLOW BUBBLES
// ═══════════════════════════════════════════
//
// SMART FLOW = always render raw large trade bubbles when available.
// If cluster data exists, enrich tooltip/outline.
// If cluster data does not exist, raw bubbles still render.
// No user-facing mode switch. No blank output.
// Bubbles are trade-based — they draw regardless of orderBookHealth.

function drawSmartFlowBubbles(rc: OverlayRenderContext, zoomAlphaScale: number): void {
  const { ctx, chart, candleSeries, frame } = rc
  const { allCandles, intervalMs, clusters, now } = frame

  // Collect all bubbles from visible candles
  const allBubbles: Bubble[] = []
  for (const candle of allCandles) {
    allBubbles.push(...candle.bubbles)
  }

  if (allBubbles.length === 0 && clusters.length === 0) return

  // Compute per-candle notional percentiles for proper bubble sizing
  const allNotionals = allBubbles.map(b => b.notional).sort((a, b) => a - b)
  const getPercentile = (val: number): number => {
    if (allNotionals.length === 0) return 0.5
    let count = 0
    for (const n of allNotionals) { if (n <= val) count++ }
    return count / allNotionals.length
  }

  // Get renderable clusters (for enrichment context)
  const renderableClusters = clusters.length > 0
    ? getRenderableClusters(clusters, now)
    : []

  // Build set of bubble IDs that are part of clusters (for enrichment)
  const clusteredBubbleIds = new Set(clusters.flatMap(cl => cl.rawBubbleIds))

  // DEV: Track rendering stats
  let drawnCount = 0
  let skippedNullCoord = 0

  ctx.save()

  // Draw cluster outlines first (context layer, below raw bubbles)
  for (const cluster of renderableClusters) {
    drawClusterOutline(ctx, cluster, chart, candleSeries, now, zoomAlphaScale, intervalMs)
    drawnCount++
  }

  // Draw raw bubbles — ALWAYS, regardless of book health
  const renderable = getRenderableBubbles(allBubbles, now, intervalMs)
  for (const bubble of renderable) {
    const pctl = getPercentile(bubble.notional)
    // Use candleTime for x-coordinate (matches chart data points),
    // not bubble.timestamp (exact trade time, may not map in LW Charts)
    const coords = timePriceToPixel(bubble.candleTime, bubble.price, chart, candleSeries)
    if (!coords) { skippedNullCoord++; continue }

    // Enrich: if this bubble is part of a cluster, slightly boost visibility
    const inCluster = clusteredBubbleIds.has(bubble.id)
    const alphaBoost = inCluster ? 1.1 : 1.0

    drawSingleBubble(ctx, bubble, chart, candleSeries, now, intervalMs, zoomAlphaScale * alphaBoost, pctl)
    drawnCount++
  }

  // DEV: Bubble stats overlay (only when DEBUG_OVERLAY enabled)
  if (isDebugOverlay() && (allBubbles.length > 0 || clusters.length > 0)) {
    ctx.fillStyle = 'rgba(228,167,59,0.6)'
    ctx.font = '9px "SF Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`SMART_FLOW: ${allBubbles.length} total, ${renderable.length} renderable, ${drawnCount} drawn, ${skippedNullCoord} nullCoord, ${renderableClusters.length} clusters`, 8, 24)
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

function drawSingleBubble(
  ctx: CanvasRenderingContext2D,
  bubble: Bubble,
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
  now: number,
  intervalMs: number,
  zoomAlphaScale: number,
  notionalPercentile: number = 0.5
): void {
  // Use candleTime for x-coordinate (matches chart data points)
  const coords = timePriceToPixel(bubble.candleTime, bubble.price, chart, candleSeries)
  if (!coords) return
  const { x, y } = coords

  const style = getBubbleVisualStyle(bubble, now, intervalMs, zoomAlphaScale, notionalPercentile)
  if (style.radius < 1) return
  if (style.fillAlpha < 0.01 && style.strokeAlpha < 0.01) return

  ctx.beginPath()
  ctx.arc(x, y, style.radius, 0, Math.PI * 2)

  if (style.fillAlpha > 0 && !style.ringStyle) {
    ctx.globalAlpha = style.fillAlpha
    ctx.fillStyle = style.fillColor
    ctx.fill()
  } else if (style.ringStyle) {
    ctx.globalAlpha = Math.min(style.fillAlpha, 0.04)
    ctx.fillStyle = style.fillColor
    ctx.fill()
  }

  if (style.strokeAlpha > 0) {
    ctx.globalAlpha = style.strokeAlpha
    ctx.strokeStyle = style.strokeColor
    ctx.lineWidth = style.strokeWidth
    if (style.dashed) ctx.setLineDash([3, 2])
    else ctx.setLineDash([])
    ctx.stroke()
    ctx.setLineDash([])

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

    if (bubble.state === 'RESISTANCE') {
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = '#a855f7'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, style.radius + 3, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  if (style.sideNotchSize > 0) {
    ctx.globalAlpha = 0.65
    ctx.fillStyle = style.sideAccentColor
    ctx.beginPath()
    const notchY = y + (style.sideDirection > 0 ? style.radius + 2 : -(style.radius + 2))
    ctx.moveTo(x, notchY + style.sideDirection * style.sideNotchSize)
    ctx.lineTo(x - style.sideNotchSize * 0.6, notchY)
    ctx.lineTo(x + style.sideNotchSize * 0.6, notchY)
    ctx.closePath()
    ctx.fill()
  }

  if (bubble.levelInteraction) {
    ctx.globalAlpha = 0.08
    ctx.fillStyle = style.fillColor
    const haloH = Math.max(2, style.radius * 0.5)
    ctx.fillRect(0, y - haloH / 2, ctx.canvas.width, haloH)
  }

  ctx.globalAlpha = 1
}

/**
 * Draw cluster outline — lightweight visual context behind raw bubbles.
 * Does NOT replace raw bubble rendering. Just shows cluster zone.
 */
function drawClusterOutline(
  ctx: CanvasRenderingContext2D,
  cluster: AuctionCluster,
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
  now: number,
  zoomAlphaScale: number,
  intervalMs: number = 40_000
): void {
  // Snap cluster timestamps to candle open times for coordinate mapping
  // Cluster timestamps are trade times, not chart data points
  const snappedTime = snapToCandleTime(cluster.endTs, intervalMs)
  const coords = timePriceToPixel(snappedTime, cluster.vwapPrice, chart, candleSeries)
    ?? timePriceToPixel(snapToCandleTime(cluster.startTs, intervalMs), cluster.vwapPrice, chart, candleSeries)
  if (!coords) return
  const { x, y } = coords

  const style = getClusterVisualStyle(cluster, now, zoomAlphaScale * 0.3) // lower alpha for outline
  if (style.radius < 1) return

  // Draw a subtle zone ring (not a filled bubble — that's for raw bubbles)
  ctx.save()
  ctx.globalAlpha = Math.min(style.strokeAlpha * 0.4, 0.2)
  ctx.strokeStyle = style.strokeColor
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.arc(x, y, style.radius + 4, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // Trade count badge for clusters with 3+ trades
  if (cluster.tradeCount >= 3) {
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#0c1019'
    ctx.beginPath()
    ctx.arc(x + style.radius * 0.7, y - style.radius * 0.7, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#cdd6e4'
    ctx.font = '8px "SF Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(cluster.tradeCount), x + style.radius * 0.7, y - style.radius * 0.7 + 3)
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

// ═══════════════════════════════════════════
// LAYER 5: TOOLTIP
// ═══════════════════════════════════════════

export function drawBubbleTooltip(
  ctx: CanvasRenderingContext2D,
  bubble: Bubble,
  mouseX: number,
  mouseY: number,
  width: number,
  height: number
): void {
  const side = bubble.side === 'buy' ? 'BUY' : 'SELL'
  const state = bubble.state
  const notional = bubble.notional >= 1000
    ? `$${(bubble.notional / 1000).toFixed(1)}k`
    : `$${bubble.notional.toFixed(0)}`
  const age = Date.now() - bubble.timestamp
  const ageStr = age < 60000 ? `${(age / 1000).toFixed(0)}s ago`
    : age < 3600000 ? `${(age / 60000).toFixed(0)}m ago`
    : `${(age / 3600000).toFixed(1)}h ago`

  const lines = [
    `${side} ${state} · ${notional}`,
    `${bubble.volume.toFixed(4)} @ ${fmtPrice(bubble.price)}`,
    ageStr,
  ]

  ctx.font = '10px "SF Mono", monospace'
  const lineH = 14
  const padX = 8
  const padY = 6
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width))
  const tipW = maxW + padX * 2
  const tipH = lines.length * lineH + padY * 2

  let tipX = mouseX + 16
  let tipY = mouseY - tipH / 2
  if (tipX + tipW > width) tipX = mouseX - tipW - 16
  if (tipY < 0) tipY = 4
  if (tipY + tipH > height) tipY = height - tipH - 4

  ctx.fillStyle = 'rgba(12,16,25,0.92)'
  ctx.strokeStyle = 'rgba(100,130,170,0.25)'
  ctx.lineWidth = 1
  roundRect(ctx, tipX, tipY, tipW, tipH, 4)
  ctx.fill()
  ctx.stroke()

  ctx.textAlign = 'left'
  for (let li = 0; li < lines.length; li++) {
    ctx.fillStyle = li === 0
      ? (bubble.side === 'buy' ? COL.candleUp : COL.candleDown)
      : COL.textBright
    ctx.fillText(lines[li], tipX + padX, tipY + padY + (li + 1) * lineH - 3)
  }
}

// ═══════════════════════════════════════════
// LAYER 6: ORDER BOOK STATE BADGE
// ═══════════════════════════════════════════

const STATE_CONFIG: Record<string, { icon: string; color: string; bgAlpha: number; label: string }> = {
  'DEGRADED':    { icon: '📉', color: '#ef6461', bgAlpha: 0.06, label: 'DEGRADED TOP-20 BOOK' },
  'RESYNCING':   { icon: '🔄', color: '#e4a73b', bgAlpha: 0.04, label: 'RESYNCING — last known book' },
  'STALE':       { icon: '⚠',  color: '#e4a73b', bgAlpha: 0.05, label: 'STALE BOOK' },
  'ERROR':       { icon: '❌', color: '#ef6461', bgAlpha: 0.06, label: 'BOOK ERROR' },
  'SYNCING':     { icon: '⏳', color: '#4fc3f7', bgAlpha: 0.03, label: 'SYNCING…' },
  'BUFFERING':   { icon: '⏳', color: '#4fc3f7', bgAlpha: 0.03, label: 'BUFFERING…' },
  'SNAPSHOT_LOADING': { icon: '⏳', color: '#4fc3f7', bgAlpha: 0.03, label: 'LOADING SNAPSHOT…' },
  'CONNECTING':  { icon: '⏳', color: '#4fc3f7', bgAlpha: 0.03, label: 'CONNECTING…' },
}

function drawOrderBookStateBadge(rc: OverlayRenderContext): void {
  const { ctx, width, height, frame } = rc
  const health = frame.orderBookHealth

  if (health === 'HEALTHY' || health === 'DISCONNECTED') return

  const cfg = STATE_CONFIG[health]
  if (!cfg) return

  // SAFETY: Subtle background tint — very low alpha, only a tint NOT a fill
  ctx.save()
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  // SAFETY: Only draw a tiny badge, NOT a full-screen fill
  // The bgAlpha is kept extremely low (0.03-0.06) — barely perceptible tint
  ctx.fillStyle = hexToRgba(cfg.color, cfg.bgAlpha)
  ctx.fillRect(0, 0, width, height)

  // Badge at top-left
  const badgeText = `${cfg.icon} ${cfg.label}`
  ctx.font = 'bold 10px "SF Mono", monospace'
  const badgeW = ctx.measureText(badgeText).width + 16
  const badgeH = 20
  const badgeX = 8
  const badgeY = 8

  ctx.fillStyle = 'rgba(12,16,25,0.85)'
  ctx.strokeStyle = hexToRgba(cfg.color, 0.4)
  ctx.lineWidth = 1
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = cfg.color
  ctx.textAlign = 'left'
  ctx.fillText(badgeText, badgeX + 8, badgeY + 14)

  ctx.restore()
}

// ═══════════════════════════════════════════
// LAYER 7: LIVE / GO LIVE BADGE
// ═══════════════════════════════════════════

export function drawLiveBadge(rc: OverlayRenderContext): { goLiveRect: { x: number; y: number; w: number; h: number } | null } {
  const { ctx, width, frame } = rc

  ctx.save()

  if (frame.followLive) {
    const pillText = 'LIVE'
    ctx.font = 'bold 10px "SF Mono", monospace'
    const pillW = ctx.measureText(pillText).width + 16
    const pillH = 20
    const pillX = width - pillW - 8
    const pillY = 8

    ctx.fillStyle = 'rgba(45,212,160,0.12)'
    ctx.strokeStyle = 'rgba(45,212,160,0.35)'
    ctx.lineWidth = 1
    roundRect(ctx, pillX, pillY, pillW, pillH, 4)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = COL.liveDot
    ctx.textAlign = 'center'
    ctx.fillText(pillText, pillX + pillW / 2, pillY + 14)

    ctx.restore()
    return { goLiveRect: null }
  } else {
    const pillText = '◉ GO LIVE'
    ctx.font = 'bold 10px "SF Mono", monospace'
    const pillW = ctx.measureText(pillText).width + 16
    const pillH = 20
    const pillX = width - pillW - 8
    const pillY = 8

    ctx.fillStyle = 'rgba(228,167,59,0.10)'
    ctx.strokeStyle = 'rgba(228,167,59,0.30)'
    ctx.lineWidth = 1
    roundRect(ctx, pillX, pillY, pillW, pillH, 4)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = COL.amber
    ctx.textAlign = 'center'
    ctx.fillText(pillText, pillX + pillW / 2, pillY + 14)

    ctx.restore()
    return { goLiveRect: { x: pillX, y: pillY, w: pillW, h: pillH } }
  }
}

// ═══════════════════════════════════════════
// HIT TESTING
// ═══════════════════════════════════════════

export function findClosestBubble(
  mouseX: number,
  mouseY: number,
  frame: OverlayFrame,
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>
): Bubble | null {
  let closest: Bubble | null = null
  let closestDist = 30

  for (const candle of frame.allCandles) {
    for (const bubble of candle.bubbles) {
      // Use candleTime for coordinate mapping (matches chart data)
      const coords = timePriceToPixel(bubble.candleTime, bubble.price, chart, candleSeries)
      if (!coords) continue
      const dist = Math.hypot(coords.x - mouseX, coords.y - mouseY)
      if (dist < closestDist) {
        closestDist = dist
        closest = bubble
      }
    }
  }

  return closest
}

export function findClosestCluster(
  mouseX: number,
  mouseY: number,
  frame: OverlayFrame,
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>
): AuctionCluster | null {
  let closest: AuctionCluster | null = null
  let closestDist = 40

  for (const cluster of frame.clusters) {
    // Snap to candle time for coordinate mapping
    const snappedTime = snapToCandleTime(cluster.endTs, frame.intervalMs)
    const coords = timePriceToPixel(snappedTime, cluster.vwapPrice, chart, candleSeries)
      ?? timePriceToPixel(snapToCandleTime(cluster.startTs, frame.intervalMs), cluster.vwapPrice, chart, candleSeries)
    if (!coords) continue
    const dist = Math.hypot(coords.x - mouseX, coords.y - mouseY)
    if (dist < closestDist) {
      closestDist = dist
      closest = cluster
    }
  }

  return closest
}

export function drawClusterTooltip(
  ctx: CanvasRenderingContext2D,
  cluster: AuctionCluster,
  mouseX: number,
  mouseY: number,
  width: number,
  height: number
): void {
  const side = cluster.side === 'buy' ? 'BUY' : 'SELL'
  const state = cluster.state
  const notional = cluster.cumulativeNotional >= 1000
    ? `$${(cluster.cumulativeNotional / 1000).toFixed(1)}k`
    : `$${cluster.cumulativeNotional.toFixed(0)}`
  const age = Date.now() - cluster.startTs
  const ageStr = age < 60000 ? `${(age / 1000).toFixed(0)}s`
    : age < 3600000 ? `${(age / 60000).toFixed(0)}m`
    : `${(age / 3600000).toFixed(1)}h`

  const lines = [
    `CLUSTER ${side} ${state} · ${notional}`,
    `${cluster.tradeCount} trades · ${cluster.cumulativeVolume.toFixed(4)} vol`,
    `VWAP ${fmtPrice(cluster.vwapPrice)} · age ${ageStr}`,
    `flow: ${cluster.flowType} · absorb: ${(cluster.absorptionScore * 100).toFixed(0)}%`,
  ]

  ctx.font = '10px "SF Mono", monospace'
  const lineH = 14
  const padX = 8
  const padY = 6
  const maxW = Math.max(...lines.map(l => ctx.measureText(l).width))
  const tipW = maxW + padX * 2
  const tipH = lines.length * lineH + padY * 2

  let tipX = mouseX + 16
  let tipY = mouseY - tipH / 2
  if (tipX + tipW > width) tipX = mouseX - tipW - 16
  if (tipY < 0) tipY = 4
  if (tipY + tipH > height) tipY = height - tipH - 4

  ctx.fillStyle = 'rgba(12,16,25,0.92)'
  ctx.strokeStyle = 'rgba(100,130,170,0.25)'
  ctx.lineWidth = 1
  roundRect(ctx, tipX, tipY, tipW, tipH, 4)
  ctx.fill()
  ctx.stroke()

  ctx.textAlign = 'left'
  for (let li = 0; li < lines.length; li++) {
    ctx.fillStyle = li === 0
      ? (cluster.side === 'buy' ? COL.candleUp : COL.candleDown)
      : COL.textBright
    ctx.fillText(lines[li], tipX + padX, tipY + padY + (li + 1) * lineH - 3)
  }
}

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toFixed(0)
}

function fmtCompactQty(qty: number): string {
  if (qty >= 1_000_000) return (qty / 1_000_000).toFixed(1) + 'M'
  if (qty >= 1_000) return (qty / 1_000).toFixed(1) + 'k'
  if (qty >= 100) return qty.toFixed(0)
  if (qty >= 10) return qty.toFixed(1)
  if (qty >= 1) return qty.toFixed(2)
  return qty.toFixed(4)
}

function fmtPrice(price: number): string {
  if (price >= 1000) return price.toFixed(1)
  if (price >= 1) return price.toFixed(4)
  if (price >= 0.001) return price.toFixed(6)
  return price.toFixed(8)
}
