import type { Candle, VolumeLevel } from '../types/market'

// ─── Modern Color System ───
const COL = {
  bg: '#080c14',
  grid: '#151b28',
  gridMajor: '#1c2436',
  gridText: '#4a5570',
  gridTextBright: '#6a7a98',
  candleUp: '#00d4aa',
  candleDown: '#ff4d6a',
  candleUpDim: 'rgba(0,212,170,0.35)',
  candleDownDim: 'rgba(255,77,106,0.35)',
  wickUp: 'rgba(0,212,170,0.6)',
  wickDown: 'rgba(255,77,106,0.6)',
  volumeUp: 'rgba(0,212,170,0.18)',
  volumeDown: 'rgba(255,77,106,0.18)',
  bubblePending: '#ffb020',
  bubbleAccepted: '#00d4aa',
  bubbleRejected: '#ff4d6a',
  bubbleAbsorbed: '#38bdf8',
  bubbleExhausted: '#525c72',
  crosshair: 'rgba(148,163,184,0.25)',
  crosshairLabel: '#1a2235',
  poc: '#ffb020',
  vwap: '#a78bfa',
  footprintBuy: 'rgba(0,212,170,0.55)',
  footprintSell: 'rgba(255,77,106,0.55)',
  text: '#7a8ba8',
  textBright: '#d0d8e8',
  textDim: '#3a4560',
  surface: '#0e1320',
  surfaceElevated: '#141b2c',
  border: '#1a2236',
  borderLight: '#232d42',
  accent: '#38bdf8',
  accentDim: 'rgba(56,189,248,0.15)',
  amber: '#ffb020',
  amberDim: 'rgba(255,176,32,0.12)',
  violet: '#a78bfa',
  liveDot: '#00d4aa',
  manualDot: '#ffb020',
  priceLine: '#38bdf8',
  priceLineBg: 'rgba(56,189,248,0.12)',
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
  _dragging?: boolean
  _dragAnchorIdx?: number
  _dragAnchorPrice?: number
  _dragStartX?: number
  _dragStartY?: number
}

const MIN_CANDLES = 5
const MAX_CANDLES = 800
const DEFAULT_CANDLES = 120
const BUBBLE_MIN_R = 3
const BUBBLE_MAX_R = 22
const PRICE_SCALE_W = 80
const TIME_AXIS_H = 26
const LEFT_MARGIN = 4

