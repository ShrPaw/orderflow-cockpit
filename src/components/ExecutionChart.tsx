/**
 * ExecutionChart.tsx
 *
 * Unified execution chart: TradingView Lightweight Charts for professional
 * candlestick rendering + Canvas2D overlay for orderflow methodology.
 *
 * Architecture:
 *   ┌─────────────────────────────────────┐
 *   │  Lightweight Charts (candlesticks,  │
 *   │  time scale, price scale, zoom/pan, │
 *   │  crosshair, scroll-to-real-time)    │
 *   ├─────────────────────────────────────┤
 *   │  Overlay Canvas (heatmap, bubbles,  │
 *   │  footprint, tooltip, state badges)  │
 *   │  pointer-events: none               │
 *   ├─────────────────────────────────────┤
 *   │  GO LIVE button (HTML, small,       │
 *   │  pointer-events: auto only here)    │
 *   └─────────────────────────────────────┘
 *
 * Data flow: Zustand store → refs (no React re-render per tick) → RAF loop
 *
 * INTERACTION MODEL:
 * Lightweight Charts owns ALL chart interactions (zoom, pan, crosshair, drag).
 * Overlay canvas is purely visual — pointer-events: none.
 * Mouse tracking for tooltips uses container mousemove (passive).
 * GO LIVE is a small HTML button, not a canvas hitbox.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import { useMarketStore } from '../stores/marketStore'
import type { Candle, Bubble, OrderLevel, OrderBookHealth } from '../types/market'
import type { OverlayFrame, ExecutionChartApi } from '../types/executionChart'
import type { AuctionCluster } from '../utils/auctionClusters'
import type { LevelRecord } from '../utils/levelMemory'
import { INTERVAL_MS } from '../types/market'
import { adaptCandles, adaptVolumes, adaptSingleCandle, adaptSingleVolume } from '../utils/lightweightChartAdapters'
import { getAllLevels } from '../utils/levelMemory'
import {
  drawExecutionOverlay,
  drawBubbleTooltip,
  drawClusterTooltip,
  drawLiveBadge,
  findClosestBubble,
  findClosestCluster,
} from '../utils/executionOverlayRenderer'
import { timePriceToPixel } from '../utils/lightweightCoordinateAdapter'

// ─── Theme constants matching Cockpit midnight-slate palette ───
const THEME = {
  bg: '#06090f',
  grid: '#121924',
  text: '#4a5e78',
  border: '#182030',
  crosshairLine: 'rgba(148,163,184,0.18)',
  candleUp: '#2dd4a0',
  candleDown: '#ef6461',
  wickUp: '#2dd4a0',
  wickDown: '#ef6461',
  volumeUp: 'rgba(45,212,160,0.25)',
  volumeDown: 'rgba(239,100,97,0.25)',
  priceLine: '#4fc3f7',
  lastPriceGreen: '#2dd4a0',
  lastPriceRed: '#ef6461',
}

export default function ExecutionChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null)
  const lastPriceLineValueRef = useRef<number>(0)
  const lastCandleTimeRef = useRef<number>(0)
  const rafRef = useRef<number>(0)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const sizeRef = useRef({ width: 800, height: 600 })

  // ─── Store refs for render loop (avoid React re-render per tick) ───
  const candlesRef = useRef<Candle[]>([])
  const currentCandleRef = useRef<Candle | null>(null)
  const livePriceRef = useRef(0)
  const bidsRef = useRef<OrderLevel[]>([])
  const asksRef = useRef<OrderLevel[]>([])
  const intervalRef = useRef<string>('40s')
  const clustersRef = useRef<AuctionCluster[]>([])
  const orderBookHealthRef = useRef<OrderBookHealth>('DISCONNECTED')
  const followLiveRef = useRef(true)
  const symbolRef = useRef('BTCUSDT')

  // ─── GO LIVE visibility (show when user has panned away) ───
  const [showGoLive, setShowGoLive] = useState(false)

  // Store selectors (only for things that trigger React effects)
  const symbol = useMarketStore(s => s.symbol)
  const followLive = useMarketStore(s => s.followLive)
  const setFollowLive = useMarketStore(s => s.setFollowLive)

  // ─── Sync store → refs ───
  useEffect(() => {
    const unsub = useMarketStore.subscribe((state) => {
      candlesRef.current = state.candles
      currentCandleRef.current = state.currentCandle
      livePriceRef.current = state.livePrice
      bidsRef.current = state.bids
      asksRef.current = state.asks
      intervalRef.current = state.interval
      clustersRef.current = state.clusters
      orderBookHealthRef.current = state.orderBookHealth
      followLiveRef.current = state.followLive
      symbolRef.current = state.symbol
    })
    // Initialize
    const s = useMarketStore.getState()
    candlesRef.current = s.candles
    currentCandleRef.current = s.currentCandle
    livePriceRef.current = s.livePrice
    bidsRef.current = s.bids
    asksRef.current = s.asks
    intervalRef.current = s.interval
    clustersRef.current = s.clusters
    orderBookHealthRef.current = s.orderBookHealth
    followLiveRef.current = s.followLive
    symbolRef.current = s.symbol
    return unsub
  }, [])

  // ─── Chart creation & cleanup (runs once on mount) ───
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.text,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: THEME.grid, style: LineStyle.Dotted },
        horzLines: { color: THEME.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: THEME.crosshairLine,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#141c28',
        },
        horzLine: {
          color: THEME.crosshairLine,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#141c28',
        },
      },
      rightPriceScale: {
        borderColor: THEME.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        autoScale: true,
      },
      timeScale: {
        borderColor: THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      handleScroll: { vertTouchDrag: false },
    })

    // Candlestick series (v5 API)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: THEME.candleUp,
      downColor: THEME.candleDown,
      wickUpColor: THEME.wickUp,
      wickDownColor: THEME.wickDown,
      borderVisible: false,
    })

    // Volume histogram series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    // ─── ResizeObserver ───
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        sizeRef.current = { width: Math.floor(width), height: Math.floor(height) }
        chart.resize(width, height)
        // Resize overlay canvas to match
        const overlay = overlayCanvasRef.current
        if (overlay) {
          const dpr = window.devicePixelRatio || 1
          overlay.width = Math.floor(width) * dpr
          overlay.height = Math.floor(height) * dpr
          overlay.style.width = width + 'px'
          overlay.style.height = height + 'px'
        }
      }
    })
    observer.observe(container)

    // ─── Expose chart API for Toolbar ───
    const api: ExecutionChartApi = {
      goLive: () => {
        chart.timeScale().scrollToRealTime()
        setFollowLive(true)
      },
      resetView: () => {
        chart.timeScale().resetTimeScale()
        chart.timeScale().scrollToRealTime()
        setFollowLive(true)
      },
      fitAll: () => {
        chart.timeScale().fitContent()
        setFollowLive(false)
      },
      fitRecent: () => {
        chart.timeScale().scrollToRealTime()
        setFollowLive(true)
      },
      getChart: () => chart,
    }
    ;(window as any).__chartApi = api

    // ─── Track scroll to toggle followLive and show/hide GO LIVE ───
    const scrollHandler = () => {
      const ts = chart.timeScale()
      const scrollPos = ts.scrollPosition()
      if (scrollPos < -20) {
        setFollowLive(false)
        setShowGoLive(true)
      } else {
        setShowGoLive(false)
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(scrollHandler)

    // ─── Mouse tracking for tooltip (passive, on container) ───
    // This does NOT block Lightweight Charts — it just reads mouse position
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const handleMouseLeave = () => {
      mouseRef.current = null
    }
    container.addEventListener('mousemove', handleMouseMove, { passive: true })
    container.addEventListener('mouseleave', handleMouseLeave, { passive: true })

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scrollHandler)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMouseLeave)
      observer.disconnect()
      delete (window as any).__chartApi
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      priceLineRef.current = null
      lastCandleTimeRef.current = 0
    }
  }, []) // Mount once

  // ─── Full data reload on symbol switch ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries) return

    const candles = candlesRef.current
    const lwcCandles = adaptCandles(candles)
    const lwvVolumes = adaptVolumes(candles)

    candleSeries.setData(lwcCandles)
    volumeSeries.setData(lwvVolumes)

    if (lwcCandles.length > 0) {
      lastCandleTimeRef.current = lwcCandles[lwcCandles.length - 1].time as number
    } else {
      lastCandleTimeRef.current = 0
    }

    if (followLiveRef.current) {
      chartRef.current?.timeScale().scrollToRealTime()
    }
  }, [symbol])

  // ─── Sync followLive from store ───
  useEffect(() => {
    followLiveRef.current = followLive
    if (followLive && chartRef.current) {
      chartRef.current.timeScale().scrollToRealTime()
    }
  }, [followLive])

  // ─── Overlay RAF loop ───
  // Runs once, reads refs for current data. Redraws overlay canvas on each frame.
  useEffect(() => {
    let running = true

    function frame() {
      if (!running) return

      const chart = chartRef.current
      const candleSeries = candleSeriesRef.current
      const overlay = overlayCanvasRef.current
      if (!chart || !candleSeries || !overlay) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }

      const dpr = window.devicePixelRatio || 1
      const { width, height } = sizeRef.current

      // ─── Update candlestick + volume series from refs ───
      const candles = candlesRef.current
      const currentCandle = currentCandleRef.current
      const allCandles = currentCandle ? [...candles, currentCandle] : candles
      const intervalMs = INTERVAL_MS[intervalRef.current as keyof typeof INTERVAL_MS] ?? 40_000

      // Update closed candles if changed
      if (candles.length > 0) {
        const lwcCandles = adaptCandles(candles)
        const lwvVolumes = adaptVolumes(candles)

        if (lwcCandles.length > 0) {
          const lastNewTime = lwcCandles[lwcCandles.length - 1].time as number
          if (lastNewTime !== lastCandleTimeRef.current) {
            candleSeries.setData(lwcCandles)
            volumeSeriesRef.current?.setData(lwvVolumes)
            lastCandleTimeRef.current = lastNewTime
          }
        }
      }

      // Update current (live) candle
      if (currentCandle) {
        const lwc = adaptSingleCandle(currentCandle)
        const lwv = adaptSingleVolume(currentCandle)
        if (lwc) candleSeries.update(lwc)
        if (lwv) volumeSeriesRef.current?.update(lwv)
      }

      // Scroll to real-time if following
      if (followLiveRef.current) {
        chart.timeScale().scrollToRealTime()
      }

      // ─── Update price line (only when price changes) ───
      const livePrice = livePriceRef.current
      if (livePrice > 0 && livePrice !== lastPriceLineValueRef.current) {
        if (priceLineRef.current) {
          candleSeries.removePriceLine(priceLineRef.current)
          priceLineRef.current = null
        }
        const isUp = currentCandle ? currentCandle.close >= currentCandle.open : true
        priceLineRef.current = candleSeries.createPriceLine({
          price: livePrice,
          color: isUp ? THEME.lastPriceGreen : THEME.lastPriceRed,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          axisLabelColor: THEME.priceLine,
          title: '',
        })
        lastPriceLineValueRef.current = livePrice
      }

      // ─── Draw overlay ───
      const ctx = overlay.getContext('2d')
      if (ctx) {
        const frame: OverlayFrame = {
          allCandles,
          livePrice: livePriceRef.current,
          bids: bidsRef.current,
          asks: asksRef.current,
          bubbles: allCandles.flatMap(c => c.bubbles),
          intervalMs,
          symbol: symbolRef.current,
          clusters: clustersRef.current,
          orderBookHealth: orderBookHealthRef.current,
          levelRecords: getAllLevels(),
          followLive: followLiveRef.current,
          now: Date.now(),
        }

        const rc = {
          ctx,
          width,
          height,
          dpr,
          chart,
          candleSeries,
          frame,
        }

        drawExecutionOverlay(rc)

        // Draw tooltip if mouse is hovering
        const mouse = mouseRef.current
        if (mouse) {
          ctx.save()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.scale(dpr, dpr)
          const cluster = findClosestCluster(mouse.x, mouse.y, frame, chart, candleSeries)
          if (cluster) {
            drawClusterTooltip(ctx, cluster, mouse.x, mouse.y, width, height)
          } else {
            const bubble = findClosestBubble(mouse.x, mouse.y, frame, chart, candleSeries)
            if (bubble) {
              drawBubbleTooltip(ctx, bubble, mouse.x, mouse.y, width, height)
            }
          }
          ctx.restore()
        }
      }

      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, []) // Run once

  // ─── GO LIVE handler ───
  const handleGoLive = useCallback(() => {
    chartRef.current?.timeScale().scrollToRealTime()
    setFollowLive(true)
  }, [setFollowLive])

  return (
    <div
      ref={containerRef}
      className="chart-container"
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {/* Overlay canvas — purely visual, never blocks interaction */}
      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />
      {/* GO LIVE button — only interactive element on overlay */}
      {showGoLive && (
        <button
          onClick={handleGoLive}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 20,
            background: 'rgba(228,167,59,0.10)',
            border: '1px solid rgba(228,167,59,0.30)',
            color: '#e4a73b',
            fontFamily: '"SF Mono", monospace',
            fontSize: 10,
            fontWeight: 'bold',
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          ◉ GO LIVE
        </button>
      )}
      {/* LIVE indicator when following — no pointer-events needed */}
      {followLive && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 20,
            background: 'rgba(45,212,160,0.12)',
            border: '1px solid rgba(45,212,160,0.35)',
            color: '#2dd4a0',
            fontFamily: '"SF Mono", monospace',
            fontSize: 10,
            fontWeight: 'bold',
            padding: '4px 10px',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        >
          LIVE
        </div>
      )}
    </div>
  )
}
