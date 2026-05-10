import { useRef, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'

const BID_COLORS = [
  'rgba(45,212,160,0.04)',
  'rgba(45,212,160,0.12)',
  'rgba(45,212,160,0.22)',
  'rgba(45,212,160,0.45)',
]
const ASK_COLORS = [
  'rgba(239,100,97,0.04)',
  'rgba(239,100,97,0.12)',
  'rgba(239,100,97,0.22)',
  'rgba(239,100,97,0.45)',
]

export default function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)

  const isReliable = orderBookHealth === 'HEALTHY'
  const showWarning = !isReliable || depthStale

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

    ctx.fillStyle = '#06090f'
    ctx.fillRect(0, 0, w, h)

    const allLevels = [
      ...bids.slice(0, 10).map(b => ({ ...b, side: 'bid' as const })),
      ...asks.slice(0, 10).map(a => ({ ...a, side: 'ask' as const })),
    ]

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
    const barH = Math.max(3, h / allLevels.length)

    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i]
      const y = h - ((level.price - minPrice) / priceRange) * h - barH
      const intensity = Math.min(1, level.qty / maxQty)
      const colorIdx = Math.min(3, Math.floor(intensity * 4))

      ctx.fillStyle = level.side === 'bid' ? BID_COLORS[colorIdx] : ASK_COLORS[colorIdx]
      ctx.fillRect(0, y, w, barH)

      // Subtle border between levels
      ctx.strokeStyle = 'rgba(255,255,255,0.02)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + barH)
      ctx.lineTo(w, y + barH)
      ctx.stroke()

      // Price label
      if (i % 2 === 0) {
        ctx.fillStyle = '#3d4f68'
        ctx.font = '9px "SF Mono", monospace'
        ctx.textAlign = 'left'
        ctx.fillText(level.price.toFixed(0), 4, y + barH - 3)
      }

      // Qty bar
      const qtyBarW = (intensity * 0.6) * w
      const qtyColor = level.side === 'bid' ? 'rgba(45,212,160,0.12)' : 'rgba(239,100,97,0.12)'
      ctx.fillStyle = qtyColor
      ctx.fillRect(w - qtyBarW - 4, y + 2, qtyBarW, barH - 4)
    }
  }, [bids, asks])

  const healthLabel =
    orderBookHealth === 'HEALTHY' ? '' :
    orderBookHealth === 'CONNECTING' ? ' ⏳' :
    orderBookHealth === 'SYNCING' ? ' ⏳' :
    orderBookHealth === 'RESYNCING' ? ' 🔄' :
    orderBookHealth === 'STALE' ? ' ⚠STALE' :
    orderBookHealth === 'ERROR' ? ' ❌' :
    ' ⚠'

  return (
    <div className="heatmap-container" style={showWarning ? { opacity: 0.5 } : undefined}>
      <div className="heatmap-header">Liquidity Depth{healthLabel}</div>
      {showWarning && (
        <div style={{ padding: '2px 8px', fontSize: 9, color: '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          {!isReliable ? 'Book not synchronized — overlays paused' : 'Stale — resyncing…'}
        </div>
      )}
      <div className="heatmap-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
