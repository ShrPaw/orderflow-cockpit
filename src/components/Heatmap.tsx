import { useRef, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { fmtQty, fmtPrice } from '../utils/formatters'
import { getSpreadInfo } from '../utils/bookValidation'

const BID_COLORS = [
  'rgba(45,212,160,0.08)',
  'rgba(45,212,160,0.18)',
  'rgba(45,212,160,0.32)',
  'rgba(45,212,160,0.55)',
]
const ASK_COLORS = [
  'rgba(239,100,97,0.08)',
  'rgba(239,100,97,0.18)',
  'rgba(239,100,97,0.32)',
  'rgba(239,100,97,0.55)',
]

export default function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const livePrice = useMarketStore(s => s.livePrice)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)

  const isHealthy = orderBookHealth === 'HEALTHY'
  const isTop20 = orderBookHealth === 'TOP20'
  const isDegraded = orderBookHealth === 'DEGRADED'
  const isUsable = isHealthy || isTop20 || isDegraded

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

    ctx.fillStyle = showDimmed ? '#040609' : '#06090f'
    ctx.fillRect(0, 0, w, h)

    // Build sorted ladder: asks on top (ascending), bids below (descending)
    const sortedAsks = asks.slice(0, 10).sort((a, b) => a.price - b.price)
    const sortedBids = bids.slice(0, 10).sort((a, b) => b.price - a.price)
    const allLevels = [
      ...sortedAsks.map(a => ({ ...a, side: 'ask' as const })),
      ...sortedBids.map(b => ({ ...b, side: 'bid' as const })),
    ]

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
    const maxQty = Math.max(1, ...allLevels.map(l => l.qty))
    const levelCount = allLevels.length
    const barH = Math.max(12, Math.min(32, (h - 24) / levelCount))
    const barAlpha = (isTop20 || isDegraded || showDimmed) ? 0.6 : 1.0

    // Spread info
    const spreadInfo = getSpreadInfo(bids, asks)
    const spreadMid = h / 2

    // Draw spread gap indicator
    if (spreadInfo.sane && sortedBids.length > 0 && sortedAsks.length > 0) {
      const bestBidY = h - ((sortedBids[0].price - minPrice) / priceRange) * (h - 24) - barH - 6
      const bestAskY = h - ((sortedAsks[0].price - minPrice) / priceRange) * (h - 24) - barH - 6
      const gapMid = (bestBidY + bestAskY + barH) / 2

      // Spread line
      ctx.strokeStyle = 'rgba(79,195,247,0.15)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(0, gapMid)
      ctx.lineTo(w, gapMid)
      ctx.stroke()
      ctx.setLineDash([])

      // Spread label
      ctx.fillStyle = 'rgba(79,195,247,0.5)'
      ctx.font = '8px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`Spread ${fmtPrice(spreadInfo.spread)} (${spreadInfo.spreadPct.toFixed(3)}%)`, w / 2, gapMid - 4)
    }

    // Draw each level as a clear row
    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i]
      const y = h - ((level.price - minPrice) / priceRange) * (h - 24) - barH - 6
      const intensity = Math.min(1, level.qty / maxQty)
      const colorIdx = Math.min(3, Math.floor(intensity * 4))

      ctx.globalAlpha = barAlpha

      // Background bar
      ctx.fillStyle = level.side === 'bid' ? BID_COLORS[colorIdx] : ASK_COLORS[colorIdx]
      ctx.fillRect(0, y, w, barH)

      // Quantity bar (right-aligned)
      const qtyBarW = Math.max(2, (intensity * 0.5) * w)
      ctx.fillStyle = level.side === 'bid' ? 'rgba(45,212,160,0.10)' : 'rgba(239,100,97,0.10)'
      ctx.fillRect(w - qtyBarW - 4, y + 2, qtyBarW, barH - 4)

      // Row separator
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + barH)
      ctx.lineTo(w, y + barH)
      ctx.stroke()

      // Price label (left)
      ctx.fillStyle = '#6b8098'
      ctx.font = '10px "SF Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(fmtPrice(level.price), 6, y + barH - 5)

      // Quantity label (right)
      const sideColor = level.side === 'bid' ? 'rgba(45,212,160,0.8)' : 'rgba(239,100,97,0.8)'
      ctx.fillStyle = sideColor
      ctx.font = '11px "SF Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText(fmtQty(level.qty), w - 6, y + barH - 5)

      // Distance from live price
      if (livePrice > 0) {
        const distPct = ((level.price - livePrice) / livePrice) * 100
        const distStr = distPct >= 0 ? `+${distPct.toFixed(2)}%` : `${distPct.toFixed(2)}%`
        ctx.fillStyle = 'rgba(107,125,150,0.5)'
        ctx.font = '8px "SF Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(distStr, w - 6, y + barH - 16)
      }

      ctx.globalAlpha = 1.0
    }

    // Imbalance indicator
    const bidTotal = sortedBids.reduce((s, b) => s + b.qty, 0)
    const askTotal = sortedAsks.reduce((s, a) => s + a.qty, 0)
    if (bidTotal + askTotal > 0) {
      const imbalance = ((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
      const imbLabel = imbalance > 15 ? `Bid-heavy ${imbalance.toFixed(0)}%`
        : imbalance < -15 ? `Ask-heavy ${Math.abs(imbalance).toFixed(0)}%`
        : 'Balanced'
      const imbColor = imbalance > 15 ? 'rgba(45,212,160,0.5)'
        : imbalance < -15 ? 'rgba(239,100,97,0.5)'
        : 'rgba(107,125,150,0.4)'
      ctx.fillStyle = imbColor
      ctx.font = '9px "SF Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(imbLabel, w / 2, h - 4)
    }

  }, [bids, asks, livePrice, showDimmed, isTop20, isDegraded, orderBookHealth])

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
        Liquidity Ladder{healthBadge}
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
