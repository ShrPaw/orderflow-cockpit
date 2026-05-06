import type { Trade, OrderLevel } from '../types/market'

let tradeIdCounter = 1_000_000
let basePrice = 65000 + Math.random() * 2000
let drift = 0

export function resetDemoPrice(price?: number) {
  basePrice = price ?? 65000 + Math.random() * 2000
  drift = 0
}

export function generateDemoTrade(): Trade {
  // Random walk with mean reversion
  drift += (Math.random() - 0.5) * 8
  drift *= 0.98 // dampen
  basePrice += drift + (Math.random() - 0.5) * 3
  if (basePrice < 50000) basePrice = 50000 + Math.random() * 1000
  if (basePrice > 100000) basePrice = 100000 - Math.random() * 1000

  const price = basePrice + (Math.random() - 0.5) * 10
  const isBuy = Math.random() > 0.48
  const qty = Math.random() < 0.05
    ? 0.01 + Math.random() * 0.5 // large trade
    : 0.001 + Math.random() * 0.02 // normal trade

  return {
    id: ++tradeIdCounter,
    price: Math.round(price * 10) / 10,
    qty: Math.round(qty * 10000) / 10000,
    side: isBuy ? 'buy' : 'sell',
    time: Date.now(),
    notional: price * qty,
  }
}

export function generateDemoDepth(): { bids: OrderLevel[]; asks: OrderLevel[] } {
  const spread = 1 + Math.random() * 5
  const bestBid = basePrice - spread / 2
  const bestAsk = basePrice + spread / 2

  const bids: OrderLevel[] = []
  const asks: OrderLevel[] = []

  for (let i = 0; i < 20; i++) {
    const bidPrice = Math.round((bestBid - i * (1 + Math.random() * 2)) * 10) / 10
    const askPrice = Math.round((bestAsk + i * (1 + Math.random() * 2)) * 10) / 10
    const bidQty = Math.round((0.01 + Math.random() * 2 + (i < 3 ? Math.random() * 5 : 0)) * 10000) / 10000
    const askQty = Math.round((0.01 + Math.random() * 2 + (i < 3 ? Math.random() * 5 : 0)) * 10000) / 10000
    bids.push({ price: bidPrice, qty: bidQty })
    asks.push({ price: askPrice, qty: askQty })
  }

  return { bids, asks }
}

export function getDemoBasePrice(): number {
  return basePrice
}
