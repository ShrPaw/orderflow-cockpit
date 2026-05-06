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

export interface MarketDataConnector {
  connect(): void;
  disconnect(): void;
  onTrade(callback: (trade: NormalizedTrade) => void): void;
  onStatusChange(callback: (status: ConnectionStatus) => void): void;
  getStatus(): ConnectionStatus;
  getName(): string;
}
