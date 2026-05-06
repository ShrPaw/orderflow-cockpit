export type DataSource = 'demo' | 'hyperliquid' | 'binance';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface NormalizedTrade {
  id: string;
  exchange: string;
  symbol: string;
  timestamp: number;
  price: number;
  size: number;
  aggressorSide: 'buy' | 'sell';
  notional: number;
  raw?: unknown;
}

export interface NormalizedBookUpdate {
  bids: [number, number][];  // [price, size]
  asks: [number, number][];  // [price, size]
  timestamp: number;
  updateId: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface LocalOrderBook {
  bids: Map<number, number>;  // price -> size
  asks: Map<number, number>;  // price -> size
  bestBid: number;
  bestAsk: number;
  spread: number;
  lastUpdateId: number;
  lastUpdated: number;
}

export interface HeatmapCell {
  price: number;
  side: 'bid' | 'ask';
  size: number;
  intensity: number;  // 0-1 normalized
  timestamp: number;
}

export interface MarketDataConnector {
  connect(): void;
  disconnect(): void;
  onTrade(callback: (trade: NormalizedTrade) => void): void;
  onStatusChange(callback: (status: ConnectionStatus) => void): void;
  getStatus(): ConnectionStatus;
  getName(): string;
}

export interface DepthConnector {
  connect(): void;
  disconnect(): void;
  onBookUpdate(callback: (update: NormalizedBookUpdate) => void): void;
  onStatusChange(callback: (status: ConnectionStatus) => void): void;
  getStatus(): ConnectionStatus;
  getName(): string;
}
