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

/**
 * Format order book quantities with meaningful precision.
 * Designed for BTC futures where quantities like 0.0010 must not display as "0".
 *
 * Examples:
 *   0.0010 → "0.0010"
 *   0.0050 → "0.0050"
 *   0.0123 → "0.0123"
 *   0.1234 → "0.1234"
 *   1.2345 → "1.23"
 *   12.5   → "12.5"
 *   123.4  → "123"
 *   1234   → "1.2k"
 */
export function fmtQty(qty: number | null | undefined): string {
  if (qty == null || isNaN(qty)) return '—'
  if (qty >= 1e9) return (qty / 1e9).toFixed(1) + 'B'
  if (qty >= 1e6) return (qty / 1e6).toFixed(1) + 'M'
  if (qty >= 1e3) return (qty / 1e3).toFixed(1) + 'K'
  if (qty >= 100) return qty.toFixed(0)
  if (qty >= 10) return qty.toFixed(1)
  if (qty >= 1) return qty.toFixed(2)
  if (qty >= 0.01) return qty.toFixed(4)
  // Small BTC quantities — preserve 4 decimal places minimum
  return qty.toFixed(4)
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
