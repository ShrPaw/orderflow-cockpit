import { useRef, useEffect, useCallback, useState } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { renderChart, createViewState, handleWheel } from '../utils/chartRenderer'

export default function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(createViewState())
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef<number>(0)
  const [size, setSize] = useState({ width: 800, height: 600 })

  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const volumeProfile = useMarketStore(s => s.volumeProfile)
  const followLive = useMarketStore(s => s.followLive)

  // Sync followLive from store
  useEffect(() => {
    viewRef.current.followLive = followLive
  }, [followLive])

  // Resize observer
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

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    canvas.style.width = size.width + 'px'
    canvas.style.height = size.height + 'px'

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const result = renderChart(
      ctx, size.width, size.height, dpr,
      candles, currentCandle, viewRef.current,
      volumeProfile, mouseRef.current
    )
    viewRef.current = result.view

    return () => {
      // no cleanup needed per frame
    }
  }, [candles, currentCandle, volumeProfile, size])

  // Animation loop for smooth rendering
  useEffect(() => {
    let running = true
    function frame() {
      if (!running) return
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = size.width * dpr
      canvas.height = size.height * dpr
      canvas.style.width = size.width + 'px'
      canvas.style.height = size.height + 'px'
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const result = renderChart(
          ctx, size.width, size.height, dpr,
          candles, currentCandle, viewRef.current,
          volumeProfile, mouseRef.current
        )
        viewRef.current = result.view
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [candles, currentCandle, volumeProfile, size])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    viewRef.current = handleWheel(e, viewRef.current, e.shiftKey)
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const onMouseLeave = useCallback(() => {
    mouseRef.current = null
  }, [])

  const onDoubleClick = useCallback(() => {
    viewRef.current.followLive = true
    useMarketStore.getState().setFollowLive(true)
  }, [])

  return (
    <div ref={containerRef} className="chart-container">
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
      />
    </div>
  )
}
