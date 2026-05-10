import { useRef, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'

const BID_COLORS = [
  'rgba(45,212,160,0.06)',
  'rgba(45,212,160,0.15)',
  'rgba(45,212,160,0.28)',
  'rgba(45,212,160,0.50)',
]
const ASK_COLORS = [
  'rgba(239,100,97,0.06)',
  'rgba(239,100,97,0.15)',
  'rgba(239,100,97,0.28)',
  'rgba(239,100,97,0.50)',
]

function fmtQty(qty: number): string {
  if (qty >= 1000) return (qty / 1000).toFixed(1) + 'k'
  if (qty >= 100) return qty.toFixed(0)
  if (qty >= 10) return qty.toFixed(1)
  if (qty >= 1) return qty.toFixed(2)
  return qty.toFixed(4)
}

export default function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)

  const isHealthy = orderBookHealth === 'HEALTHY'
  const isDegraded = orderBookHealth === 'DEGRADED'
  const isUsable = isHealthy || isDegraded
  // Transitional states: no validated book data, stale bids/asks from previous connection
  const isTransitional = orderBookHealth === 'CONNECTING'
    || orderBookHealth === 'BUFFERING'
    || orderBookHealth === 'SNAPSHOT_LOADING'
    || orderBookHealth === 'SYNCING'
  const showWarning = !isUsable || depthStale || isTransitional

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
    ctx.scale(dpr, dpr)

    // Dim background when not fully live
    ctx.fillStyle = showWarning ? '#040609' : '#06090f'
    ctx.fillRect(0, 0, w, h)

    const allLevels = [
      ...bids.slice(0, 10).map(b => ({ ...b, side: 'bid' as const })),
      ...asks.slice(0, 10).map(a => ({ ...a, side: 'ask' as const })),
    ]

    // During transitional states, don't draw stale liquidity data
    if (isTransitional) {
      ctx.fillStyle = '#3d4f68'
      ctx.font = '11px "SF Mono", monospace'
      ctx.textAlign = 'center'
      const msg = orderBookHealth === 'BUFFERING' ? 'Book buffering…'
        : orderBookHealth === 'SNAPSHOT_LOADING' ? 'Snapshot loading…'
        : orderBookHealth === 'SYNCING' ? 'Book syncing…'
        : 'Connecting…'
      ctx.fillText(msg, w / 2, h / 2)
      return
    }

    if (allLevels.length === 0) {
      ctx.fillStyle = '#3d4f68'
      ctx.font = '11px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Waiting for depth data…', w / 2, h / 2)
      return
    }

    const prices = allLevels.map(l => l.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1
    const maxQty = Math.max(...allLevels.map(l => l.qty))
    const levelCount = allLevels.length
    const barH = Math.max(8, Math.min(28, (h - 20) / levelCount))

    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i]
      const y = h - ((level.price - minPrice) / priceRange) * (h - 20) - barH - 4
      const intensity = Math.min(1, level.qty / maxQty)
      const colorIdx = Math.min(3, Math.floor(intensity * 4))

      // Bar background — dim when degraded or stale
      const barAlpha = showWarning ? 0.3 : 1.0
      ctx.globalAlpha = barAlpha
      ctx.fillStyle = level.side === 'bid' ? BID_COLORS[colorIdx] : ASK_COLORS[colorIdx]
      ctx.fillRect(0, y, w, barH)

      // Volume bar (right-aligned, proportional)
      const qtyBarW = Math.max(2, (intensity * 0.55) * w)
      const qtyColor = level.side === 'bid' ? 'rgba(45,212,160,0.12)' : 'rgba(239,100,97,0.12)'
      ctx.fillStyle = qtyColor
      ctx.fillRect(w - qtyBarW - 4, y + 2, qtyBarW, barH - 4)

      // Border between levels
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + barH)
      ctx.lineTo(w, y + barH)
      ctx.stroke()

      // Price label (left side)
      ctx.fillStyle = '#4a5e78'
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'left'
      const priceLabel = level.price >= 1000 ? level.price.toFixed(0) : level.price.toFixed(2)
      ctx.fillText(priceLabel, 4, y + barH - 4)

      // Qty label (right side)
      ctx.fillStyle = level.side === 'bid' ? 'rgba(45,212,160,0.7)' : 'rgba(239,100,97,0.7)'
      ctx.font = '10px "SF Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText(fmtQty(level.qty), w - 6, y + barH - 4)

      ctx.globalAlpha = 1.0
    }

    // Spread indicator between bid/ask groups
    if (bids.length > 0 && asks.length > 0) {
      const bestBidY = h - ((bids[0].price - minPrice) / priceRange) * (h - 20) - barH - 4
      const bestAskY = h - ((asks[0].price - minPrice) / priceRange) * (h - 20) - barH - 4
      const spreadMid = (bestBidY + bestAskY + barH) / 2

      ctx.strokeStyle = 'rgba(79,195,247,0.2)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(0, spreadMid)
      ctx.lineTo(w, spreadMid)
      ctx.stroke()
      ctx.setLineDash([])

      // Spread label
      const spread = asks[0].price - bids[0].price
      const spreadPct = bids[0].price > 0 ? (spread / bids[0].price * 100) : 0
      ctx.fillStyle = 'rgba(79,195,247,0.5)'
      ctx.font = '8px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`spread ${spread.toFixed(1)} (${spreadPct.toFixed(3)}%)`, w / 2, spreadMid - 3)
    }
  }, [bids, asks, showWarning])

  const healthLabel =
    orderBookHealth === 'HEALTHY' ? '' :
    orderBookHealth === 'DEGRADED' ? ' 📉' :
    orderBookHealth === 'CONNECTING' ? ' ⏳' :
    orderBookHealth === 'BUFFERING' ? ' ⏳' :
    orderBookHealth === 'SNAPSHOT_LOADING' ? ' ⏳' :
    orderBookHealth === 'SYNCING' ? ' ⏳' :
    orderBookHealth === 'RESYNCING' ? ' 🔄' :
    orderBookHealth === 'STALE' ? ' ⚠STALE' :
    orderBookHealth === 'ERROR' ? ' ❌' :
    ' ⚠'

  return (
    <div className="heatmap-container" style={showWarning ? { opacity: 0.6 } : undefined}>
      <div className="heatmap-header">
        Liquidity Depth{healthLabel}
        {isDegraded && (
          <span style={{ fontSize: 9, color: '#ef6461', marginLeft: 8, fontFamily: 'monospace' }}>
            DEGRADED TOP-20
          </span>
        )}
        {showWarning && !isDegraded && orderBookHealth !== 'HEALTHY' && (
          <span style={{ fontSize: 9, color: '#e4a73b', marginLeft: 8, fontFamily: 'monospace' }}>
            overlays paused
          </span>
        )}
      </div>
      <div className="heatmap-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
