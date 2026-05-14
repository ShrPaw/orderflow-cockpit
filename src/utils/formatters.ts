export function fmtPrice(p: number | null | undefined): string {
  if (p == null || isNaN(p)) return '—'
  if (Math.abs(p) >= 1000) return p.toFixed(1)
  if (Math.abs(p) >= 100) return p.toFixed(2)
  if (Math.abs(p) >= 1) return p.toFixed(3)
  if (Math.abs(p) >= 0.01) return p.toFixed(4)
  return p.toFixed(6)
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10) return n.toFixed(1)
  if (Math.abs(n) >= 1) return n.toFixed(2)
  if (Math.abs(n) >= 0.01) return n.toFixed(4)
  return n.toFixed(6)
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false })
}

export function priceBin(price: number): number {
  if (price > 10000) return 10
  if (price > 1000) return 5
  if (price > 100) return 1
  if (price > 10) return 0.1
  if (price > 1) return 0.01
  return 0.001
}
