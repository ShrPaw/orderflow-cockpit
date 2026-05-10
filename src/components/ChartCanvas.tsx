import { useRef, useEffect, useCallback, useState } from 'react'
import { useMarketStore } from '../stores/marketStore'
import {
  renderChart, createViewState, handleWheel,
  handleDragStart, handleDragMove, handleDragEnd,
  goLive, resetView, fitAllData, fitRecent,
  getHoverCursor,
} from '../utils/chartRenderer'
import type { ViewState } from '../utils/chartRenderer'
import { INTERVAL_MS } from '../types/market'

export default function ChartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<ViewState>(createViewState())
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef<number>(0)
  const [size, setSize] = useState({ width: 800, height: 600 })

  // ─── Store refs for render loop (avoid effect restart on every tick) ───
  // The render loop reads these refs instead of depending on them as effect deps.
  // This prevents the RAF loop from being torn down on every market tick.
  const candlesRef = useRef<unknown[]>([])
  const currentCandleRef = useRef<unknown>(null)
  const volumeProfileRef = useRef<unknown[]>([])
  const livePriceRef = useRef(0)
  const bidsRef = useRef<unknown[]>([])
  const asksRef = useRef<unknown[]>([])
  const intervalRef = useRef('40s')
  const clustersRef = useRef<unknown[]>([])
  const orderBookHealthRef = useRef<string>('DISCONNECTED')

  // Subscribe to store and update refs
  const followLive = useMarketStore(s => s.followLive)
  const setFollowLive = useMarketStore(s => s.setFollowLive)
  const symbol = useMarketStore(s => s.symbol)

  // Keep refs in sync with store — these selectors are cheap (just ref assignment)
  useEffect(() => {
    const unsub = useMarketStore.subscribe((state) => {
      candlesRef.current = state.candles
      currentCandleRef.current = state.currentCandle
      volumeProfileRef.current = state.volumeProfile
      livePriceRef.current = state.livePrice
      bidsRef.current = state.bids
      asksRef.current = state.asks
      intervalRef.current = state.interval
      clustersRef.current = state.clusters
      orderBookHealthRef.current = state.orderBookHealth
    })
    // Initialize refs from current state
    const s = useMarketStore.getState()
    candlesRef.current = s.candles
    currentCandleRef.current = s.currentCandle
    volumeProfileRef.current = s.volumeProfile
    livePriceRef.current = s.livePrice
    bidsRef.current = s.bids
    asksRef.current = s.asks
    intervalRef.current = s.interval
    clustersRef.current = s.clusters
    orderBookHealthRef.current = s.orderBookHealth
    return unsub
  }, [])

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
        const candles = candlesRef.current as any[]
        const current = currentCandleRef.current as any
        const total = candles.length + (current ? 1 : 0)
        viewRef.current = fitAllData(viewRef.current, total, size.width, size.height)
        setFollowLive(false)
      },
      fitRecent: () => {
        const candles = candlesRef.current as any[]
        const current = currentCandleRef.current as any
        const total = candles.length + (current ? 1 : 0)
        viewRef.current = fitRecent(viewRef.current, total)
        setFollowLive(true)
      },
      getView: () => viewRef.current,
    }
    ;(window as any).__chartApi = api
    return () => { delete (window as any).__chartApi }
  }, [size, setFollowLive])

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

  // ─── Render loop — runs once, reads refs for current data ───
  // This effect depends ONLY on `size` (canvas dimensions).
  // All market data is read from refs which are updated by the subscription above.
  // This prevents the RAF loop from being torn down on every market tick.
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
        // Read current data from refs — never stale because subscription runs synchronously
        const candles = candlesRef.current as any[]
        const currentCandle = currentCandleRef.current as any
        const volumeProfile = volumeProfileRef.current as any[]
        const livePrice = livePriceRef.current
        const bids = bidsRef.current as any[]
        const asks = asksRef.current as any[]
        const interval = intervalRef.current as string
        const clusters = clustersRef.current as any[]
        const orderBookHealth = orderBookHealthRef.current as string

        const intervalMs = INTERVAL_MS[interval as keyof typeof INTERVAL_MS] ?? 40_000
        const isBookHealthy = orderBookHealth === 'HEALTHY' || orderBookHealth === 'DEGRADED' || orderBookHealth === 'TOP20'
        const result = renderChart(
          ctx, size.width, size.height, dpr,
          candles, currentCandle, viewRef.current,
          volumeProfile, mouseRef.current,
          livePrice,
          isBookHealthy ? bids : undefined,
          isBookHealthy ? asks : undefined,
          intervalMs,
          clusters, 'CLUSTERED' // Smart Flow: always render, no user-facing mode switch
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
  }, [size])

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

  // Click handler for GO LIVE pill hitbox
  const onClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const pill = viewRef.current._goLivePillRect
    if (pill && x >= pill.x && x <= pill.x + pill.w && y >= pill.y && y <= pill.y + pill.h) {
      viewRef.current = goLive(viewRef.current)
      setFollowLive(true)
    }
  }, [setFollowLive])

  // Dynamic cursor based on zone — also check GO LIVE pill hover
  const isOverGoLive = (() => {
    const pill = viewRef.current._goLivePillRect
    if (!pill || !mouseRef.current) return false
    const m = mouseRef.current
    return m.x >= pill.x && m.x <= pill.x + pill.w && m.y >= pill.y && m.y <= pill.y + pill.h
  })()
  const cursor = isOverGoLive ? 'pointer' : getHoverCursor(mouseRef.current, size.width, size.height, !!viewRef.current._dragging)

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
        onClick={onClick}
      />
    </div>
  )
}
