import { useRef, useEffect, useState } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { computeVisibleRangeVolumeProfile, type VPResult } from '../utils/volumeProfileRange'
import { fmtPrice, fmtNum } from '../utils/formatters'

export default function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const livePrice = useMarketStore(s => s.livePrice)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)

  const isHealthy = orderBookHealth === 'HEALTHY'
  const isTop20 = orderBookHealth === 'TOP20'
  const isDegraded = orderBookHealth === 'DEGRADED'
  const isUsable = isHealthy || isTop20 || isDegraded

  const hasData = bids.length > 0 || asks.length > 0
  const showDimmed = (!isUsable && !hasData) || depthStale

  // Compute VPVR from all loaded candles (for side panel summary)
  const [vpResult, setVpResult] = useState<VPResult | null>(null)

  useEffect(() => {
    const allCandles = currentCandle ? [...candles, currentCandle] : candles
    if (allCandles.length < 5) {
      setVpResult(null)
      return
    }
    // Use all loaded candles for side panel (approximates visible range)
    const result = computeVisibleRangeVolumeProfile({
      candles,
      currentCandle,
      visibleFrom: Math.max(0, allCandles.length - 200),
      visibleTo: allCandles.length - 1,
      rowCount: 48,
    })
    setVpResult(result)
  }, [candles, currentCandle])

  // Draw the VPVR mini chart
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.parentElement?.clientWidth ?? 300
    const h = canvas.parentElement?.clientHeight ?? 200
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = showDimmed ? '#040609' : '#06090f'
    ctx.fillRect(0, 0, w, h)

    if (!vpResult || vpResult.levels.length === 0) {
      ctx.fillStyle = '#3d4f68'
      ctx.font = '11px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Waiting for volume data...', w / 2, h / 2)
      return
    }

    const levels = vpResult.levels
    const maxVol = Math.max(1, ...levels.map(l => l.volume))
    const barMaxW = w * 0.55
    const barH = Math.max(3, Math.min(14, (h - 16) / levels.length))
    const startY = 8

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i]
      const y = startY + i * barH
      const barW = (level.pctOfMax / 100) * barMaxW
      const isPOC = level.price === vpResult.poc.price

      // Bar
      if (isPOC) {
        ctx.fillStyle = 'rgba(79,195,247,0.45)'
      } else if (level.inValueArea) {
        if (level.buyVolume > 0 && level.sellVolume > 0) {
          const buyRatio = level.volume > 0 ? level.buyVolume / level.volume : 0.5
          const buyW = barW * buyRatio
          ctx.fillStyle = 'rgba(45,212,160,0.25)'
          ctx.fillRect(w - barW - 4, y, buyW, barH - 1)
          ctx.fillStyle = 'rgba(239,100,97,0.20)'
          ctx.fillRect(w - barW - 4 + buyW, y, barW - buyW, barH - 1)
          continue
        }
        ctx.fillStyle = 'rgba(79,195,247,0.22)'
      } else {
        ctx.fillStyle = 'rgba(79,195,247,0.08)'
      }
      ctx.fillRect(w - barW - 4, y, barW, barH - 1)

      // Price label (left) — only POC and every few levels
      if (isPOC || i === 0 || i === levels.length - 1) {
        ctx.fillStyle = isPOC ? 'rgba(79,195,247,0.8)' : '#4a5e78'
        ctx.font = `${isPOC ? 10 : 8}px "SF Mono", monospace`
        ctx.textAlign = 'left'
        const priceLabel = level.price >= 1000 ? level.price.toFixed(0) : level.price.toFixed(2)
        ctx.fillText(isPOC ? `● ${priceLabel}` : priceLabel, 4, y + barH - 3)
      }
    }

    // VAH/VAL markers
    const vahIdx = levels.findIndex(l => l.price >= vpResult.valueArea.high)
    const valIdx = levels.findIndex(l => l.price >= vpResult.valueArea.low)
    if (vahIdx >= 0) {
      const y = startY + vahIdx * barH
      ctx.strokeStyle = 'rgba(79,195,247,0.25)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (valIdx >= 0) {
      const y = startY + valIdx * barH
      ctx.strokeStyle = 'rgba(79,195,247,0.25)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      ctx.setLineDash([])
    }

  }, [vpResult, showDimmed])

  // VP data source label — separate from order book source
  const vpSourceLabel = vpResult?.metadata.hasFootprint ? 'Footprint'
    : vpResult ? 'Candle Approx'
    : ''

  return (
    <div className="heatmap-container" style={showDimmed ? { opacity: 0.6 } : undefined}>
      <div className="heatmap-header">
        Volume Profile{vpSourceLabel && (
          <span style={{ fontSize: 9, color: '#6b7d96', marginLeft: 8, fontFamily: 'monospace' }}>
            {vpSourceLabel}
          </span>
        )}
      </div>

      {/* VPVR Summary */}
      {vpResult && (
        <div className="vp-summary">
          <div className="vp-row">
            <span className="vp-label">POC</span>
            <span className="vp-value poc">{fmtPrice(vpResult.poc.price)}</span>
          </div>
          <div className="vp-row">
            <span className="vp-label">VAH</span>
            <span className="vp-value">{fmtPrice(vpResult.valueArea.high)}</span>
          </div>
          <div className="vp-row">
            <span className="vp-label">VAL</span>
            <span className="vp-value">{fmtPrice(vpResult.valueArea.low)}</span>
          </div>
          <div className="vp-row">
            <span className="vp-label">Volume</span>
            <span className="vp-value">{fmtNum(vpResult.metadata.totalVolume)}</span>
          </div>
          <div className="vp-row">
            <span className="vp-label">Range</span>
            <span className="vp-value dim">{vpResult.metadata.candleCount} candles</span>
          </div>
          {vpResult.metadata.hasFootprint && (
            <div className="vp-row">
              <span className="vp-label">Source</span>
              <span className="vp-value dim">Footprint</span>
            </div>
          )}
        </div>
      )}

      {/* VPVR Mini Chart */}
      <div className="heatmap-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
