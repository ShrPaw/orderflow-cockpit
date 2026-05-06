import type { Candle, Bubble, VolumeLevel } from '../types/market'

// Colors
const COL = {
  bg: '#0a0e17',
  grid: '#141c2b',
  gridText: '#3d4a5e',
  candleUp: '#22c55e',
  candleDown: '#ef4444',
  candleHistorical: '#374151',
  volumeUp: 'rgba(34,197,94,0.25)',
  volumeDown: 'rgba(239,68,68,0.25)',
  bubblePending: '#f59e0b',
  bubbleAccepted: '#22c55e',
  bubbleRejected: '#ef4444',
  bubbleAbsorbed: '#06b6d4',
  bubbleExhausted: '#6b7280',
  crosshair: 'rgba(148,163,184,0.3)',
  poc: '#f59e0b',
  vwap: '#a855f7',
  footprintBuy: 'rgba(34,197,94,0.6)',
  footprintSell: 'rgba(239,68,68,0.6)',
  text: '#94a3b8',
  textBright: '#e2e8f0',
}

const BUBBLE_COLORS: Record<string, string> = {
  PENDING: COL.bubblePending,
  ACCEPTED: COL.bubbleAccepted,
  REJECTED: COL.bubbleRejected,
  ABSORBED: COL.bubbleAbsorbed,
  EXHAUSTED: COL.bubbleExhausted,
}

interface ViewState {
  centerIndex: number
  candlesVisible: number
  priceCenter: number
  pricePerPixel: number
  followLive: boolean
}

const MIN_CANDLES = 3
const MAX_CANDLES = 600
const DEFAULT_CANDLES = 100
const RIGHT_PAD = 12
const LIVE_POS = 0.80
const BUBBLE_MIN_R = 3
const BUBBLE_MAX_R = 24
const PRICE_SCALE_W = 62

export function createViewState(): ViewState {
  return {
    centerIndex: 0,
    candlesVisible: DEFAULT_CANDLES,
    priceCenter: 0,
    pricePerPixel: 0.05,
    followLive: true,
  }
}

export function renderChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  candles: Candle[],
  currentCandle: Candle | null,
  view: ViewState,
  volumeProfile: VolumeLevel[],
  mousePos: { x: number; y: number } | null
) {
  ctx.save()
  ctx.scale(dpr, dpr)

  const chartH = height * 0.72
  const volH = height * 0.12
  const volTop = chartH
  const priceScaleX = width - PRICE_SCALE_W

  // Background
  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, width, height)

  const allCandles = currentCandle ? [...candles, currentCandle] : candles
  if (allCandles.length === 0) {
    ctx.fillStyle = COL.text
    ctx.font = '14px monospace'
    ctx.textAlign = 'center'
    ctx.fillText('Waiting for data...', width / 2, height / 2)
    ctx.restore()
    return { view, candleXMap: new Map<number, { x: number; w: number }>() }
  }

  // Update view for follow-live
  if (view.followLive) {
    view.centerIndex = allCandles.length - 1
    // Auto-scale price
    const visible = getVisibleCandles(allCandles, view, priceScaleX)
    if (visible.length > 0) {
      const lo = Math.min(...visible.map(c => c.low))
      const hi = Math.max(...visible.map(c => c.high))
      const range = hi - lo || 10
      view.pricePerPixel = range / (chartH * 0.8)
      view.priceCenter = (hi + lo) / 2
    }
  }

  // Candle geometry
  const candleW = Math.max(2, (priceScaleX - RIGHT_PAD) / view.candlesVisible)
  const gap = Math.max(1, candleW * 0.15)
  const bodyW = candleW - gap

  // Price to Y
  const priceToY = (price: number): number => {
    return chartH / 2 - (price - view.priceCenter) / view.pricePerPixel
  }

  const yToPrice = (y: number): number => {
    return view.priceCenter - (y - chartH / 2) * view.pricePerPixel
  }

  // Grid lines
  drawGrid(ctx, width, chartH, priceScaleX, view, priceToY, yToPrice)

  // Volume profile bars (left side)
  if (volumeProfile.length > 0) {
    const maxVol = Math.max(...volumeProfile.map(l => l.total))
    const barMaxW = 60
    for (const level of volumeProfile) {
      const y = priceToY(level.price)
      if (y < 0 || y > chartH) continue
      const w = (level.total / maxVol) * barMaxW
      ctx.fillStyle = level.delta >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'
      ctx.fillRect(0, y - 1, w, 2)
    }
  }

  // Draw candles
  const candleXMap = new Map<number, { x: number; w: number }>()
  const startIdx = Math.max(0, Math.floor(view.centerIndex - view.candlesVisible * LIVE_POS))
  const visibleCandles = allCandles.slice(startIdx, startIdx + view.candlesVisible + RIGHT_PAD)

  for (let i = 0; i < visibleCandles.length; i++) {
    const candle = visibleCandles[i]
    const x = i * candleW
    const cx = x + bodyW / 2

    candleXMap.set(candle.openTime, { x, w: bodyW })

    const isUp = candle.close >= candle.open
    const color = isUp ? COL.candleUp : COL.candleDown

    // Wick
    const wickY1 = priceToY(candle.high)
    const wickY2 = priceToY(candle.low)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, wickY1)
    ctx.lineTo(cx, wickY2)
    ctx.stroke()

    // Body
    const bodyY1 = priceToY(Math.max(candle.open, candle.close))
    const bodyY2 = priceToY(Math.min(candle.open, candle.close))
    const bodyH = Math.max(1, bodyY2 - bodyY1)
    ctx.fillStyle = color
    ctx.fillRect(x, bodyY1, bodyW, bodyH)

    // Footprint cells
    const maxLevel = Math.max(1, ...Object.values(candle.priceMap).map(l => l.total))
    for (const [priceStr, level] of Object.entries(candle.priceMap)) {
      const price = parseFloat(priceStr)
      const ly = priceToY(price)
      if (ly < 0 || ly > chartH) continue
      const ratio = level.total / maxLevel
      const cellW = bodyW * ratio
      const buyRatio = level.total > 0 ? level.buy / level.total : 0.5
      ctx.fillStyle = buyRatio > 0.5
        ? `rgba(34,197,94,${0.15 + ratio * 0.45})`
        : `rgba(239,68,68,${0.15 + ratio * 0.45})`
      ctx.fillRect(x, ly - 2, cellW, 4)
    }

    // Bubbles
    for (const bubble of candle.bubbles) {
      const by = priceToY(bubble.price)
      const notionalScale = Math.min(1, Math.log10(Math.max(1, bubble.notional)) / 6)
      const r = BUBBLE_MIN_R + notionalScale * (BUBBLE_MAX_R - BUBBLE_MIN_R)
      const color = BUBBLE_COLORS[bubble.state] || COL.bubbleExhausted

      ctx.beginPath()
      ctx.arc(cx, by, r, 0, Math.PI * 2)

      if (bubble.state === 'REJECTED') {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        ctx.fillStyle = color + (bubble.state === 'PENDING' ? 'cc' : '88')
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    // Volume bars
    const volY = volTop + volH
    const maxVolCandle = Math.max(1, ...visibleCandles.map(c => c.volume))
    const volBarH = (candle.volume / maxVolCandle) * volH
    ctx.fillStyle = isUp ? COL.volumeUp : COL.volumeDown
    ctx.fillRect(x, volY - volBarH, bodyW, volBarH)
  }

  // Crosshair
  if (mousePos && mousePos.x < priceScaleX && mousePos.y < chartH) {
    ctx.strokeStyle = COL.crosshair
    ctx.lineWidth = 0.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(mousePos.x, 0)
    ctx.lineTo(mousePos.x, chartH)
    ctx.moveTo(0, mousePos.y)
    ctx.lineTo(priceScaleX, mousePos.y)
    ctx.stroke()
    ctx.setLineDash([])

    // Price label
    const crossPrice = yToPrice(mousePos.y)
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(priceScaleX, mousePos.y - 10, PRICE_SCALE_W, 20)
    ctx.fillStyle = COL.textBright
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(fmtPriceLabel(crossPrice), priceScaleX + PRICE_SCALE_W / 2, mousePos.y + 4)
  }

  // Price scale
  ctx.fillStyle = '#111827'
  ctx.fillRect(priceScaleX, 0, PRICE_SCALE_W, height)
  ctx.strokeStyle = COL.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(priceScaleX, 0)
  ctx.lineTo(priceScaleX, height)
  ctx.stroke()

  ctx.restore()

  return { view, candleXMap }
}

