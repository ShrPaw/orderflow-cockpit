/**
 * LightweightChartCanvas.tsx
 *
 * ─── Hybrid Experimental Chart Engine ───
 *
 * TradingView Lightweight Charts v5 as the base chart engine:
 * - candles, volume, price scale, time scale, zoom, pan, crosshair
 *
 * Custom Cockpit overlay canvas for orderflow methodology:
 * - bubbles (aggressive flow events with state/age encoding)
 * - liquidity levels (orderbook bid/ask bands)
 *
 * The overlay is absolutely positioned over the Lightweight chart container
 * with pointer-events: none so it does not block chart interactions.
 *
 * Lightweight remains EXPERIMENTAL — Legacy ChartCanvas remains default.
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
import {
  adaptCandles,
  adaptVolumes,
  adaptSingleCandle,
  adaptSingleVolume,
} from '../utils/lightweightChartAdapters'
import {
  drawOverlay,
  type OverlayRenderContext,
} from '../utils/lightweightOverlayRenderer'
import { INTERVAL_MS } from '../types/market'

// ─── Round-number price levels ───
function getRoundLevels(price: number): number[] {
  if (price <= 0) return []
  let step: number
  if (price > 50000) step = 1000
  else if (price > 10000) step = 500
  else if (price > 1000) step = 100
  else if (price > 100) step = 50
  else if (price > 10) step = 5
  else step = 1

  const levels: number[] = []
  const center = Math.round(price / step) * step
  for (let i = -5; i <= 5; i++) {
    const level = center + i * step
    if (level > 0) levels.push(level)
  }
  return levels
}

// ─── Theme constants ───
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

const toolBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  background: 'rgba(15,20,30,0.85)',
  border: '1px solid rgba(100,130,170,0.2)',
  borderRadius: 3,
  color: '#6b8098',
  fontSize: 9,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  cursor: 'pointer',
  userSelect: 'none',
  lineHeight: '16px',
}

export default function LightweightChartCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null)
  const roundLevelLinesRef = useRef<Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>([])
  const lastCandleTimeRef = useRef<number>(0)
  const overlayRafRef = useRef<number>(0)

  // Store selectors (needed before tools state for addHLine)
  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const livePrice = useMarketStore(s => s.livePrice)
  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)
  const followLive = useMarketStore(s => s.followLive)
  const setFollowLive = useMarketStore(s => s.setFollowLive)
  const bubbles = useMarketStore(s => s.bubbles)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const clusters = useMarketStore(s => s.clusters)
  const displayMode = useMarketStore(s => s.displayMode)

  // ─── Lightweight tools state ───
  const [showBubbles, setShowBubbles] = useState(true)
  const [showLiquidity, setShowLiquidity] = useState(true)
  const [showLevels, setShowLevels] = useState(true)
  const hLineRef = useRef<Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>([])

  const toggleBubbles = useCallback(() => setShowBubbles(v => !v), [])
  const toggleLiquidity = useCallback(() => setShowLiquidity(v => !v), [])
  const toggleLevels = useCallback(() => setShowLevels(v => !v), [])

  const addHLine = useCallback(() => {
    const candleSeries = candleSeriesRef.current
    const price = livePrice
    if (!candleSeries || !price || price <= 0) return
    const line = candleSeries.createPriceLine({
      price,
      color: '#4fc3f7',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: '#4fc3f7',
      title: 'H-Line',
    })
    hLineRef.current.push(line)
  }, [livePrice])

  const resetOverlays = useCallback(() => {
    setShowBubbles(true)
    setShowLiquidity(true)
    setShowLevels(true)
    for (const line of hLineRef.current) {
      try { candleSeriesRef.current?.removePriceLine(line) } catch { /* ok */ }
    }
    hLineRef.current = []
  }, [])

  // ─── Overlay redraw scheduling ───
  const scheduleOverlayRedraw = useCallback(() => {
    if (overlayRafRef.current) cancelAnimationFrame(overlayRafRef.current)
    overlayRafRef.current = requestAnimationFrame(() => {
      const chart = chartRef.current
      const candleSeries = candleSeriesRef.current
      const canvas = overlayCanvasRef.current
      const container = containerRef.current

      if (!chart || !candleSeries || !canvas || !container) return

      const rect = container.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const dpr = window.devicePixelRatio || 1

      if (canvas.width !== Math.floor(width * dpr) ||
          canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
        canvas.style.width = width + 'px'
        canvas.style.height = height + 'px'
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const now = Date.now()
      const intervalMs = INTERVAL_MS[interval] ?? 60_000

      const allBubbles = [...bubbles]
      if (currentCandle) {
        for (const b of currentCandle.bubbles) {
          if (!allBubbles.some(ab => ab.id === b.id)) {
            allBubbles.push(b)
          }
        }
      }

      const rc: OverlayRenderContext = {
        ctx, width, height, dpr,
        chart, candleSeries,
        now, intervalMs, symbol,
      }

      drawOverlay(rc, allBubbles, livePrice, bids, asks, {
        showBubbles,
        showLiquidity,
        showLevels,
        clusters,
        displayMode,
      })
    })
  }, [bubbles, currentCandle, livePrice, bids, asks, interval, symbol, showBubbles, showLiquidity, showLevels, clusters, displayMode])

  // ─── Chart creation & cleanup ───
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

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: THEME.candleUp,
      downColor: THEME.candleDown,
      wickUpColor: THEME.wickUp,
      wickDownColor: THEME.wickDown,
      borderVisible: false,
    })

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

    // ResizeObserver for responsive sizing
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        chart.resize(width, height)
      }
    })
    observer.observe(container)

    // Subscribe to visible range changes → trigger overlay redraw
    const onVisibleRangeChange = () => {
      scheduleOverlayRedraw()
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange)

    // Expose chart API for Toolbar integration
    const api = {
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
      getView: () => null,
      getChart: () => chart,
    }
    ;(window as any).__chartApi = api

    return () => {
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange)
      delete (window as any).__chartApi
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      priceLineRef.current = null
      roundLevelLinesRef.current = []
      lastCandleTimeRef.current = 0
      if (overlayRafRef.current) cancelAnimationFrame(overlayRafRef.current)
    }
  }, []) // Create chart once on mount

  // ─── Full data reload on symbol switch ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries) return

    const lwcCandles = adaptCandles(candles)
    const lwvVolumes = adaptVolumes(candles)

    candleSeries.setData(lwcCandles)
    volumeSeries.setData(lwvVolumes)

    if (lwcCandles.length > 0) {
      lastCandleTimeRef.current = lwcCandles[lwcCandles.length - 1].time as number
    } else {
      lastCandleTimeRef.current = 0
    }

    if (followLive) {
      chartRef.current?.timeScale().scrollToRealTime()
    }

    scheduleOverlayRedraw()
  }, [symbol]) // Reload everything on symbol switch

  // ─── Update chart when closed candles change ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries) return

    const lwcCandles = adaptCandles(candles)
    const lwvVolumes = adaptVolumes(candles)

    if (lwcCandles.length === 0) {
      candleSeries.setData([])
      volumeSeries.setData([])
      lastCandleTimeRef.current = 0
      scheduleOverlayRedraw()
      return
    }

    const lastNewTime = lwcCandles[lwcCandles.length - 1].time as number

    if (lastNewTime !== lastCandleTimeRef.current) {
      candleSeries.setData(lwcCandles)
      volumeSeries.setData(lwvVolumes)
      lastCandleTimeRef.current = lastNewTime
    } else {
      const lastCandle = lwcCandles[lwcCandles.length - 1]
      candleSeries.update(lastCandle)
      const lastVol = lwvVolumes[lwvVolumes.length - 1]
      if (lastVol) volumeSeries.update(lastVol)
    }

    if (followLive) {
      chartRef.current?.timeScale().scrollToRealTime()
    }

    scheduleOverlayRedraw()
  }, [candles, followLive])

  // ─── Live current candle updates ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    if (!candleSeries || !volumeSeries || !currentCandle) return

    const lwc = adaptSingleCandle(currentCandle)
    const lwv = adaptSingleVolume(currentCandle)

    if (lwc) candleSeries.update(lwc)
    if (lwv) volumeSeries.update(lwv)

    if (followLive) {
      chartRef.current?.timeScale().scrollToRealTime()
    }

    scheduleOverlayRedraw()
  }, [currentCandle, followLive])

  // ─── Current price line ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries || !livePrice || livePrice <= 0) return

    if (priceLineRef.current) {
      candleSeries.removePriceLine(priceLineRef.current)
      priceLineRef.current = null
    }

    const lastCandle = currentCandle
    const isUp = lastCandle ? lastCandle.close >= lastCandle.open : true

    priceLineRef.current = candleSeries.createPriceLine({
      price: livePrice,
      color: isUp ? THEME.lastPriceGreen : THEME.lastPriceRed,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: THEME.priceLine,
      title: '',
    })

    return () => {
      if (priceLineRef.current) {
        candleSeries.removePriceLine(priceLineRef.current)
        priceLineRef.current = null
      }
    }
  }, [livePrice, currentCandle])

  // ─── Round-number price levels ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries || !livePrice || livePrice <= 0) return

    for (const line of roundLevelLinesRef.current) {
      try { candleSeries.removePriceLine(line) } catch { /* already removed */ }
    }
    roundLevelLinesRef.current = []

    const levels = getRoundLevels(livePrice)
    for (const level of levels) {
      const line = candleSeries.createPriceLine({
        price: level,
        color: 'rgba(100,130,170,0.12)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: '',
      })
      roundLevelLinesRef.current.push(line)
    }

    return () => {
      for (const line of roundLevelLinesRef.current) {
        try { candleSeries.removePriceLine(line) } catch { /* ok */ }
      }
      roundLevelLinesRef.current = []
    }
  }, [livePrice])

  // ─── Overlay redraw on store changes ───
  useEffect(() => {
    scheduleOverlayRedraw()
  }, [bubbles, bids, asks, livePrice, scheduleOverlayRedraw])

  // ─── Track user scroll to toggle followLive ───
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handler = () => {
      const ts = chart.timeScale()
      const scrollPos = ts.scrollPosition()
      if (scrollPos < -20) {
        setFollowLive(false)
      }
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
    }
  }, [setFollowLive])

  return (
    <div ref={containerRef} className="chart-container" style={{ position: 'relative' }}>
      {/* Hybrid overlay canvas — absolutely positioned, pointer-events: none */}
      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />

      <div style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 10,
        padding: '3px 8px',
        background: 'rgba(228,167,59,0.08)',
        border: '1px solid rgba(228,167,59,0.15)',
        borderRadius: 4,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.4px',
        color: '#e4a73b',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        ⚠ EXPERIMENTAL — hybrid orderflow overlays
      </div>

      {/* Lightweight tools panel */}
      <div className="lw-tools" style={{
        position: 'absolute',
        top: 8,
        right: 90,
        zIndex: 10,
        display: 'flex',
        gap: 4,
      }}>
        <button onClick={toggleBubbles} style={toolBtnStyle}>
          {showBubbles ? '◉' : '○'} Bubble
        </button>
        <button onClick={toggleLiquidity} style={toolBtnStyle}>
          {showLiquidity ? '◉' : '○'} Liq
        </button>
        <button onClick={toggleLevels} style={toolBtnStyle}>
          {showLevels ? '◉' : '○'} Levels
        </button>
        <button onClick={addHLine} style={toolBtnStyle}>
          — H-Line
        </button>
        <button onClick={resetOverlays} style={toolBtnStyle}>
          ↺ Reset
        </button>
      </div>
    </div>
  )
}
