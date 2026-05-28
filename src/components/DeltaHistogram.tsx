import { useRef, useEffect, useState, useCallback } from 'react'
import { useMarketStore } from '../stores/marketStore'
import type { Candle } from '../types/market'

const COL = {
  bg: '#06090f',
  grid: '#121924',
  border: '#182030',
  text: '#3d4f68',
  green: '#2dd4a0',
  red: '#ef6461',
  purple: '#9c8fd8',
}

const MA_PERIOD = 20
const VISIBLE_COUNT = 120

export default function DeltaHistogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const sizeRef = useRef({ width: 800, height: 50 })
  const [, forceUpdate] = useState(0)

  // Read data via refs — no React rerenders per tick
  const candlesRef = useRef<Candle[]>([])
  const currentCandleRef = useRef<Candle | null>(null)
  const symbolRef = useRef('')

  // Subscribe to store changes and write to refs (doesn't trigger rerender)
  useEffect(() => {
    return useMarketStore.subscribe((state) => {
      candlesRef.current = state.candles
      currentCandleRef.current = state.currentCandle
      symbolRef.current = state.symbol
    })
  }, [])

  // Initialize refs from current state
  useEffect(() => {
    const s = useMarketStore.getState()
    candlesRef.current = s.candles
    currentCandleRef.current = s.currentCandle
    symbolRef.current = s.symbol
  }, [])

  // ResizeObserver for responsive sizing
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        sizeRef.current = { width: Math.floor(width), height: Math.floor(height) }
        forceUpdate(n => n + 1)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Single long-lived RAF render loop — reads from refs, no dependency on data
  useEffect(() => {
    let running = true

    function draw() {
      if (!running) return
      const canvas = canvasRef.current
      if (!canvas) { rafRef.current = requestAnimationFrame(draw); return }

      const size = sizeRef.current
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
      if (!ctx) { rafRef.current = requestAnimationFrame(draw); return }

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, size.width, size.height)

      ctx.fillStyle = COL.bg
      ctx.fillRect(0, 0, size.width, size.height)

      const allCandles: Candle[] = [...candlesRef.current]
      if (currentCandleRef.current) allCandles.push(currentCandleRef.current)

      if (allCandles.length === 0) {
        ctx.fillStyle = COL.text
        ctx.font = '9px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Waiting for delta data...', size.width / 2, size.height / 2)
        ctx.restore()
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const visible = allCandles.slice(-VISIBLE_COUNT)
      const count = visible.length
      const deltas = visible.map(c => c.delta)
      const maxAbs = Math.max(1, ...deltas.map(d => Math.abs(d)))

      const barGap = 1
      const barWidth = Math.max(1, (size.width - barGap * (count - 1)) / count)
      const midY = size.height / 2

      ctx.strokeStyle = COL.grid
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(size.width, midY)
      ctx.stroke()

      ctx.globalAlpha = 0.3
      const quarterTop = midY - (midY * 0.5)
      const quarterBottom = midY + (midY * 0.5)
      ctx.beginPath()
      ctx.moveTo(0, quarterTop)
      ctx.lineTo(size.width, quarterTop)
      ctx.moveTo(0, quarterBottom)
      ctx.lineTo(size.width, quarterBottom)
      ctx.stroke()
      ctx.globalAlpha = 1.0

      for (let i = 0; i < count; i++) {
        const delta = deltas[i]
        const x = i * (barWidth + barGap)
        const halfH = (Math.abs(delta) / maxAbs) * (midY - 1)

        if (delta >= 0) {
          ctx.fillStyle = COL.green
          ctx.fillRect(x, midY - halfH, barWidth, halfH)
        } else {
          ctx.fillStyle = COL.red
          ctx.fillRect(x, midY, barWidth, halfH)
        }
      }

      const maPoints: { x: number; y: number }[] = []
      for (let i = 0; i < count; i++) {
        const start = Math.max(0, i - MA_PERIOD + 1)
        let sum = 0
        for (let j = start; j <= i; j++) {
          sum += deltas[j]
        }
        const avg = sum / (i - start + 1)
        const x = i * (barWidth + barGap) + barWidth / 2
        const y = midY - (avg / maxAbs) * (midY - 1)
        maPoints.push({ x, y })
      }

      if (maPoints.length > 1) {
        ctx.strokeStyle = COL.purple
        ctx.lineWidth = 1.5
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(maPoints[0].x, maPoints[0].y)
        for (let i = 1; i < maPoints.length; i++) {
          ctx.lineTo(maPoints[i].x, maPoints[i].y)
        }
        ctx.stroke()
      }

      ctx.strokeStyle = COL.border
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(size.width, midY)
      ctx.stroke()

      ctx.fillStyle = COL.text
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('DELTA', 4, 3)

      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [sizeRef.current.width, sizeRef.current.height])

  return (
    <div ref={containerRef} className="delta-histogram-wrap">
      <canvas ref={canvasRef} />
    </div>
  )
}
