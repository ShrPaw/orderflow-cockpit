import { useRef, useEffect, useCallback, useState } from 'react'
import { useMarketStore } from '../stores/marketStore'
import {
  renderChart, createViewState, handleWheel,
  handleDragStart, handleDragMove, handleDragEnd,
  goLive, resetView, fitAllData, fitRecent,
  getHoverCursor,
} from '../utils/chartRenderer'
import type { ViewState } from '../utils/chartRenderer'

export default function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ViewState>(createViewState())
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef<number>(0)
  const [size, setSize] = useState({ width: 800, height: 600 })

  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const volumeProfile = useMarketStore(s => s.volumeProfile)
  const followLive = useMarketStore(s => s.followLive)
  const setFollowLive = useMarketStore(s => s.setFollowLive)
  const livePrice = useMarketStore(s => s.livePrice)
  const symbol = useMarketStore(s => s.symbol)

  // Reset view state on symbol switch
  useEffect(() => {
    viewRef.current = createViewState()
    setFollowLive(true)
  }, [symbol, setFollowLive])

  // Sync followLive from store → view
  useEffect(() => {
    viewRef.current.followLive = followLive
  }, [followLive])

  // Expose view actions globally for Toolbar
  useEffect(() => {
    const api = {
      goLive: () => {
        viewRef.current = goLive(viewRef.current)
        setFollowLive(true)
      },
      resetView: () => {
        viewRef.current = resetView(viewRef.current)
        setFollowLive(true)
      },
      fitAll: () => {
        const total = candles.length + (currentCandle ? 1 : 0)
        viewRef.current = fitAllData(viewRef.current, total, size.width, size.height)
        setFollowLive(false)
      },
      fitRecent: () => {
        const total = candles.length + (currentCandle ? 1 : 0)
        viewRef.current = fitRecent(viewRef.current, total)
        setFollowLive(true)
      },
      getView: () => viewRef.current,
    }
    ;(window as any).__chartApi = api
    return () => { delete (window as any).__chartApi }
  }, [candles.length, currentCandle, size, setFollowLive])

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
          volumeProfile, mouseRef.current,
          livePrice
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
  }, [candles, currentCandle, volumeProfile, size, livePrice])

  // ─── Mouse handlers ───
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    viewRef.current = handleWheel(e, viewRef.current, size.width, size.height, mouseRef.current)
    setFollowLive(viewRef.current.followLive)
  }, [size, setFollowLive])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    viewRef.current = handleDragStart(e, viewRef.current, size.width, size.height)
  }, [size])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (viewRef.current._dragging) {
      viewRef.current = handleDragMove(e, viewRef.current, size.width, size.height)
      setFollowLive(viewRef.current.followLive)
    }
  }, [size, setFollowLive])

  const onMouseUp = useCallback(() => {
    if (viewRef.current._dragging) {
      viewRef.current = handleDragEnd(viewRef.current)
    }
  }, [])

  const onMouseLeave = useCallback(() => {
    mouseRef.current = null
    if (viewRef.current._dragging) {
      viewRef.current = handleDragEnd(viewRef.current)
    }
  }, [])

  const onDoubleClick = useCallback(() => {
    viewRef.current = goLive(viewRef.current)
    setFollowLive(true)
  }, [setFollowLive])

  // Dynamic cursor based on zone
  const cursor = getHoverCursor(mouseRef.current, size.width, size.height, !!viewRef.current._dragging)

  return (
    <div ref={containerRef} className="chart-container">
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onDoubleClick={onDoubleClick}
      />
    </div>
  )
}
