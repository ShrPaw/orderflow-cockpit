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

// ─── 24h Market Stats ───
export interface Ticker24h {
  price: number
  change: number
  changePct: number
  high: number
  low: number
  volume: number
  quoteVolume: number
  trades: number
}

// ─── Instrument Catalog ───
export interface Instrument {
  symbol: string
  base: string
  quote: string
  category: 'major' | 'alt' | 'defi' | 'meme'
  tickSize: number
  qtyPrecision: number
}

export const INSTRUMENTS: Instrument[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', category: 'major', tickSize: 0.1, qtyPrecision: 3 },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', category: 'major', tickSize: 0.01, qtyPrecision: 3 },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', category: 'major', tickSize: 0.01, qtyPrecision: 2 },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', category: 'major', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT', category: 'major', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT', category: 'meme', tickSize: 0.00001, qtyPrecision: 0 },
  { symbol: 'ADAUSDT', base: 'ADA', quote: 'USDT', category: 'alt', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT', category: 'alt', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'DOTUSDT', base: 'DOT', quote: 'USDT', category: 'alt', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'LINKUSDT', base: 'LINK', quote: 'USDT', category: 'defi', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'MATICUSDT', base: 'MATIC', quote: 'USDT', category: 'defi', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'UNIUSDT', base: 'UNI', quote: 'USDT', category: 'defi', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'ATOMUSDT', base: 'ATOM', quote: 'USDT', category: 'alt', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'LTCUSDT', base: 'LTC', quote: 'USDT', category: 'alt', tickSize: 0.01, qtyPrecision: 2 },
  { symbol: 'NEARUSDT', base: 'NEAR', quote: 'USDT', category: 'alt', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'ARBUSDT', base: 'ARB', quote: 'USDT', category: 'defi', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'OPUSDT', base: 'OP', quote: 'USDT', category: 'defi', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'APTUSDT', base: 'APT', quote: 'USDT', category: 'alt', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'SUIUSDT', base: 'SUI', quote: 'USDT', category: 'alt', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'PEPEUSDT', base: 'PEPE', quote: 'USDT', category: 'meme', tickSize: 0.00000001, qtyPrecision: 0 },
  { symbol: 'WIFUSDT', base: 'WIF', quote: 'USDT', category: 'meme', tickSize: 0.0001, qtyPrecision: 0 },
  { symbol: 'FILUSDT', base: 'FIL', quote: 'USDT', category: 'alt', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'INJUSDT', base: 'INJ', quote: 'USDT', category: 'defi', tickSize: 0.001, qtyPrecision: 1 },
  { symbol: 'AAVEUSDT', base: 'AAVE', quote: 'USDT', category: 'defi', tickSize: 0.01, qtyPrecision: 2 },
]
