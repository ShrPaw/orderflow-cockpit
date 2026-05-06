export interface Trade {
  id: number
  price: number
  qty: number
  side: 'buy' | 'sell'
  time: number
  notional: number
}

export interface Candle {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  buyVolume: number
  sellVolume: number
  delta: number
  tradeCount: number
  maxTradeSize: number
  largeTradeCount: number
  bubbleCount: number
  priceMap: Record<number, PriceLevel>
  bubbles: Bubble[]
}

export interface PriceLevel {
  buy: number
  sell: number
  total: number
  delta: number
  maxPrint: number
  trades: number
}

export interface Bubble {
  id: string
  timestamp: number
  candleTime: number
  price: number
  side: 'buy' | 'sell'
  volume: number
  notional: number
  state: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ABSORBED' | 'EXHAUSTED'
  confidence: number
  responseAt3s: PriceResponse | null
  responseAt10s: PriceResponse | null
}

export interface PriceResponse {
  price: number
  change: number
  changePct: number
  aligned: boolean
  magnitude: number
}

export interface OrderLevel {
  price: number
  qty: number
}

export interface VolumeLevel {
  price: number
  buy: number
  sell: number
  total: number
  delta: number
}

export interface HeatmapLevel {
  time: number
  price: number
  volume: number
  bidVolume: number
  askVolume: number
}

export type Interval = '10s' | '20s' | '40s' | '1m' | '3m' | '5m'
export type AppMode = 'demo' | 'live'

export const INTERVAL_MS: Record<Interval, number> = {
  '10s': 10_000,
  '20s': 20_000,
  '40s': 40_000,
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
}
