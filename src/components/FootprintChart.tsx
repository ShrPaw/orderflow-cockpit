import { useRef, useEffect, useState, useCallback } from 'react'
import { useMarketStore } from '../stores/marketStore'
import type { Candle } from '../types/market'
import { fmtPrice } from '../utils/formatters'

const COL = {
  bg: '#06090f',
  panelBg: '#0c1019',
  border: '#182030',
  gridLine: '#121924',
  textPrimary: '#cdd6e4',
  textSecondary: '#6b7d96',
  textDim: '#3d4f68',
  green: '#2dd4a0',
  greenSoft: 'rgba(45,212,160,0.35)',
  greenDim: 'rgba(45,212,160,0.08)',
  red: '#ef6461',
  redSoft: 'rgba(239,100,97,0.35)',
  redDim: 'rgba(239,100,97,0.08)',
  cyan: '#4fc3f7',
  headerBg: '#111723',
  cellHighlight: 'rgba(79,195,247,0.06)',
  imbalanceBg: 'rgba(228,167,59,0.08)',
}

const PRICE_COL_W = 72
const DELTA_COL_W = 52
const CELL_MIN_W = 64
const CELL_H = 16
const HEADER_H = 20
const SCROLL_W = 4

export default function FootprintChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollYRef = useRef(0)
  const [size, setSize] = useState({ width: 400, height: 200 })
  const dragRef = useRef<{ startY: number; startScroll: number } | null>(null)

  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const symbol = useMarketStore(s => s.symbol)

  const allCandles = currentCandle ? [...candles, currentCandle] : candles
  // Show last N candles (based on width)
  const visibleCount = Math.max(3, Math.floor((size.width - PRICE_COL_W - DELTA_COL_W) / CELL_MIN_W))
  const visibleCandles = allCandles.slice(-visibleCount)

  // Build unified price levels from visible candles
  const priceLevels = useCallback(() => {
    const priceSet = new Set<string>()
    for (const c of visibleCandles) {
      for (const p of Object.keys(c.priceMap)) {
        priceSet.add(p)
      }
    }
    return Array.from(priceSet).sort((a, b) => parseFloat(b) - parseFloat(a))
  }, [visibleCandles])

  const levels = priceLevels()

  const fmtVol = (n: number): string => {
    const abs = Math.abs(n)
    if (abs >= 1000) return (n / 1000).toFixed(1) + 'k'
    if (abs >= 100) return n.toFixed(0)
    if (abs >= 1) return n.toFixed(1)
    return n.toFixed(2)
  }

  const fmtDelta = (n: number): string => {
    const prefix = n >= 0 ? '+' : ''
    return prefix + fmtVol(n)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setSize({ width: Math.floor(width), height: Math.floor(height) })
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const cw = size.width * dpr
    const ch = size.height * dpr
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
      canvas.style.width = size.width + 'px'
      canvas.style.height = size.height + 'px'
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = COL.panelBg
    ctx.fillRect(0, 0, size.width, size.height)

    if (visibleCandles.length === 0 || levels.length === 0) {
      ctx.fillStyle = COL.textDim
      ctx.font = '12px "SF Mono", "Fira Code", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Waiting for footprint data...', size.width / 2, size.height / 2)
      ctx.restore()
      return
    }

    const cellW = Math.max(CELL_MIN_W, (size.width - PRICE_COL_W - DELTA_COL_W - SCROLL_W) / visibleCandles.length)
    const dataX = PRICE_COL_W
    const deltaColX = dataX + cellW * visibleCandles.length
    const contentH = size.height - HEADER_H

    // Max scroll
    const maxScrollY = Math.max(0, levels.length * CELL_H - contentH)
    scrollYRef.current = Math.min(scrollYRef.current, maxScrollY)
    const scrollY = scrollYRef.current

    // ─── Header ───
    ctx.fillStyle = COL.headerBg
    ctx.fillRect(0, 0, size.width, HEADER_H)
    ctx.strokeStyle = COL.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, HEADER_H)
    ctx.lineTo(size.width, HEADER_H)
    ctx.stroke()

    // Price column header
    ctx.fillStyle = COL.textDim
    ctx.font = '9px "SF Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillText('PRICE', 6, HEADER_H - 5)

    // Candle time headers
    for (let ci = 0; ci < visibleCandles.length; ci++) {
      const x = dataX + ci * cellW
      const timeStr = new Date(visibleCandles[ci].openTime).toLocaleTimeString('en-US', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
      })
      ctx.fillStyle = COL.textDim
      ctx.font = '8px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(timeStr, x + cellW / 2, HEADER_H - 5)
    }

    // Delta column header
    ctx.fillStyle = COL.textDim
    ctx.font = '9px "SF Mono", monospace'
    ctx.textAlign = 'left'
    ctx.fillText('DELTA', deltaColX + 4, HEADER_H - 5)

    // ─── Clip to content area ───
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, HEADER_H, size.width, contentH)
    ctx.clip()

    // ─── Price levels ───
    const firstVisibleLevel = Math.floor(scrollY / CELL_H)
    const lastVisibleLevel = Math.min(levels.length, firstVisibleLevel + Math.ceil(contentH / CELL_H) + 1)

    // Compute max volume for color scaling
    let maxTotal = 0
    for (const c of visibleCandles) {
      for (const l of Object.values(c.priceMap)) {
        if (l.total > maxTotal) maxTotal = l.total
      }
    }
    maxTotal = Math.max(1, maxTotal)

    for (let li = firstVisibleLevel; li < lastVisibleLevel; li++) {
      const price = levels[li]
      const y = HEADER_H + (li * CELL_H) - scrollY

      if (y + CELL_H < HEADER_H || y > size.height) continue

      // Alternating row background
      if (li % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.01)'
        ctx.fillRect(0, y, size.width, CELL_H)
      }

      // Grid line
      ctx.strokeStyle = COL.gridLine
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + CELL_H)
      ctx.lineTo(size.width, y + CELL_H)
      ctx.stroke()

      // Price label
      ctx.fillStyle = COL.textSecondary
      ctx.font = '10px "SF Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText(fmtPrice(parseFloat(price)), PRICE_COL_W - 8, y + CELL_H - 4)

      // Vertical separator
      ctx.strokeStyle = COL.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PRICE_COL_W, y)
      ctx.lineTo(PRICE_COL_W, y + CELL_H)
      ctx.stroke()

      // Aggregate delta for this price across visible candles
      let aggDelta = 0

      // ─── Footprint cells per candle ───
      for (let ci = 0; ci < visibleCandles.length; ci++) {
        const candle = visibleCandles[ci]
        const x = dataX + ci * cellW
        const level = candle.priceMap[price]

        if (level) {
          aggDelta += level.delta
          const ratio = level.total / maxTotal
          const buyRatio = level.buy / level.total
          const alpha = 0.06 + ratio * 0.18

          // Cell background tint
          ctx.fillStyle = buyRatio > 0.55 ? `rgba(45,212,160,${alpha})` : buyRatio < 0.45 ? `rgba(239,100,97,${alpha})` : 'transparent'
          ctx.fillRect(x + 1, y + 1, cellW - 2, CELL_H - 2)

          // Cell text — buy on left, sell on right
          if (cellW >= 52) {
            const fontSize = Math.min(10, Math.max(7, (cellW - 8) / 7))
            ctx.font = `${fontSize}px "SF Mono", monospace`

            // Buy volume (left, green)
            ctx.fillStyle = COL.greenSoft
            ctx.textAlign = 'left'
            ctx.fillText(fmtVol(level.buy), x + 3, y + CELL_H - 3)

            // Sell volume (right, red)
            ctx.fillStyle = COL.redSoft
            ctx.textAlign = 'right'
            ctx.fillText(fmtVol(level.sell), x + cellW - 3, y + CELL_H - 3)
          } else if (cellW >= 36) {
            // Delta only
            const fontSize = Math.min(9, Math.max(7, (cellW - 4) / 4.5))
            ctx.font = `${fontSize}px "SF Mono", monospace`
            ctx.textAlign = 'center'
            ctx.fillStyle = level.delta >= 0 ? COL.greenSoft : COL.redSoft
            ctx.fillText(fmtDelta(level.delta), x + cellW / 2, y + CELL_H - 3)
          }
        }
      }

      // ─── Aggregate delta column ───
      ctx.strokeStyle = COL.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(deltaColX, y)
      ctx.lineTo(deltaColX, y + CELL_H)
      ctx.stroke()

      if (aggDelta !== 0) {
        ctx.fillStyle = aggDelta >= 0 ? COL.green : COL.red
        ctx.font = '10px "SF Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(fmtDelta(aggDelta), deltaColX + DELTA_COL_W - 6, y + CELL_H - 3)
      }
    }

    ctx.restore() // end clip

    // ─── Scrollbar ───
    if (maxScrollY > 0) {
      const trackH = contentH
      const thumbH = Math.max(20, (contentH / (levels.length * CELL_H)) * contentH)
      const thumbY = HEADER_H + (scrollY / maxScrollY) * (trackH - thumbH)
      ctx.fillStyle = 'rgba(79,195,247,0.12)'
      ctx.fillRect(size.width - SCROLL_W, thumbY, SCROLL_W, thumbH)
    }

    // ─── Candle body outlines (OHLC) ───
    // Draw a subtle border around each candle's high-low range
    for (let ci = 0; ci < visibleCandles.length; ci++) {
      const candle = visibleCandles[ci]
      const x = dataX + ci * cellW
      const isUp = candle.close >= candle.open

      // Find the first and last level within the candle's range
      let topLi = -1, botLi = -1
      for (let li = 0; li < levels.length; li++) {
        if (parseFloat(levels[li]) <= candle.high && parseFloat(levels[li]) >= candle.low) {
          if (topLi === -1) topLi = li
          botLi = li
        }
      }

      if (topLi >= 0 && botLi >= 0) {
        const bodyTop = HEADER_H + (topLi * CELL_H) - scrollY
        const bodyBot = HEADER_H + ((botLi + 1) * CELL_H) - scrollY
        const bodyH = Math.max(1, bodyBot - bodyTop)

        // Candle body outline
        ctx.strokeStyle = isUp ? 'rgba(45,212,160,0.12)' : 'rgba(239,100,97,0.12)'
        ctx.lineWidth = 1
        ctx.strokeRect(x, bodyTop, cellW, bodyH)
      }
    }

    ctx.restore()
  }, [visibleCandles, levels, size, symbol])

  // ─── Scroll handling ───
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    scrollYRef.current = Math.max(0, scrollYRef.current + e.deltaY)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { startY: e.clientY, startScroll: scrollYRef.current }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dy = ev.clientY - dragRef.current.startY
      scrollYRef.current = Math.max(0, dragRef.current.startScroll + dy)
    }

    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div ref={containerRef} className="footprint-chart-wrap">
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
      />
    </div>
  )
}
