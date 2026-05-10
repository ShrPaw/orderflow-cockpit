import type { Candle, VolumeLevel, OrderLevel, Bubble } from '../types/market'
import { getBubbleVisualStyle, getRenderableBubbles } from './bubbleMethodology'
import { getAllLevels } from './levelMemory'
import type { AuctionCluster } from './auctionClusters'
import { getRenderableClusters, getClusterVisualStyle } from './auctionClusters'

// ─── Color System — Midnight Slate ───
const COL = {
  bg: '#06090f',
  grid: '#121924',
  gridMajor: '#1a2436',
  gridText: '#4a5e78',
  gridTextBright: '#6b8098',
  candleUp: '#2dd4a0',
  candleDown: '#ef6461',
  candleUpDim: 'rgba(45,212,160,0.30)',
  candleDownDim: 'rgba(239,100,97,0.30)',
  wickUp: 'rgba(45,212,160,0.55)',
  wickDown: 'rgba(239,100,97,0.55)',
  volumeUp: 'rgba(45,212,160,0.14)',
  volumeDown: 'rgba(239,100,97,0.14)',
  bubblePending: '#e4a73b',
  bubbleAccepted: '#2dd4a0',
  bubbleRejected: '#ef6461',
  bubbleAbsorbed: '#4fc3f7',
  bubbleExhausted: '#4a5e78',
  crosshair: 'rgba(148,163,184,0.18)',
  crosshairLabel: '#141c28',
  poc: '#e4a73b',
  vwap: '#9c8fd8',
  footprintBuy: 'rgba(45,212,160,0.50)',
  footprintSell: 'rgba(239,100,97,0.50)',
  text: '#6b7d96',
  textBright: '#cdd6e4',
  textDim: '#3d4f68',
  surface: '#0c1019',
  surfaceElevated: '#111723',
  border: '#182030',
  borderLight: '#1f2b40',
  accent: '#4fc3f7',
  accentDim: 'rgba(79,195,247,0.10)',
  amber: '#e4a73b',
  amberDim: 'rgba(228,167,59,0.10)',
  violet: '#9c8fd8',
  liveDot: '#2dd4a0',
  manualDot: '#e4a73b',
  priceLine: '#4fc3f7',
  priceLineBg: 'rgba(79,195,247,0.10)',
  axisBg: '#080d16',
  axisHover: '#0e1520',
}

// ─── View State ───
export interface ViewState {
  anchorIndex: number
  candlesVisible: number
  priceCenter: number
  pricePerPixel: number
  followLive: boolean
  // Drag state
  _dragging?: boolean
  _dragZone?: 'chart' | 'priceAxis' | 'timeAxis'
  _dragAnchorIdx?: number
  _dragAnchorPrice?: number
  _dragAnchorPPP?: number
  _dragAnchorCandlesVisible?: number
  _dragStartX?: number
  _dragStartY?: number
  // Zone hover (for cursor)
  _hoverZone?: 'chart' | 'priceAxis' | 'timeAxis' | null
}

const MIN_CANDLES = 5
const MAX_CANDLES = 1500
const DEFAULT_CANDLES = 120
const BUBBLE_MIN_R = 3
const BUBBLE_MAX_R = 22
const PRICE_SCALE_W = 84
const TIME_AXIS_H = 28
const LEFT_MARGIN = 4

// ─── Adaptive font sizing ───
function getFontSizes(width: number, height: number) {
  const area = width * height
  const scale = Math.min(1.4, Math.max(0.85, Math.sqrt(area) / 900))
  return {
    axisLabel: Math.round(11 * scale),
    axisLabelBright: Math.round(12 * scale),
    crosshairPrice: Math.round(12 * scale),
    crosshairTime: Math.round(11 * scale),
    priceLineBadge: Math.round(11 * scale),
    emptyState: Math.round(14 * scale),
  }
}

export function createViewState(): ViewState {
  return {
    anchorIndex: 0,
    candlesVisible: DEFAULT_CANDLES,
    priceCenter: 0,
    pricePerPixel: 0.05,
    followLive: true,
  }
}

// ─── Hit-zone detection ───
export function detectZone(
  x: number, y: number, width: number, height: number
): 'chart' | 'priceAxis' | 'timeAxis' {
  const chartH = height - TIME_AXIS_H
  const priceScaleX = width - PRICE_SCALE_W

  if (x >= priceScaleX) return 'priceAxis'
  if (y >= chartH) return 'timeAxis'
  return 'chart'
}

// ─── Coordinate helpers ───
function makeCoords(width: number, height: number, view: ViewState) {
  const chartH = height - TIME_AXIS_H
  const chartW = width - PRICE_SCALE_W - LEFT_MARGIN
  const candleW = Math.max(2, chartW / view.candlesVisible)
  const gap = Math.max(0.5, Math.min(3, candleW * 0.1))
  const bodyW = candleW - gap

  const anchorScreenX = view.followLive
    ? chartW * 0.85
    : chartW * 0.5

  const priceToY = (price: number): number => {
    const y = chartH / 2 - (price - view.priceCenter) / view.pricePerPixel
    // Guard against extreme values that would corrupt rendering
    if (!isFinite(y)) return -99999
    return y
  }

  const yToPrice = (y: number): number => {
    const p = view.priceCenter - (y - chartH / 2) * view.pricePerPixel
    if (!isFinite(p)) return 0
    return p
  }

  const candlesFromAnchor = anchorScreenX / candleW
  const firstVisibleIdx = Math.floor(view.anchorIndex - candlesFromAnchor)
  const lastVisibleIdx = Math.ceil(view.anchorIndex + (chartW - anchorScreenX) / candleW)

  const indexToX = (idx: number): number => {
    return LEFT_MARGIN + anchorScreenX + (idx - view.anchorIndex) * candleW
  }

  const xToIndex = (x: number): number => {
    return view.anchorIndex + (x - LEFT_MARGIN - anchorScreenX) / candleW
  }

  return {
    chartH, chartW, candleW, gap, bodyW,
    anchorScreenX, priceToY, yToPrice,
    firstVisibleIdx, lastVisibleIdx,
    indexToX, xToIndex,
    priceScaleX: width - PRICE_SCALE_W,
  }
}

