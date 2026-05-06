import { useRef, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'

const COLORS_BID = ['rgba(34,197,94,0.05)', 'rgba(34,197,94,0.2)', 'rgba(34,197,94,0.5)', 'rgba(34,197,94,0.8)']
const COLORS_ASK = ['rgba(239,68,68,0.05)', 'rgba(239,68,68,0.2)', 'rgba(239,68,68,0.5)', 'rgba(239,68,68,0.8)']

export default function Heatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heatmapLevels = useMarketStore(s => s.heatmapLevels)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)

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

    ctx.fillStyle = '#0a0e17'
    ctx.fillRect(0, 0, w, h)

    if (heatmapLevels.length === 0 && bids.length === 0) {
      ctx.fillStyle = '#3d4a5e'
      ctx.font = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Waiting for depth data...', w / 2, h / 2)
      return
    }

    // Use current depth snapshot as heatmap
    const allLevels = [...bids.slice(0, 10).map(b => ({ ...b, side: 'bid' as const })),
                       ...asks.slice(0, 10).map(a => ({ ...a, side: 'ask' as const }))]

    if (allLevels.length === 0) return

    const prices = allLevels.map(l => l.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const priceRange = maxPrice - minPrice || 1

    const maxQty = Math.max(...allLevels.map(l => l.qty))
    const barH = Math.max(2, h / allLevels.length)

    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i]
      const y = h - ((level.price - minPrice) / priceRange) * h - barH
      const intensity = level.qty / maxQty
      const colorIdx = Math.min(3, Math.floor(intensity * 4))

      ctx.fillStyle = level.side === 'bid' ? COLORS_BID[colorIdx] : COLORS_ASK[colorIdx]
      ctx.fillRect(0, y, w, barH)

      // Label
      if (i % 2 === 0) {
        ctx.fillStyle = '#3d4a5e'
        ctx.font = '9px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(level.price.toFixed(0), 4, y + barH - 2)
      }
    }
  }, [heatmapLevels, bids, asks])

  return (
    <div className="heatmap-container">
      <div className="heatmap-header">Liquidity Heatmap</div>
      <div className="heatmap-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
