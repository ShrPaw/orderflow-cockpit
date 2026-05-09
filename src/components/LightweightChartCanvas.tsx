/**
 * LightweightChartCanvas.tsx
 *
 * ⚠️  EXPERIMENTAL — NOT production default yet.
 *
 * This component uses TradingView Lightweight Charts v5 as the chart engine.
 * It is currently behind a feature toggle (USE_LIGHTWEIGHT_CHART = false in App.tsx).
 *
 * Before making this the default, it must support Cockpit-specific overlays:
 * - round-level overlays (key price levels from orderbook)
 * - orderbook liquidity levels
 * - rejection/resistance coloring
 * - support/resistance conversion state
 * - big trade bubbles (large order flow events)
 * - absorption markers
 * - heatmap synchronization with orderbook depth
 * - volume profile / price-level context from footprint data
 * - drawing tools (trendlines, rectangles, alert lines)
 *
 * Currently only renders basic candlesticks + volume histogram.
 * Does NOT display orderflow-specific context that defines the Cockpit product.
 *
 * To test: set USE_LIGHTWEIGHT_CHART = true in App.tsx
 *
 * Phase 1: Core chart engine only (done)
 * Phase 2: Orderflow overlays (not started)
 *
 * TODO: rectangle liquidity zones
 * TODO: trendline drawing
 * TODO: alert lines
 * TODO: absorption zone overlays
 * TODO: liquidation bubbles
 * TODO: big trade bubbles
 * TODO: heatmap custom series
 * TODO: volume profile overlay
 * TODO: round-level overlays from orderbook
 * TODO: rejection/resistance coloring
 */

import { useRef, useEffect } from 'react'
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

// ─── Round-number price levels (simple non-invasive overlay) ───
function getRoundLevels(price: number): number[] {
  if (price <= 0) return []
  // Determine step based on price magnitude
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

// ─── Theme constants matching the Cockpit midnight-slate palette ───
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

export default function LightweightChartCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null)
  const roundLevelLinesRef = useRef<Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>>([])
  const lastCandleTimeRef = useRef<number>(0)

  // Store selectors
  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const livePrice = useMarketStore(s => s.livePrice)
  const symbol = useMarketStore(s => s.symbol)
  const followLive = useMarketStore(s => s.followLive)
  const setFollowLive = useMarketStore(s => s.setFollowLive)

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

    // Candlestick series (v5 API: chart.addSeries(CandlestickSeries, options))
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

    // ─── ResizeObserver for responsive sizing ───
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        chart.resize(width, height)
      }
    })
    observer.observe(container)

    // ─── Expose chart API globally for Toolbar integration ───
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
      delete (window as any).__chartApi
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      priceLineRef.current = null
      roundLevelLinesRef.current = []
      lastCandleTimeRef.current = 0
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
      return
    }

    const lastNewTime = lwcCandles[lwcCandles.length - 1].time as number

    if (lastNewTime !== lastCandleTimeRef.current) {
      // New candle interval started — full setData
      candleSeries.setData(lwcCandles)
      volumeSeries.setData(lwvVolumes)
      lastCandleTimeRef.current = lastNewTime
    } else {
      // Same candle, just update the last bar
      const lastCandle = lwcCandles[lwcCandles.length - 1]
      candleSeries.update(lastCandle)
      const lastVol = lwvVolumes[lwvVolumes.length - 1]
      if (lastVol) volumeSeries.update(lastVol)
    }

    if (followLive) {
      chartRef.current?.timeScale().scrollToRealTime()
    }
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
  }, [currentCandle, followLive])

  // ─── Current price line ───
  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    if (!candleSeries || !livePrice || livePrice <= 0) return

    // Remove old price line
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

    // Remove old round level lines
    for (const line of roundLevelLinesRef.current) {
      try { candleSeries.removePriceLine(line) } catch { /* already removed */ }
    }
    roundLevelLinesRef.current = []

    // Add round-number levels near current price
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
        ⚠ EXPERIMENTAL — orderflow overlays not fully migrated yet
      </div>
    </div>
  )
}