// ─── Main Render ───
export function renderChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  candles: Candle[],
  currentCandle: Candle | null,
  view: ViewState,
  volumeProfile: VolumeLevel[],
  mousePos: { x: number; y: number } | null,
  livePrice?: number,
  bids?: OrderLevel[],
  asks?: OrderLevel[],
  intervalMs?: number,
  clusters?: AuctionCluster[],
  displayMode?: 'RAW' | 'CLUSTERED' | 'HYBRID'
) {
  ctx.save()
  ctx.scale(dpr, dpr)

  const allCandles = currentCandle ? [...candles, currentCandle] : candles
  const totalCandles = allCandles.length
  const fonts = getFontSizes(width, height)

  // Background
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, width, height)

  if (totalCandles === 0) {
    ctx.fillStyle = COL.text
    ctx.font = `${fonts.emptyState}px "SF Mono", "Fira Code", monospace`
    ctx.textAlign = 'center'
    ctx.fillText('Waiting for data…', width / 2, height / 2)
    ctx.restore()
    return { view }
  }

  // ─── Follow-live anchor update ───
  if (view.followLive) {
    view.anchorIndex = totalCandles - 1
    const c = makeCoords(width, height, view)
    const vis = getVisibleCandles(allCandles, c.firstVisibleIdx, c.lastVisibleIdx)
    if (vis.length > 0) {
      const lo = Math.min(...vis.map(v => v.low))
      const hi = Math.max(...vis.map(v => v.high))
      const range = hi - lo || 10
      const padding = range * 0.12
      view.pricePerPixel = (range + padding * 2) / (c.chartH * 0.85)
      view.priceCenter = (hi + lo) / 2
    }
  }

  const c = makeCoords(width, height, view)

  // ─── Grid (drawn in clipped area) ───
  ctx.save()
  ctx.beginPath()
  ctx.rect(LEFT_MARGIN, 0, c.chartW, c.chartH)
  ctx.clip()
  drawGrid(ctx, c, view, width, height, fonts)

  // ─── Orderbook Liquidity Levels ───
  if (livePrice && livePrice > 0 && bids && asks && bids.length > 0 && asks.length > 0) {
    drawLiquidityLevels(ctx, c, livePrice, bids, asks)
  }

  // ─── Volume profile overlay ───
  if (volumeProfile.length > 0) {
    const maxVol = Math.max(1, ...volumeProfile.map(l => l.total))
    const barMaxW = Math.min(80, c.chartW * 0.15)
    for (const level of volumeProfile) {
      const y = c.priceToY(level.price)
      if (y < -5 || y > c.chartH + 5) continue
      const w = (level.total / maxVol) * barMaxW
      ctx.fillStyle = level.delta >= 0 ? 'rgba(0,212,170,0.1)' : 'rgba(255,77,106,0.1)'
      ctx.fillRect(LEFT_MARGIN, y - 1, w, 2)
    }
  }

  // ─── Level Memory overlay ───
  // Subtle horizontal lines at meaningful price levels (2+ interactions)
  const levelRecords = getAllLevels()
  if (levelRecords.length > 0) {
    const now = Date.now()
    const LEVEL_FRESH_MS = 60_000
    const LEVEL_ACTIVE_MS = 600_000
    const LEVEL_FADE_MS = 1_800_000

    for (const level of levelRecords) {
      if (level.touches < 2) continue
      const y = c.priceToY(level.price)
      if (!isFinite(y) || y < -5 || y > c.chartH + 5) continue

      const age = now - level.lastTouchedAt
      let alpha = 0.25
      if (age > LEVEL_FADE_MS) alpha = 0.08
      else if (age > LEVEL_ACTIVE_MS) alpha = 0.12
      else if (age > LEVEL_FRESH_MS) alpha = 0.18

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

      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(LEFT_MARGIN, y)
      ctx.lineTo(c.priceScaleX, y)
      ctx.stroke()
      ctx.setLineDash([])

      if (label && c.chartW > 200 && alpha > 0.1) {
        ctx.fillStyle = color
        ctx.font = '8px "SF Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(label, c.priceScaleX - 4, y - 3)
      }
    }
  }

  // ─── Candles + Footprint + Bubbles ───
  const maxVolCandle = computeMaxVolume(allCandles, c.firstVisibleIdx, c.lastVisibleIdx)

  // Pre-compute cluster data for CLUSTERED and HYBRID modes (outside per-candle loop)
  const mode = displayMode || 'CLUSTERED'
  const now = Date.now()
  const intMs = intervalMs || 40_000
  const renderableClusters = (mode === 'CLUSTERED' || mode === 'HYBRID') && clusters && clusters.length > 0
    ? getRenderableClusters(clusters, now)
    : []
  // For HYBRID: set of all raw bubble IDs that are already clustered (not just renderable)
  const allClusteredBubbleIds = mode === 'HYBRID' && clusters
    ? new Set(clusters.flatMap(cl => cl.rawBubbleIds))
    : new Set<string>()

  for (let idx = c.firstVisibleIdx; idx <= c.lastVisibleIdx; idx++) {
    if (idx < 0 || idx >= totalCandles) continue
    const candle = allCandles[idx]
    const x = c.indexToX(idx)
    const cx = x + c.bodyW / 2

    if (x + c.bodyW < 0 || x > c.priceScaleX) continue

    const isUp = candle.close >= candle.open
    const col = isUp ? COL.candleUp : COL.candleDown
    const wickCol = isUp ? COL.wickUp : COL.wickDown

    // Wick — skip if coordinates are invalid
    const wickTop = c.priceToY(candle.high)
    const wickBot = c.priceToY(candle.low)
    if (!isFinite(wickTop) || !isFinite(wickBot)) continue
    ctx.strokeStyle = wickCol
    ctx.lineWidth = Math.max(0.5, Math.min(1.5, c.bodyW * 0.06))
    ctx.beginPath()
    ctx.moveTo(cx, wickTop)
    ctx.lineTo(cx, wickBot)
    ctx.stroke()

    // Body
    const bodyTop = c.priceToY(Math.max(candle.open, candle.close))
    const bodyBot = c.priceToY(Math.min(candle.open, candle.close))
    const bodyH = Math.max(1, bodyBot - bodyTop)

    if (c.bodyW > 6) {
      ctx.fillStyle = col
      ctx.fillRect(x + 0.5, bodyTop, c.bodyW - 1, bodyH)
    } else {
      ctx.fillStyle = col
      ctx.fillRect(x, bodyTop, c.bodyW, bodyH)
    }

    // Footprint cells — per-candle clipped, strict visibility thresholds
    // Only draw when candle is wide enough AND scale is readable
    if (c.bodyW >= 18) {
      const entries = Object.entries(candle.priceMap)
      if (entries.length > 0) {
        // Cap visible bins to prevent density explosion on wide price scales
        const maxBins = c.bodyW >= 35 ? 40 : 20
        // Sort by total volume to show most significant levels first
        const sorted = entries
          .map(([p, l]) => ({ price: parseFloat(p), ...l }))
          .filter(e => isFinite(e.price))
          .sort((a, b) => b.total - a.total)
          .slice(0, maxBins)

        const maxLevel = Math.max(1, ...sorted.map(l => l.total))

        // Per-candle clip: confine all footprint cells to this candle's body
        ctx.save()
        ctx.beginPath()
        ctx.rect(x + 1, 0, c.bodyW - 2, c.chartH)
        ctx.clip()

        for (const level of sorted) {
          const ly = c.priceToY(level.price)
          if (!isFinite(ly) || ly < -10 || ly > c.chartH + 10) continue

          const ratio = level.total / maxLevel
          const cellW = Math.max(2, Math.min(c.bodyW - 2, (c.bodyW - 2) * ratio))
          const buyRatio = level.total > 0 ? level.buy / level.total : 0.5
          const alpha = 0.12 + ratio * 0.4

          // Cell fill
          ctx.fillStyle = buyRatio > 0.5
            ? `rgba(0,212,160,${alpha})`
            : `rgba(239,100,97,${alpha})`
          ctx.fillRect(x + 1, ly - 2, cellW, 4)

          // Text labels — only when cells are large enough to be readable
          // AND volume is non-trivial
          if (c.bodyW >= 35 && level.total > 0) {
            const cellH = Math.max(4, c.chartH / sorted.length)
            if (cellH >= 7) {
              const fontSize = Math.max(8, Math.min(10, cellH * 0.7))
              ctx.font = `${fontSize}px "SF Mono", monospace`
              ctx.textAlign = 'left'
              ctx.fillStyle = buyRatio > 0.5
                ? `rgba(45,212,160,${Math.min(0.8, alpha + 0.3)})`
                : `rgba(239,100,97,${Math.min(0.8, alpha + 0.3)})`
              const label = level.delta >= 0 ? `+${fmtCompact(level.delta)}` : `${fmtCompact(level.delta)}`
              ctx.fillText(label, x + 3, ly + 3)
            }
          }
        }

        ctx.restore() // end per-candle clip
      }
    }

    // Bubbles — raw event rendering (inside per-candle loop)
    // In CLUSTERED mode, raw bubbles are suppressed (clusters rendered after loop).
    // In RAW mode, all individual bubbles render.
    // In HYBRID mode, only non-clustered fresh raw bubbles render (clusters after loop).
    if (candle.bubbles.length > 0 && c.bodyW > 3) {
      const now = Date.now()
      const intMs = intervalMs || 40_000
      const mode = displayMode || 'CLUSTERED'

      if (mode === 'RAW') {
        // ─── RAW MODE: render every individual bubble ───
        const renderable = getRenderableBubbles(candle.bubbles, now, intMs)
        const zoomAlphaScale = c.bodyW < 6 ? 0.5 : c.bodyW < 10 ? 0.75 : 1.0
        const notionals = renderable.map(b => b.notional).sort((a, b) => a - b)
        const getPercentile = (val: number): number => {
          if (notionals.length === 0) return 0.5
          let count = 0
          for (const n of notionals) { if (n <= val) count++ }
          return count / notionals.length
        }

        for (const bubble of renderable) {
          const by = c.priceToY(bubble.price)
          if (!isFinite(by) || by < -20 || by > c.chartH + 20) continue
          const pctl = getPercentile(bubble.notional)
          const style = getBubbleVisualStyle(bubble, now, intMs, zoomAlphaScale, pctl)
          if (style.radius < 1) continue
          if (style.fillAlpha < 0.01 && style.strokeAlpha < 0.01) continue

          ctx.beginPath()
          ctx.arc(cx, by, style.radius, 0, Math.PI * 2)

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
              ctx.moveTo(cx - xLen, by - xLen)
              ctx.lineTo(cx + xLen, by + xLen)
              ctx.moveTo(cx + xLen, by - xLen)
              ctx.lineTo(cx - xLen, by + xLen)
              ctx.stroke()
            }

            if (bubble.state === 'RESISTANCE') {
              ctx.globalAlpha = 0.25
              ctx.strokeStyle = '#a855f7'
              ctx.lineWidth = 3
              ctx.beginPath()
              ctx.arc(cx, by, style.radius + 3, 0, Math.PI * 2)
              ctx.stroke()
            }
          }

          if (style.sideNotchSize > 0 && c.bodyW >= 6) {
            ctx.globalAlpha = 0.65
            ctx.fillStyle = style.sideAccentColor
            ctx.beginPath()
            const notchY = by + (style.sideDirection > 0 ? style.radius + 2 : -(style.radius + 2))
            const notchDir = style.sideDirection
            ctx.moveTo(cx, notchY + notchDir * style.sideNotchSize)
            ctx.lineTo(cx - style.sideNotchSize * 0.6, notchY)
            ctx.lineTo(cx + style.sideNotchSize * 0.6, notchY)
            ctx.closePath()
            ctx.fill()
          }

          if (bubble.levelInteraction) {
            ctx.globalAlpha = 0.08
            ctx.fillStyle = style.fillColor
            const haloH = Math.max(2, style.radius * 0.5)
            ctx.fillRect(LEFT_MARGIN, by - haloH / 2, c.chartW, haloH)
          }
        }
      } else if (mode === 'HYBRID') {
        // ─── HYBRID RAW PART: only freshest non-clustered raw bubbles ───
        // Cluster IDs are computed once outside the loop (see below)
        const now = Date.now()
        const intMs = intervalMs || 40_000
        const renderable = getRenderableBubbles(candle.bubbles, now, intMs)
          .filter(b => !allClusteredBubbleIds.has(b.id) && (now - b.timestamp) < 10_000)

        for (const bubble of renderable) {
          const by = c.priceToY(bubble.price)
          if (!isFinite(by) || by < -20 || by > c.chartH + 20) continue
          const style = getBubbleVisualStyle(bubble, now, intMs, 0.3)
          if (style.radius < 1) continue
          ctx.beginPath()
          ctx.arc(cx, by, style.radius * 0.7, 0, Math.PI * 2)
          ctx.globalAlpha = style.fillAlpha * 0.4
          ctx.fillStyle = style.fillColor
          ctx.fill()
          ctx.globalAlpha = style.strokeAlpha * 0.4
          ctx.strokeStyle = style.strokeColor
          ctx.lineWidth = style.strokeWidth * 0.7
          ctx.stroke()
        }
      }
      // CLUSTERED mode: no raw bubbles rendered per-candle (clusters below)
      ctx.globalAlpha = 1
    }

    // Volume bar
    if (maxVolCandle > 0) {
      const volBarTop = c.chartH + 4
      const volBarMaxH = TIME_AXIS_H - 8
      const volBarH = (candle.volume / maxVolCandle) * volBarMaxH
      ctx.fillStyle = isUp ? COL.volumeUp : COL.volumeDown
      ctx.fillRect(x, volBarTop + volBarMaxH - volBarH, c.bodyW, volBarH)
    }
  }

  // ─── Auction Cluster rendering (outside per-candle loop) ───
  // Clusters span across candle boundaries, so they render in a single pass.
  if (renderableClusters.length > 0 && c.bodyW > 3) {
    const zoomAlphaScale = c.bodyW < 6 ? 0.5 : c.bodyW < 10 ? 0.75 : 1.0

    for (const cluster of renderableClusters) {
      const clusterCandleIdx = allCandles.findIndex(
        cl => cl.openTime <= cluster.endTs && (cl.openTime + intMs) >= cluster.startTs
      )
      if (clusterCandleIdx < 0) continue

      const clusterX = c.indexToX(clusterCandleIdx)
      const clusterCx = clusterX + c.bodyW / 2
      const clusterY = c.priceToY(cluster.vwapPrice)

      if (!isFinite(clusterY) || clusterY < -30 || clusterY > c.chartH + 30) continue
      drawClusterBubble(ctx, clusterCx, clusterY, cluster, now, zoomAlphaScale, c.bodyW)
    }
    ctx.globalAlpha = 1
  }

  // ─── Live Price Line (clipped to plot area) ───
  if (livePrice && livePrice > 0) {
    const priceY = c.priceToY(livePrice)
    if (priceY > -10 && priceY < c.chartH + 10) {
      ctx.strokeStyle = COL.priceLine
      ctx.lineWidth = 0.8
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(LEFT_MARGIN, priceY)
      ctx.lineTo(c.priceScaleX, priceY)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }


  // Crosshair lines (inside clip area)
  if (mousePos && mousePos.x > LEFT_MARGIN && mousePos.x < c.priceScaleX && mousePos.y < c.chartH) {
    ctx.strokeStyle = COL.crosshair
    ctx.lineWidth = 0.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(mousePos.x, 0)
    ctx.lineTo(mousePos.x, c.chartH)
    ctx.moveTo(LEFT_MARGIN, mousePos.y)
    ctx.lineTo(c.priceScaleX, mousePos.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // End of clipped plot area
  ctx.restore()


  // ─── Crosshair labels (on price scale and time axis, outside clip) ───
  if (mousePos && mousePos.x > LEFT_MARGIN && mousePos.x < c.priceScaleX && mousePos.y < c.chartH) {
    // Price label on scale
    const crossPrice = c.yToPrice(mousePos.y)
    const clH = 22
    ctx.fillStyle = COL.crosshairLabel
    ctx.fillRect(c.priceScaleX + 1, mousePos.y - clH / 2, PRICE_SCALE_W - 2, clH)
    ctx.fillStyle = COL.textBright
    ctx.font = `${fonts.crosshairPrice}px "SF Mono", monospace`
    ctx.textAlign = 'center'
    ctx.fillText(fmtPriceLabel(crossPrice), c.priceScaleX + PRICE_SCALE_W / 2, mousePos.y + 4)

    // Time label on axis
    const hoverIdx = Math.round(c.xToIndex(mousePos.x))
    if (hoverIdx >= 0 && hoverIdx < totalCandles) {
      const hoverCandle = allCandles[hoverIdx]
      const timeStr = new Date(hoverCandle.openTime).toLocaleTimeString('en-US', { hour12: false })
      const labelW = 74
      ctx.fillStyle = COL.crosshairLabel
      ctx.fillRect(mousePos.x - labelW / 2, c.chartH + 1, labelW, 20)
      ctx.fillStyle = COL.textBright
      ctx.font = `${fonts.crosshairTime}px "SF Mono", monospace`
      ctx.textAlign = 'center'
      ctx.fillText(timeStr, mousePos.x, c.chartH + 15)
    }
  }

  // ─── Price scale strip ───
  drawPriceScale(ctx, c, view, width, height, fonts, mousePos)

  // ─── Time axis strip ───
  drawTimeAxis(ctx, c, view, width, height, fonts, totalCandles, mousePos)

  // ─── Live indicator ───
  if (view.followLive && totalCandles > 0) {
    const lastX = c.indexToX(totalCandles - 1)
    if (lastX > LEFT_MARGIN && lastX < c.priceScaleX) {
      ctx.fillStyle = COL.liveDot
      ctx.beginPath()
      ctx.arc(lastX, c.chartH + TIME_AXIS_H / 2, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      ctx.arc(lastX, c.chartH + TIME_AXIS_H / 2, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  ctx.restore()
  return { view }
}

// ─── Price Scale Strip ───
function drawPriceScale(
  ctx: CanvasRenderingContext2D,
  c: ReturnType<typeof makeCoords>,
  view: ViewState,
  width: number,
  height: number,
  fonts: ReturnType<typeof getFontSizes>,
  mousePos: { x: number; y: number } | null
) {
  const isHovered = mousePos && mousePos.x >= c.priceScaleX

  // Background with subtle hover state
  ctx.fillStyle = isHovered ? COL.axisHover : COL.axisBg
  ctx.fillRect(c.priceScaleX, 0, PRICE_SCALE_W, height)

  // Border
  ctx.strokeStyle = isHovered ? COL.borderLight : COL.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(c.priceScaleX, 0)
  ctx.lineTo(c.priceScaleX, height)
  ctx.stroke()

  // Price labels
  const priceStep = estimatePriceStep(view.pricePerPixel, c.chartH)
  const topPrice = c.yToPrice(0)
  const botPrice = c.yToPrice(c.chartH)
  const lo = Math.min(topPrice, botPrice)
  const hi = Math.max(topPrice, botPrice)
  const startPrice = Math.ceil(lo / priceStep) * priceStep

  ctx.textAlign = 'center'
  const labelX = c.priceScaleX + PRICE_SCALE_W / 2

  for (let p = startPrice; p <= hi; p += priceStep) {
    const y = c.priceToY(p)
    if (y < 4 || y > c.chartH - 4) continue
    const isMajor = Math.abs(p % (priceStep * 5)) < priceStep * 0.1

    // Subtle label background for major levels
    if (isMajor) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      ctx.fillRect(c.priceScaleX + 2, y - 8, PRICE_SCALE_W - 4, 16)
    }

    ctx.fillStyle = isMajor ? COL.gridTextBright : COL.gridText
    ctx.font = `${isMajor ? fonts.axisLabelBright : fonts.axisLabel}px "SF Mono", monospace`
    ctx.fillText(fmtPriceLabel(p), labelX, y + 4)
  }

  // Drag hint text when hovered
  if (isHovered && !view._dragging) {
    ctx.fillStyle = 'rgba(56,189,248,0.25)'
    ctx.font = `9px "SF Mono", monospace`
    ctx.fillText('drag to scale', labelX, 14)
  }
}

// ─── Time Axis Strip ───
function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  c: ReturnType<typeof makeCoords>,
  view: ViewState,
  width: number,
  height: number,
  fonts: ReturnType<typeof getFontSizes>,
  totalCandles: number,
  mousePos: { x: number; y: number } | null
) {
  const isHovered = mousePos && mousePos.y >= c.chartH

  // Background
  ctx.fillStyle = isHovered ? COL.axisHover : COL.axisBg
  ctx.fillRect(0, c.chartH, width, TIME_AXIS_H)

  // Border
  ctx.strokeStyle = isHovered ? COL.borderLight : COL.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, c.chartH)
  ctx.lineTo(width, c.chartH)
  ctx.stroke()

  // Time grid + labels
  const timeStep = Math.max(1, Math.round(view.candlesVisible / 8))
  const allLen = Math.ceil(c.xToIndex(c.priceScaleX))
  const firstIdx = Math.max(0, Math.floor(c.xToIndex(LEFT_MARGIN)))
  const startTick = Math.ceil(firstIdx / timeStep) * timeStep

  ctx.textAlign = 'center'

  for (let idx = startTick; idx <= allLen; idx += timeStep) {
    const x = c.indexToX(idx)
    if (x < LEFT_MARGIN || x > c.priceScaleX) continue

    // Vertical grid line
    ctx.strokeStyle = COL.grid
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, c.chartH)
    ctx.stroke()

    // Time label
    if (idx >= 0 && idx < allLen) {
      ctx.fillStyle = COL.gridText
      ctx.font = `${fonts.axisLabel}px "SF Mono", monospace`
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
      ctx.fillText(timeStr, x, c.chartH + TIME_AXIS_H - 6)
    }
  }

  // Drag hint when hovered
  if (isHovered && !view._dragging) {
    ctx.fillStyle = 'rgba(56,189,248,0.25)'
    ctx.font = `9px "SF Mono", monospace`
    ctx.textAlign = 'center'
    ctx.fillText('drag to scale', width / 2, c.chartH + 12)
  }
}

// ─── Rounded rect helper ───
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// ═══════════════════════════════════════════
// CLUSTER BUBBLE RENDERING
// Uses getClusterVisualStyle from auctionClusters.ts
// ═══════════════════════════════════════════

function drawClusterBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cluster: AuctionCluster,
  now: number,
  zoomAlphaScale: number,
  candleWidth: number
) {
  const style = getClusterVisualStyle(cluster, now, zoomAlphaScale)

  if (style.radius < 1 || (style.fillAlpha < 0.01 && style.strokeAlpha < 0.01)) return

  // ─── Draw circle ───
  ctx.beginPath()
  ctx.arc(cx, cy, style.radius, 0, Math.PI * 2)

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
      ctx.moveTo(cx - xLen, cy - xLen)
      ctx.lineTo(cx + xLen, cy + xLen)
      ctx.moveTo(cx + xLen, cy - xLen)
      ctx.lineTo(cx - xLen, cy + xLen)
      ctx.stroke()
    }

    if (cluster.state === 'RESISTANCE') {
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = '#a855f7'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(cx, cy, style.radius + 3, 0, Math.PI * 2)
      ctx.stroke()
      // Origin accent
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = cluster.resistanceOrigin === 'sell' ? '#ef6461' : '#22c55e'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, style.radius + 5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // ─── Trade count badge ───
  if (style.showTradeBadge && candleWidth >= 10) {
    ctx.globalAlpha = 0.7
    ctx.fillStyle = '#0c1019'
    ctx.beginPath()
    ctx.arc(cx + style.radius * 0.7, cy - style.radius * 0.7, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#cdd6e4'
    ctx.font = '8px "SF Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(String(cluster.tradeCount), cx + style.radius * 0.7, cy - style.radius * 0.7 + 3)
  }

  // ─── Side notch ───
  if (candleWidth >= 6 && style.sideNotchSize > 0) {
    ctx.globalAlpha = 0.65
    ctx.fillStyle = style.sideAccentColor
    ctx.beginPath()
    const notchY = cy + (style.sideDirection > 0 ? style.radius + 2 : -(style.radius + 2))
    ctx.moveTo(cx, notchY + style.sideDirection * style.sideNotchSize)
    ctx.lineTo(cx - style.sideNotchSize * 0.6, notchY)
    ctx.lineTo(cx + style.sideNotchSize * 0.6, notchY)
    ctx.closePath()
    ctx.fill()
  }

  ctx.globalAlpha = 1
}

function getVisibleCandles(allCandles: Candle[], first: number, last: number): Candle[] {
  const lo = Math.max(0, first)
  const hi = Math.min(allCandles.length - 1, last)
  return allCandles.slice(lo, hi + 1)
}

function computeMaxVolume(allCandles: Candle[], first: number, last: number): number {
  let max = 0
  const lo = Math.max(0, first)
  const hi = Math.min(allCandles.length - 1, last)
  for (let i = lo; i <= hi; i++) {
    if (allCandles[i].volume > max) max = allCandles[i].volume
  }
  return max
}

// ─── Grid ───
function drawGrid(
  ctx: CanvasRenderingContext2D,
  c: ReturnType<typeof makeCoords>,
  view: ViewState,
  width: number,
  height: number,
  fonts: ReturnType<typeof getFontSizes>
) {
  const priceStep = estimatePriceStep(view.pricePerPixel, c.chartH)
  const topPrice = c.yToPrice(0)
  const botPrice = c.yToPrice(c.chartH)
  const lo = Math.min(topPrice, botPrice)
  const hi = Math.max(topPrice, botPrice)
  const startPrice = Math.ceil(lo / priceStep) * priceStep

  ctx.textAlign = 'right'

  for (let p = startPrice; p <= hi; p += priceStep) {
    const y = c.priceToY(p)
    if (y < 0 || y > c.chartH) continue
    const isMajor = Math.abs(p % (priceStep * 5)) < priceStep * 0.1
    ctx.strokeStyle = isMajor ? COL.gridMajor : COL.grid
    ctx.lineWidth = isMajor ? 0.6 : 0.3
    ctx.beginPath()
    ctx.moveTo(LEFT_MARGIN, y)
    ctx.lineTo(c.priceScaleX, y)
    ctx.stroke()
  }
}

// ─── Orderbook Liquidity Levels ───
function drawLiquidityLevels(
  ctx: CanvasRenderingContext2D,
  c: ReturnType<typeof makeCoords>,
  livePrice: number,
  bids: OrderLevel[],
  asks: OrderLevel[],
) {
  // Only show levels near current price (within ~2% range)
  const topPrice = c.yToPrice(0)
  const botPrice = c.yToPrice(c.chartH)
  const visibleRange = Math.abs(topPrice - botPrice)
  const rangeThreshold = Math.min(livePrice * 0.02, visibleRange * 0.3)

  // Top 3 strongest bid levels (below price)
  const nearbyBids = bids
    .filter(b => b.price < livePrice && (livePrice - b.price) < rangeThreshold)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3)

  // Top 3 strongest ask levels (above price)
  const nearbyAsks = asks
    .filter(a => a.price > livePrice && (a.price - livePrice) < rangeThreshold)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3)

  const maxQty = Math.max(1, ...nearbyBids.map(b => b.qty), ...nearbyAsks.map(a => a.qty))

  // Draw bid liquidity as subtle green/cyan bands
  for (const bid of nearbyBids) {
    const y = c.priceToY(bid.price)
    if (!isFinite(y) || y < 0 || y > c.chartH) continue
    const strength = bid.qty / maxQty
    const bandH = Math.max(1, Math.min(3, 1 + strength * 2))
    const alpha = 0.06 + strength * 0.12

    ctx.fillStyle = `rgba(45,212,160,${alpha})`
    ctx.fillRect(LEFT_MARGIN, y - bandH / 2, c.chartW, bandH)

    // Subtle label if readable
    if (c.chartW > 200) {
      ctx.fillStyle = `rgba(45,212,160,${alpha + 0.15})`
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('BID', LEFT_MARGIN + 4, y - bandH / 2 - 2)
    }
  }

  // Draw ask liquidity as subtle red/amber bands
  for (const ask of nearbyAsks) {
    const y = c.priceToY(ask.price)
    if (!isFinite(y) || y < 0 || y > c.chartH) continue
    const strength = ask.qty / maxQty
    const bandH = Math.max(1, Math.min(3, 1 + strength * 2))
    const alpha = 0.06 + strength * 0.12

    ctx.fillStyle = `rgba(239,100,97,${alpha})`
    ctx.fillRect(LEFT_MARGIN, y - bandH / 2, c.chartW, bandH)

    if (c.chartW > 200) {
      ctx.fillStyle = `rgba(239,100,97,${alpha + 0.15})`
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText('ASK', LEFT_MARGIN + 4, y + bandH / 2 + 9)
    }
  }
}

