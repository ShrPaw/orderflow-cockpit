import { useRef, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { fmtQty } from '../utils/formatters'
import { getSpreadInfo } from '../utils/bookValidation'

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

export default function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)

  const isHealthy = orderBookHealth === 'HEALTHY'
  const isTop20 = orderBookHealth === 'TOP20'
  const isDegraded = orderBookHealth === 'DEGRADED'
  const isUsable = isHealthy || isTop20 || isDegraded
  const isTransitional = orderBookHealth === 'CONNECTING'
    || orderBookHealth === 'BUFFERING'
    || orderBookHealth === 'SNAPSHOT_LOADING'
    || orderBookHealth === 'SYNCING'

  // If we have data, show it (even during transitional states)
  const hasData = bids.length > 0 || asks.length > 0
  const showDimmed = (!isUsable && !hasData) || depthStale

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
    ctx.fillStyle = showDimmed ? '#040609' : '#06090f'
    ctx.fillRect(0, 0, w, h)

    const allLevels = [
      ...bids.slice(0, 10).map(b => ({ ...b, side: 'bid' as const })),
      ...asks.slice(0, 10).map(a => ({ ...a, side: 'ask' as const })),
    ]

    // If no data, show waiting message
    if (allLevels.length === 0) {
      ctx.fillStyle = '#3d4f68'
      ctx.font = '11px "SF Mono", monospace'
      ctx.textAlign = 'center'
      const msg = orderBookHealth === 'CONNECTING' ? 'Connecting...'
        : orderBookHealth === 'BUFFERING' ? 'Book buffering...'
        : orderBookHealth === 'SNAPSHOT_LOADING' ? 'Strict sync loading...'
        : orderBookHealth === 'SYNCING' ? 'Book syncing...'
        : 'Waiting for depth data...'
      ctx.fillText(msg, w / 2, h / 2)
      return
    }

    const prices = allLevels.map(l => l.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1
    const maxQty = Math.max(...allLevels.map(l => l.qty))
    const levelCount = allLevels.length
    const barH = Math.max(8, Math.min(28, (h - 20) / levelCount))

    // Moderate opacity for degraded/top20 modes
    const barAlpha = (isTop20 || isDegraded || showDimmed) ? 0.5 : 1.0

    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i]
      const y = h - ((level.price - minPrice) / priceRange) * (h - 20) - barH - 4
      const intensity = Math.min(1, level.qty / maxQty)
      const colorIdx = Math.min(3, Math.floor(intensity * 4))

      ctx.globalAlpha = barAlpha
      ctx.fillStyle = level.side === 'bid' ? BID_COLORS[colorIdx] : ASK_COLORS[colorIdx]
      ctx.fillRect(0, y, w, barH)

      const qtyBarW = Math.max(2, (intensity * 0.55) * w)
      const qtyColor = level.side === 'bid' ? 'rgba(45,212,160,0.12)' : 'rgba(239,100,97,0.12)'
      ctx.fillStyle = qtyColor
      ctx.fillRect(w - qtyBarW - 4, y + 2, qtyBarW, barH - 4)

      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + barH)
      ctx.lineTo(w, y + barH)
      ctx.stroke()

      ctx.fillStyle = '#4a5e78'
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'left'
      const priceLabel = level.price >= 1000 ? level.price.toFixed(0) : level.price.toFixed(2)
      ctx.fillText(priceLabel, 4, y + barH - 4)

      ctx.fillStyle = level.side === 'bid' ? 'rgba(45,212,160,0.7)' : 'rgba(239,100,97,0.7)'
      ctx.font = '10px "SF Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText(fmtQty(level.qty), w - 6, y + barH - 4)

      ctx.globalAlpha = 1.0
    }

    // Spread indicator — only if book is sane
    if (bids.length > 0 && asks.length > 0) {
      const spreadInfo = getSpreadInfo(bids, asks)
      if (spreadInfo.sane) {
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

        ctx.fillStyle = 'rgba(79,195,247,0.5)'
        ctx.font = '8px "SF Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`spread ${spreadInfo.spread.toFixed(1)} (${spreadInfo.spreadPct.toFixed(3)}%)`, w / 2, spreadMid - 3)
      }
    }
  }, [bids, asks, showDimmed, isTop20, isDegraded])

  const sourceLabel = orderBookSource === 'strict' ? ' STRICT'
    : orderBookSource === 'depth20' ? ' TOP-20'
    : ''

  const healthBadge =
    orderBookHealth === 'STALE' ? ' ⚠STALE' :
    orderBookHealth === 'ERROR' ? ' ❌' :
    ''

  return (
    <div className="heatmap-container" style={showDimmed ? { opacity: 0.6 } : undefined}>
      <div className="heatmap-header">
        Liquidity Depth{healthBadge}
        {sourceLabel && (
          <span style={{ fontSize: 9, color: '#4fc3f7', marginLeft: 8, fontFamily: 'monospace' }}>
            {sourceLabel}
          </span>
        )}
      </div>
      <div className="heatmap-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