function getVisibleCandles(allCandles: Candle[], view: ViewState, chartW: number): Candle[] {
  const startIdx = Math.max(0, Math.floor(view.centerIndex - view.candlesVisible * LIVE_POS))
  return allCandles.slice(startIdx, startIdx + view.candlesVisible + RIGHT_PAD)
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  chartH: number,
  priceScaleX: number,
  view: ViewState,
  priceToY: (p: number) => number,
  yToPrice: (y: number) => number
) {
  ctx.strokeStyle = COL.grid
  ctx.lineWidth = 0.5
  ctx.font = '9px monospace'
  ctx.fillStyle = COL.gridText
  ctx.textAlign = 'right'

  // Horizontal grid lines
  const priceStep = estimatePriceStep(view.pricePerPixel, chartH)
  const topPrice = yToPrice(0)
  const botPrice = yToPrice(chartH)
  const startPrice = Math.ceil(Math.min(topPrice, botPrice) / priceStep) * priceStep
  const endPrice = Math.max(topPrice, botPrice)

  for (let p = startPrice; p <= endPrice; p += priceStep) {
    const y = priceToY(p)
    if (y < 0 || y > chartH) continue
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(priceScaleX, y)
    ctx.stroke()
    ctx.fillText(fmtPriceLabel(p), priceScaleX - 4, y + 3)
  }

  // Separator lines
  ctx.strokeStyle = COL.grid
  ctx.beginPath()
  ctx.moveTo(0, chartH)
  ctx.lineTo(width, chartH)
  ctx.stroke()
}

function estimatePriceStep(ppp: number, height: number): number {
  const targetRange = height * ppp
  const steps = [0.0001, 0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
  const ideal = targetRange / 8
  for (const s of steps) {
    if (s >= ideal) return s
  }
  return steps[steps.length - 1]
}

function fmtPriceLabel(p: number): string {
  if (Math.abs(p) >= 1000) return p.toFixed(0)
  if (Math.abs(p) >= 100) return p.toFixed(1)
  if (Math.abs(p) >= 1) return p.toFixed(2)
  return p.toFixed(4)
}

export function handleWheel(
  e: React.WheelEvent,
  view: ViewState,
  shiftKey: boolean
): ViewState {
  const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
  const newView = { ...view }

  if (shiftKey || e.shiftKey) {
    // Zoom price
    newView.pricePerPixel *= factor
    newView.followLive = false
  } else if (e.ctrlKey || e.metaKey) {
    // Zoom time
    newView.candlesVisible = Math.max(MIN_CANDLES, Math.min(MAX_CANDLES, Math.round(view.candlesVisible * factor)))
    newView.followLive = false
  } else {
    // Default: zoom time
    newView.candlesVisible = Math.max(MIN_CANDLES, Math.min(MAX_CANDLES, Math.round(view.candlesVisible * factor)))
    newView.followLive = false
  }

  return newView
}