function estimatePriceStep(ppp: number, height: number): number {
  const targetRange = height * ppp
  const steps = [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
  const ideal = targetRange / 8
  for (const s of steps) {
    if (s >= ideal) return s
  }
  return steps[steps.length - 1]
}

function fmtPriceLabel(p: number): string {
  if (Math.abs(p) >= 10000) return p.toFixed(0)
  if (Math.abs(p) >= 1000) return p.toFixed(1)
  if (Math.abs(p) >= 100) return p.toFixed(1)
  if (Math.abs(p) >= 1) return p.toFixed(2)
  if (Math.abs(p) >= 0.01) return p.toFixed(4)
  return p.toFixed(6)
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1000) return (n / 1000).toFixed(1) + 'k'
  if (abs >= 100) return n.toFixed(0)
  if (abs >= 1) return n.toFixed(1)
  return n.toFixed(2)
}

// ═══════════════════════════════════════════
// INTERACTION HANDLERS
// ═══════════════════════════════════════════

// ─── Wheel Zoom (unchanged core, enhanced) ───
export function handleWheel(
  e: React.WheelEvent,
  view: ViewState,
  width: number,
  height: number,
  mousePos: { x: number; y: number } | null
): ViewState {
  const newView = { ...view }
  const chartW = width - PRICE_SCALE_W - LEFT_MARGIN
  const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08

  const c = makeCoords(width, height, view)
  const focalIdx = mousePos ? c.xToIndex(mousePos.x) : view.anchorIndex

  const overPriceScale = mousePos && mousePos.x > width - PRICE_SCALE_W

  // Price-axis or shift: vertical zoom
  if (overPriceScale || e.shiftKey) {
    newView.pricePerPixel *= factor
    if (mousePos && mousePos.y > 0 && mousePos.y < height - TIME_AXIS_H) {
      const priceAtMouse = c.yToPrice(mousePos.y)
      const newChartH = height - TIME_AXIS_H
      newView.priceCenter = priceAtMouse + (mousePos.y - newChartH / 2) * newView.pricePerPixel
    }
    newView.followLive = false
    return newView
  }

  // Ctrl: vertical zoom
  if (e.ctrlKey || e.metaKey) {
    newView.pricePerPixel *= factor
    if (mousePos && mousePos.y > 0 && mousePos.y < height - TIME_AXIS_H) {
      const priceAtMouse = c.yToPrice(mousePos.y)
      const newChartH = height - TIME_AXIS_H
      newView.priceCenter = priceAtMouse + (mousePos.y - newChartH / 2) * newView.pricePerPixel
    }
    newView.followLive = false
    return newView
  }

  // Horizontal zoom — preserve focal point
  const oldVisible = view.candlesVisible
  newView.candlesVisible = Math.max(MIN_CANDLES, Math.min(MAX_CANDLES, Math.round(oldVisible * factor)))

  const oldCandleW = Math.max(2, chartW / oldVisible)
  const newCandleW = Math.max(2, chartW / newView.candlesVisible)
  const anchorScreenX = view.followLive ? chartW * 0.85 : chartW * 0.5
  const focalScreenX = anchorScreenX + (focalIdx - view.anchorIndex) * oldCandleW

  if (view.followLive) {
    const newAnchorScreenX = chartW * 0.85
    newView.anchorIndex = focalIdx - (focalScreenX - newAnchorScreenX) / newCandleW
    const totalCandles = Math.ceil(c.xToIndex(c.priceScaleX)) + 10
    newView.anchorIndex = Math.min(newView.anchorIndex, totalCandles)
  } else {
    const newAnchorScreenX = chartW * 0.5
    newView.anchorIndex = focalIdx - (focalScreenX - newAnchorScreenX) / newCandleW
  }

  newView.followLive = false
  return newView
}

