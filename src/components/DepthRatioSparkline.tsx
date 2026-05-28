import { useRef, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'

const MAX_POINTS = 40

export default function DepthRatioSparkline() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ratiosRef = useRef<number[]>([])

  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)

  // Compute current ratio and push to buffer
  const bidTotal = bids.slice(0, 10).reduce((s, b) => s + b.qty, 0)
  const askTotal = asks.slice(0, 10).reduce((s, a) => s + a.qty, 0)
  const ratio = askTotal > 0 ? bidTotal / askTotal : bidTotal > 0 ? 99 : 1

  const buf = ratiosRef.current
  buf.push(ratio)
  if (buf.length > MAX_POINTS) buf.shift()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    if (w === 0 || h === 0) return

    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const data = ratiosRef.current
    if (data.length < 2) return

    // Clamp ratio for display: 0.2..5 range, log-scale to center on 1:1
    const clampRatio = (r: number) => Math.max(0.2, Math.min(5, r))
    const logTransform = (r: number) => Math.log2(clampRatio(r))
    // log2(1) = 0 => center, log2(0.2) = -2.32, log2(5) = 2.32
    const maxLog = Math.log2(5)
    const center = h / 2

    // Map a ratio to y: center = 1:1, above center = bid heavy (green), below = ask heavy (red)
    const ratioToY = (r: number): number => {
      const logVal = logTransform(r)
      return center - (logVal / maxLog) * (h / 2 - 2)
    }

    // Draw subtle center line (1:1 ratio)
    ctx.strokeStyle = 'rgba(106,128,152,0.20)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, center)
    ctx.lineTo(w, center)
    ctx.stroke()

    // Build path points
    const stepX = w / (MAX_POINTS - 1)
    const offset = MAX_POINTS - data.length
    const points: { x: number; y: number; ratio: number }[] = []
    for (let i = 0; i < data.length; i++) {
      const x = (offset + i) * stepX
      const y = ratioToY(data[i])
      points.push({ x, y, ratio: data[i] })
    }

    // Draw the sparkline with gradient fill below/above center
    // First, the line itself
    ctx.lineWidth = 1.2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    // Draw segments with color based on ratio
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]
      const avgRatio = (p0.ratio + p1.ratio) / 2

      if (avgRatio >= 1) {
        ctx.strokeStyle = '#2dd4a0'
      } else {
        ctx.strokeStyle = '#ef6461'
      }

      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
    }

    // Subtle fill area between line and center
    ctx.globalAlpha = 0.08
    // Green fill above center (bid heavy)
    ctx.beginPath()
    ctx.moveTo(points[0].x, center)
    for (const p of points) {
      ctx.lineTo(p.x, Math.min(p.y, center))
    }
    ctx.lineTo(points[points.length - 1].x, center)
    ctx.closePath()
    ctx.fillStyle = '#2dd4a0'
    ctx.fill()

    // Red fill below center (ask heavy)
    ctx.beginPath()
    ctx.moveTo(points[0].x, center)
    for (const p of points) {
      ctx.lineTo(p.x, Math.max(p.y, center))
    }
    ctx.lineTo(points[points.length - 1].x, center)
    ctx.closePath()
    ctx.fillStyle = '#ef6461'
    ctx.fill()
    ctx.globalAlpha = 1.0
  })

  return <canvas ref={canvasRef} />
}