export function createViewState(): ViewState {
  return {
    anchorIndex: 0,
    candlesVisible: DEFAULT_CANDLES,
    priceCenter: 0,
    pricePerPixel: 0.05,
    followLive: true,
  }
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

  // Background
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, width, height)

  if (totalCandles === 0) {
    ctx.fillStyle = COL.text
    ctx.font = '14px "SF Mono", "Fira Code", monospace'
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
  drawGrid(ctx, c, view, width, height)

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

    // Bubbles
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
      // Dashed line across chart
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
      const badgeH = 18
      ctx.fillStyle = COL.priceLine
      ctx.fillRect(c.priceScaleX + 1, priceY - badgeH / 2, badgeW, badgeH)
      ctx.fillStyle = '#000'
      ctx.font = 'bold 11px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(fmtPriceLabel(livePrice), c.priceScaleX + PRICE_SCALE_W / 2, priceY + 4)
    }
  }

  // ─── Crosshair ───
  if (mousePos && mousePos.x > LEFT_MARGIN && mousePos.x < c.priceScaleX && mousePos.y < c.chartH) {
    // Vertical line
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

    // Price label on scale (bigger)
    const crossPrice = c.yToPrice(mousePos.y)
    ctx.fillStyle = COL.crosshairLabel
    ctx.fillRect(c.priceScaleX + 1, mousePos.y - 11, PRICE_SCALE_W - 2, 22)
    ctx.fillStyle = COL.textBright
    ctx.font = '12px "SF Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(fmtPriceLabel(crossPrice), c.priceScaleX + PRICE_SCALE_W / 2, mousePos.y + 4)

    // Time label on axis (bigger)
    const hoverIdx = Math.round(c.xToIndex(mousePos.x))
    if (hoverIdx >= 0 && hoverIdx < totalCandles) {
      const hoverCandle = allCandles[hoverIdx]
      const timeStr = new Date(hoverCandle.openTime).toLocaleTimeString('en-US', { hour12: false })
      const labelW = 70
      ctx.fillStyle = COL.crosshairLabel
      ctx.fillRect(mousePos.x - labelW / 2, c.chartH + 1, labelW, 18)
      ctx.fillStyle = COL.textBright
      ctx.font = '11px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(timeStr, mousePos.x, c.chartH + 14)
    }
  }

  // ─── Price scale ───
  ctx.fillStyle = COL.surface
  ctx.fillRect(c.priceScaleX, 0, PRICE_SCALE_W, height)
  ctx.strokeStyle = COL.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(c.priceScaleX, 0)
  ctx.lineTo(c.priceScaleX, height)
  ctx.stroke()

  // ─── Time axis separator ───
  ctx.strokeStyle = COL.border
  ctx.beginPath()
  ctx.moveTo(0, c.chartH)
  ctx.lineTo(width, c.chartH)
  ctx.stroke()

  // ─── Live indicator dot on time axis ───
  if (view.followLive && totalCandles > 0) {
    const lastX = c.indexToX(totalCandles - 1)
    if (lastX > LEFT_MARGIN && lastX < c.priceScaleX) {
      ctx.fillStyle = COL.liveDot
      ctx.beginPath()
      ctx.arc(lastX, c.chartH + TIME_AXIS_H / 2, 4, 0, Math.PI * 2)
      ctx.fill()
      // Glow
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
  height: number
) {
  // Horizontal price grid
  const priceStep = estimatePriceStep(view.pricePerPixel, c.chartH)
  const topPrice = c.yToPrice(0)
  const botPrice = c.yToPrice(c.chartH)
  const lo = Math.min(topPrice, botPrice)
  const hi = Math.max(topPrice, botPrice)
  const startPrice = Math.ceil(lo / priceStep) * priceStep

  ctx.font = '11px "SF Mono", monospace'
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
    ctx.fillStyle = isMajor ? COL.gridTextBright : COL.gridText
    ctx.fillText(fmtPriceLabel(p), c.priceScaleX - 4, y + 4)
  }

  // Vertical time grid
  const timeStep = Math.max(1, Math.round(view.candlesVisible / 8))
  const allLen = Math.ceil(c.xToIndex(c.priceScaleX))
  const firstIdx = Math.max(0, Math.floor(c.xToIndex(LEFT_MARGIN)))
  const startTick = Math.ceil(firstIdx / timeStep) * timeStep

  ctx.font = '10px "SF Mono", monospace'
  ctx.textAlign = 'center'

  for (let idx = startTick; idx <= allLen; idx += timeStep) {
    const x = c.indexToX(idx)
    if (x < LEFT_MARGIN || x > c.priceScaleX) continue
    ctx.strokeStyle = COL.grid
    ctx.lineWidth = 0.3
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, c.chartH)
    ctx.stroke()

    // Time label at bottom
    if (idx >= 0 && idx < allLen) {
      ctx.fillStyle = COL.gridText
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
      ctx.fillText(timeStr, x, c.chartH + TIME_AXIS_H - 4)
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

// ─── Interaction: Zoom ───
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

// ─── Interaction: Drag (pan) ───
export function handleDragStart(
  e: React.MouseEvent,
  view: ViewState,
  width: number,
  height: number
): ViewState {
  return {
    ...view,
    _dragging: true,
    _dragAnchorIdx: view.anchorIndex,
    _dragAnchorPrice: view.priceCenter,
    _dragStartX: e.clientX,
    _dragStartY: e.clientY,
  }
}

export function handleDragMove(
  e: React.MouseEvent,
  view: ViewState,
  width: number,
  height: number
): ViewState {
  if (!view._dragging) return view

  const chartW = width - PRICE_SCALE_W - LEFT_MARGIN
  const candleW = Math.max(2, chartW / view.candlesVisible)
  const dx = e.clientX - (view._dragStartX ?? e.clientX)
  const dy = e.clientY - (view._dragStartY ?? e.clientY)

  const newView = { ...view }
  newView.anchorIndex = (view._dragAnchorIdx ?? view.anchorIndex) - dx / candleW
  newView.priceCenter = (view._dragAnchorPrice ?? view.priceCenter) + dy * view.pricePerPixel
  newView.followLive = false

  return newView
}

export function handleDragEnd(view: ViewState): ViewState {
  return { ...view, _dragging: false }
}

// ─── Actions ───
export function goLive(view: ViewState): ViewState {
  return { ...view, followLive: true }
}

export function resetView(view: ViewState): ViewState {
  return {
    ...createViewState(),
    followLive: true,
  }
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