// ─── Drag Start — zone-aware ───
export function handleDragStart(
  e: React.MouseEvent,
  view: ViewState,
  width: number,
  height: number
): ViewState {
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const zone = detectZone(x, y, width, height)

  return {
    ...view,
    _dragging: true,
    _dragZone: zone,
    _dragAnchorIdx: view.anchorIndex,
    _dragAnchorPrice: view.priceCenter,
    _dragAnchorPPP: view.pricePerPixel,
    _dragAnchorCandlesVisible: view.candlesVisible,
    _dragStartX: e.clientX,
    _dragStartY: e.clientY,
  }
}

// ─── Drag Move — zone-aware ───
export function handleDragMove(
  e: React.MouseEvent,
  view: ViewState,
  width: number,
  height: number
): ViewState {
  if (!view._dragging) return view

  const dx = e.clientX - (view._dragStartX ?? e.clientX)
  const dy = e.clientY - (view._dragStartY ?? e.clientY)
  const zone = view._dragZone || 'chart'

  const newView = { ...view }

  if (zone === 'priceAxis') {
    // ─── Price-axis drag: vertical scaling ───
    // Dragging up = compress (more price range visible)
    // Dragging down = expand (less price range, candles taller)
    // BUGFIX: Use the ANCHORED ppp from drag start, not the live one.
    // Using live ppp causes cumulative drift that corrupts the chart.
    const scaleSensitivity = 0.008
    const scaleFactor = 1 + dy * scaleSensitivity
    const anchorPPP = view._dragAnchorPPP ?? view.pricePerPixel
    newView.pricePerPixel = Math.max(0.000001, anchorPPP * Math.max(0.1, scaleFactor))

    // Keep the center price stable — don't recalculate from mouse
    newView.priceCenter = view.priceCenter
    newView.anchorIndex = view._dragAnchorIdx ?? view.anchorIndex
    newView.candlesVisible = view._dragAnchorCandlesVisible ?? view.candlesVisible
    newView.followLive = false

  } else if (zone === 'timeAxis') {
    // ─── Time-axis drag: horizontal scaling ───
    // Dragging right = compress (more candles visible, narrower)
    // Dragging left = expand (fewer candles, wider)
    const chartW = width - PRICE_SCALE_W - LEFT_MARGIN
    const oldVisible = view._dragAnchorCandlesVisible ?? view.candlesVisible
    const scaleSensitivity = 0.005
    const scaleFactor = Math.max(0.2, 1 + dx * scaleSensitivity)
    newView.candlesVisible = Math.max(MIN_CANDLES, Math.min(MAX_CANDLES, Math.round(oldVisible * scaleFactor)))

    // Adjust anchor to keep the focal point stable
    const oldCandleW = Math.max(2, chartW / oldVisible)
    const newCandleW = Math.max(2, chartW / newView.candlesVisible)
    const anchorScreenX = view.followLive ? chartW * 0.85 : chartW * 0.5
    // Use the center of the chart as focal point for time-axis scaling
    const focalIdx = (view._dragAnchorIdx ?? view.anchorIndex)
    const focalScreenX = anchorScreenX + (focalIdx - (view._dragAnchorIdx ?? view.anchorIndex)) * oldCandleW
    const newAnchorScreenX = view.followLive ? chartW * 0.85 : chartW * 0.5
    newView.anchorIndex = focalIdx - (focalScreenX - newAnchorScreenX) / newCandleW

    newView.priceCenter = view.priceCenter
    newView.followLive = false

  } else {
    // ─── Chart area drag: panning (unchanged behavior) ───
    const chartW = width - PRICE_SCALE_W - LEFT_MARGIN
    const candleW = Math.max(2, chartW / view.candlesVisible)
    newView.anchorIndex = (view._dragAnchorIdx ?? view.anchorIndex) - dx / candleW
    newView.priceCenter = (view._dragAnchorPrice ?? view.priceCenter) + dy * view.pricePerPixel
    newView.followLive = false
  }

  return newView
}

