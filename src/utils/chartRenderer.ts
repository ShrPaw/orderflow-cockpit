import type { Candle, VolumeLevel } from '../types/market'

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

const BUBBLE_COLORS: Record<string, string> = {
  PENDING: COL.bubblePending,
  ACCEPTED: COL.bubbleAccepted,
  REJECTED: COL.bubbleRejected,
  ABSORBED: COL.bubbleAbsorbed,
  EXHAUSTED: COL.bubbleExhausted,
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
  _dragAnchorCandlesVisible?: number
  _dragStartX?: number
  _dragStartY?: number
  // Zone hover (for cursor)
  _hoverZone?: 'chart' | 'priceAxis' | 'timeAxis' | null
}

const MIN_CANDLES = 5
const MAX_CANDLES = 800
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
    return chartH / 2 - (price - view.priceCenter) / view.pricePerPixel
  }

  const yToPrice = (y: number): number => {
    return view.priceCenter - (y - chartH / 2) * view.pricePerPixel
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
  livePrice?: number
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

  // ─── Grid ───
  drawGrid(ctx, c, view, width, height, fonts)

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

  // ─── Candles + Footprint + Bubbles ───
  const maxVolCandle = computeMaxVolume(allCandles, c.firstVisibleIdx, c.lastVisibleIdx)

  for (let idx = c.firstVisibleIdx; idx <= c.lastVisibleIdx; idx++) {
    if (idx < 0 || idx >= totalCandles) continue
    const candle = allCandles[idx]
    const x = c.indexToX(idx)
    const cx = x + c.bodyW / 2

    if (x + c.bodyW < 0 || x > c.priceScaleX) continue

    const isUp = candle.close >= candle.open
    const col = isUp ? COL.candleUp : COL.candleDown
    const wickCol = isUp ? COL.wickUp : COL.wickDown

    // Wick
    const wickTop = c.priceToY(candle.high)
    const wickBot = c.priceToY(candle.low)
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

    // Footprint cells
    if (c.bodyW > 10) {
      const entries = Object.entries(candle.priceMap)
      if (entries.length > 0) {
        const maxLevel = Math.max(1, ...entries.map(([, l]) => l.total))
        for (const [priceStr, level] of entries) {
          const price = parseFloat(priceStr)
          const ly = c.priceToY(price)
          if (ly < -5 || ly > c.chartH + 5) continue
          const ratio = level.total / maxLevel
          const cellW = Math.max(2, (c.bodyW - 2) * ratio)
          const buyRatio = level.total > 0 ? level.buy / level.total : 0.5
          const alpha = 0.12 + ratio * 0.4
          ctx.fillStyle = buyRatio > 0.5
            ? `rgba(0,212,170,${alpha})`
            : `rgba(255,77,106,${alpha})`
          ctx.fillRect(x + 1, ly - 2, cellW, 4)
        }
      }
    }

    // Bubbles (unchanged logic)
    if (candle.bubbles.length > 0 && c.bodyW > 3) {
      for (const bubble of candle.bubbles) {
        const by = c.priceToY(bubble.price)
        if (by < -20 || by > c.chartH + 20) continue
        const notionalScale = Math.min(1, Math.log10(Math.max(1, bubble.notional)) / 6)
        const r = Math.max(BUBBLE_MIN_R, Math.min(BUBBLE_MAX_R, BUBBLE_MIN_R + notionalScale * (BUBBLE_MAX_R - BUBBLE_MIN_R)))
        const bCol = BUBBLE_COLORS[bubble.state] || COL.bubbleExhausted

        ctx.beginPath()
        ctx.arc(cx, by, r, 0, Math.PI * 2)

        if (bubble.state === 'REJECTED') {
          ctx.strokeStyle = bCol
          ctx.lineWidth = 1.5
          ctx.stroke()
        } else {
          ctx.globalAlpha = bubble.state === 'PENDING' ? 0.75 : 0.5
          ctx.fillStyle = bCol
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.strokeStyle = bCol
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
      }
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

  // ─── Live Price Line ───
  if (livePrice && livePrice > 0) {
    const priceY = c.priceToY(livePrice)
    if (priceY > 0 && priceY < c.chartH) {
      ctx.strokeStyle = COL.priceLine
      ctx.lineWidth = 0.8
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(LEFT_MARGIN, priceY)
      ctx.lineTo(c.priceScaleX, priceY)
      ctx.stroke()
      ctx.setLineDash([])

      // Price badge on scale
      const badgeW = PRICE_SCALE_W - 2
      const badgeH = 20
      ctx.fillStyle = COL.priceLine
      const badgeY = priceY - badgeH / 2
      ctx.beginPath()
      roundRect(ctx, c.priceScaleX + 1, badgeY, badgeW, badgeH, 3)
      ctx.fill()
      ctx.fillStyle = '#000'
      ctx.font = `bold ${fonts.priceLineBadge}px "SF Mono", monospace`
      ctx.textAlign = 'center'
      ctx.fillText(fmtPriceLabel(livePrice), c.priceScaleX + PRICE_SCALE_W / 2, priceY + 4)
    }
  }

  // ─── Crosshair ───
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
    const scaleSensitivity = 0.008
    const scaleFactor = 1 + dy * scaleSensitivity
    const oldPPP = view._dragAnchorPrice ?? view.pricePerPixel
    newView.pricePerPixel = Math.max(0.000001, oldPPP * Math.max(0.1, scaleFactor))

    // Keep the center price stable
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
  return {
    ...view,
    anchorIndex: totalCandles - 1,
    candlesVisible: Math.max(MIN_CANDLES, Math.min(MAX_CANDLES, totalCandles + 20)),
    followLive: false,
  }
}

export function fitRecent(view: ViewState, totalCandles: number): ViewState {
  const recentCount = Math.min(250, totalCandles)
  return {
    ...view,
    anchorIndex: totalCandles - 1,
    candlesVisible: recentCount + 20,
    followLive: true,
  }
}
