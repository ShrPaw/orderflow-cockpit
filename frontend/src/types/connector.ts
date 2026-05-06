export type DataSource = 'demo' | 'hyperliquid' | 'binance';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export type OrderBookStatus =
  | 'disconnected'
  | 'connecting'
  | 'buffering'        // receiving WS events, waiting for REST snapshot
  | 'snapshot_loading' // fetching REST snapshot
  | 'synced'           // book is live and sequence-validated
  | 'resyncing'        // sequence break detected, restarting
  | 'stale'            // no depth events for >3s
  | 'error';

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

export interface DepthEvent {
  eventType: 'depthUpdate';
  eventTime: number;      // E
  transactionTime: number; // T
  symbol: string;          // s
  firstUpdateId: number;   // U
  finalUpdateId: number;   // u
  prevFinalUpdateId: number; // pu (not always present in all stream variants)
  bids: [number, number][]; // [price, qty] - absolute quantities
  asks: [number, number][]; // [price, qty] - absolute quantities
}

export interface DepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface NormalizedBookUpdate {
  bids: [number, number][];  // [price, size] - absolute
  asks: [number, number][];  // [price, size] - absolute
  timestamp: number;
  updateId: number;          // final update id (u)
  firstUpdateId: number;     // first update id (U)
  prevFinalUpdateId: number; // pu
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

export interface OrderBookDiagnostics {
  status: OrderBookStatus;
  lastUpdateId: number;
  lastAppliedUpdateId: number;
  prevFinalUpdateId: number;
  bufferedEventCount: number;
  sequenceBreakCount: number;
  lastDepthEventTime: number;
  bookAgeMs: number;
  bidLevelCount: number;
  askLevelCount: number;
  streamSpeed: '100ms' | '500ms' | 'default';
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
  onSnapshot(callback: (snapshot: DepthSnapshot) => void): void;
  onStatusChange(callback: (status: ConnectionStatus) => void): void;
  onDiagnostics(callback: (diag: Partial<OrderBookDiagnostics>) => void): void;
  getStatus(): ConnectionStatus;
  getBookStatus(): OrderBookStatus;
  getName(): string;
  setStreamSpeed(speed: '100ms' | '500ms' | 'default'): void;
}