export function handleDragEnd(view: ViewState): ViewState {
  return { ...view, _dragging: false, _dragZone: undefined }
}

// ─── Hover zone detection (for cursor) ───
export function getHoverCursor(
  mousePos: { x: number; y: number } | null,
  width: number,
  height: number,
  dragging: boolean
): string {
  if (dragging) return 'grabbing'
  if (!mousePos) return 'crosshair'
  const zone = detectZone(mousePos.x, mousePos.y, width, height)
  if (zone === 'priceAxis') return 'ns-resize'
  if (zone === 'timeAxis') return 'ew-resize'
  return 'crosshair'
}

// ─── Actions ───
export function goLive(view: ViewState): ViewState {
  return { ...view, followLive: true }
}

export function resetView(view: ViewState): ViewState {
  return { ...createViewState(), followLive: true }
}

export function fitAllData(view: ViewState, totalCandles: number, width: number, height: number): ViewState {
  if (totalCandles === 0) return view
  // Don't try to show more candles than can be readable.
  // With a minimum candle width of ~3px, we can show about width/3 candles.
  // Cap at a reasonable amount so candles stay readable.
  const chartW = width - PRICE_SCALE_W - LEFT_MARGIN
  const maxReadable = Math.max(MIN_CANDLES, Math.floor(chartW / 3))
  const visible = Math.min(totalCandles, maxReadable, MAX_CANDLES)
  return {
    ...view,
    anchorIndex: totalCandles - 1,
    candlesVisible: visible,
    followLive: false,
  }
}

export function fitRecent(view: ViewState, totalCandles: number): ViewState {
  const recentCount = Math.min(200, totalCandles)
  return {
    ...view,
    anchorIndex: totalCandles - 1,
    candlesVisible: Math.max(MIN_CANDLES, recentCount),
    followLive: true,
  }
}
