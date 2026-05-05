export interface Trade {
  id: string;
  timestamp: number;
  price: number;
  quantity: number;
  aggressor: 'buy' | 'sell';
  exchange: string;
  symbol: string;
  isLiquidation?: boolean;
}

export interface FootprintCell {
  price: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  tradeCount: number;
}

export interface FootprintCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  poc: number;
  cells: Map<number, FootprintCell>;
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
}

export interface VolumeProfile {
  levels: VolumeProfileLevel[];
  poc: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  totalVolume: number;
}

export interface BigTrade {
  trade: Trade;
  notional: number;
  sizeCategory: 'small' | 'medium' | 'large' | 'extreme';
}

export interface ChartViewport {
  startTime: number;
  endTime: number;
  priceLow: number;
  priceHigh: number;
  candleWidthPx: number;
  pricePerPixel: number;
}

export interface SessionStats {
  totalVolume: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  netDelta: number;
  highPrice: number;
  lowPrice: number;
  tradeCount: number;
  vwap: number;
  bigTradeCount: number;
}

export type Timeframe = '1s' | '5s' | '15s' | '30s' | '1m' | '5m' | '15m';

export interface AlertConfig {
  largeTradeThreshold: number;
  absorptionEnabled: boolean;
  imbalanceEnabled: boolean;
}
