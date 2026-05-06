import { create } from 'zustand';
import { Trade, FootprintCandle, VolumeProfile, BigTrade, SessionStats, Timeframe, ChartViewport } from '../types';
import { DataSource, ConnectionStatus, NormalizedTrade } from '../types/connector';
import { MarketDataGenerator, aggregateIntoFootprints, calculateVolumeProfile, detectBigTrades, calculateSessionStats } from '../utils/dataGenerator';
import { BinanceFuturesConnector } from '../connectors/binance';
import { HyperliquidConnector } from '../connectors/hyperliquid';
import type { MarketDataConnector } from '../types/connector';

const MAX_TRADES = 50000;
const MAX_CANDLES = 2000;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1s': 1000, '5s': 5000, '15s': 15000, '30s': 30000,
  '1m': 60000, '5m': 300000, '15m': 900000,
};

interface MarketState {
  // Data
  trades: Trade[];
  candles: FootprintCandle[];
  volumeProfile: VolumeProfile;
  bigTrades: BigTrade[];
  sessionStats: SessionStats;
  cvdHistory: { timestamp: number; value: number }[];
  currentPrice: number;

  // Settings
  timeframe: Timeframe;
  dataSource: DataSource;
  tickSize: number;
  bigTradeThresholds: { medium: number; large: number; extreme: number };
  showBigTrades: boolean;
  showVolumeProfile: boolean;
  showCVD: boolean;
  showDelta: boolean;
  bigTradeFilter: 'all' | 'medium' | 'large' | 'extreme';

  // Connection state
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  exchangeName: string;
  lastTradeTimestamp: number;
  tradesPerSecond: number;
  isPaused: boolean;

  // Internal
  connector: MarketDataConnector | null;
  generator: MarketDataGenerator | null;
  viewport: ChartViewport;
  tradeTimestamps: number[];

  // Actions
  setDataSource: (source: DataSource) => void;
  init: () => void;
  tick: () => void;
  setTimeframe: (tf: Timeframe) => void;
  setTickSize: (ts: number) => void;
  setPaused: (p: boolean) => void;
  setViewport: (v: Partial<ChartViewport>) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  panLeft: () => void;
  panRight: () => void;
  setShowBigTrades: (v: boolean) => void;
  setShowVolumeProfile: (v: boolean) => void;
  setShowCVD: (v: boolean) => void;
  setShowDelta: (v: boolean) => void;
  setBigTradeFilter: (f: 'all' | 'medium' | 'large' | 'extreme') => void;
  setBigTradeThresholds: (t: { medium: number; large: number; extreme: number }) => void;
  reconnect: () => void;
}

function normalizedToTrade(n: NormalizedTrade): Trade {
  return {
    id: n.id,
    timestamp: n.timestamp,
    price: n.price,
    quantity: n.size,
    aggressor: n.aggressorSide,
    exchange: n.exchange,
    symbol: n.symbol,
  };
}

export const useMarketStore = create<MarketState>((set, get) => ({
  trades: [],
  candles: [],
  volumeProfile: { levels: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, totalVolume: 0 },
  bigTrades: [],
  sessionStats: { totalVolume: 0, totalBuyVolume: 0, totalSellVolume: 0, netDelta: 0, highPrice: 0, lowPrice: 0, tradeCount: 0, vwap: 0, bigTradeCount: 0 },
  cvdHistory: [],
  currentPrice: 0,
  timeframe: '5s',
  dataSource: 'demo',
  tickSize: 10,
  bigTradeThresholds: { medium: 100000, large: 500000, extreme: 1000000 },
  showBigTrades: true,
  showVolumeProfile: true,
  showCVD: true,
  showDelta: true,
  bigTradeFilter: 'all',
  isConnected: false,
  connectionStatus: 'disconnected',
  exchangeName: 'Demo',
  lastTradeTimestamp: 0,
  tradesPerSecond: 0,
  isPaused: false,
  connector: null,
  generator: null,
  viewport: { startTime: 0, endTime: 0, priceLow: 0, priceHigh: 0, candleWidthPx: 12, pricePerPixel: 2 },
  tradeTimestamps: [],

  setDataSource: (source: DataSource) => {
    const state = get();
    // Disconnect existing
    if (state.connector) {
      state.connector.disconnect();
    }
    // Clear data
    set({
      trades: [],
      candles: [],
      volumeProfile: { levels: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, totalVolume: 0 },
      bigTrades: [],
      sessionStats: { totalVolume: 0, totalBuyVolume: 0, totalSellVolume: 0, netDelta: 0, highPrice: 0, lowPrice: 0, tradeCount: 0, vwap: 0, bigTradeCount: 0 },
      cvdHistory: [],
      currentPrice: 0,
      dataSource: source,
      connector: null,
      generator: null,
      isConnected: false,
      connectionStatus: 'disconnected',
      exchangeName: source === 'demo' ? 'Demo' : source === 'binance' ? 'Binance Futures' : 'Hyperliquid',
      lastTradeTimestamp: 0,
      tradesPerSecond: 0,
    });
    // Re-init with new source
    get().init();
  },

  init: () => {
    const state = get();
    const { dataSource } = state;

    if (dataSource === 'demo') {
      initDemo(set, get);
    } else if (dataSource === 'binance') {
      initConnector(set, get, new BinanceFuturesConnector());
    } else if (dataSource === 'hyperliquid') {
      initConnector(set, get, new HyperliquidConnector());
    }
  },

  tick: () => {
    const state = get();
    if (state.dataSource !== 'demo' || !state.generator || state.isPaused) return;

    const batchSize = 3 + Math.floor(Math.random() * 8);
    const newTrades = state.generator.generateBatch(batchSize);
    processNewTrades(newTrades, set, get);
  },

  setTimeframe: (tf) => {
    const state = get();
    const periodMs = TIMEFRAME_MS[tf];
    const candles = aggregateIntoFootprints(state.trades, periodMs).slice(-MAX_CANDLES);
    set({ timeframe: tf, candles });
  },

  setTickSize: (ts) => set({ tickSize: ts }),

  setPaused: (p) => set({ isPaused: p }),

  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),

  resetView: () => {
    const state = get();
    const candles = state.candles;
    if (candles.length === 0) return;
    const first = candles[0], last = candles[candles.length - 1];
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
    const pad = (hi - lo) * 0.1;
    set({
      viewport: {
        startTime: first.timestamp,
        endTime: last.timestamp,
        priceLow: lo - pad,
        priceHigh: hi + pad,
        candleWidthPx: 14,
        pricePerPixel: (hi - lo + 2 * pad) / 600,
      },
    });
  },

  zoomIn: () => set((s) => {
    const range = s.viewport.endTime - s.viewport.startTime;
    const center = s.viewport.startTime + range / 2;
    const newRange = range * 0.7;
    return { viewport: { ...s.viewport, startTime: center - newRange / 2, endTime: center + newRange / 2, candleWidthPx: Math.min(s.viewport.candleWidthPx * 1.4, 120) } };
  }),

  zoomOut: () => set((s) => {
    const range = s.viewport.endTime - s.viewport.startTime;
    const center = s.viewport.startTime + range / 2;
    const newRange = range * 1.4;
    return { viewport: { ...s.viewport, startTime: center - newRange / 2, endTime: center + newRange / 2, candleWidthPx: Math.max(s.viewport.candleWidthPx * 0.7, 3) } };
  }),

  panLeft: () => set((s) => {
    const range = s.viewport.endTime - s.viewport.startTime;
    const shift = range * 0.2;
    return { viewport: { ...s.viewport, startTime: s.viewport.startTime - shift, endTime: s.viewport.endTime - shift } };
  }),

  panRight: () => set((s) => {
    const range = s.viewport.endTime - s.viewport.startTime;
    const shift = range * 0.2;
    return { viewport: { ...s.viewport, startTime: s.viewport.startTime + shift, endTime: s.viewport.endTime + shift } };
  }),

  setShowBigTrades: (v) => set({ showBigTrades: v }),
  setShowVolumeProfile: (v) => set({ showVolumeProfile: v }),
  setShowCVD: (v) => set({ showCVD: v }),
  setShowDelta: (v) => set({ showDelta: v }),
  setBigTradeFilter: (f) => set({ bigTradeFilter: f }),
  setBigTradeThresholds: (t) => set({ bigTradeThresholds: t }),

  reconnect: () => {
    const state = get();
    if (state.connector) {
      state.connector.disconnect();
    }
    set({ trades: [], candles: [], isConnected: false, connectionStatus: 'disconnected' });
    get().init();
  },
}));

function initDemo(set: any, get: () => MarketState) {
  const gen = new MarketDataGenerator(67500);
  const now = Date.now();
  const lookback = 600000;
  const historicalTrades: Trade[] = [];

  for (let t = now - lookback; t < now; t += 50) {
    const trade = gen.generateTrade();
    trade.timestamp = t;
    historicalTrades.push(trade);
  }

  const tf = get().timeframe;
  const periodMs = TIMEFRAME_MS[tf];
  const candles = aggregateIntoFootprints(historicalTrades, periodMs);
  const volumeProfile = calculateVolumeProfile(candles.slice(-60));
  const bigTrades = detectBigTrades(historicalTrades, get().bigTradeThresholds);
  const sessionStats = calculateSessionStats(historicalTrades);

  const cvdHistory: { timestamp: number; value: number }[] = [];
  let cvd = 0;
  for (const c of candles) {
    cvd += c.delta;
    cvdHistory.push({ timestamp: c.timestamp, value: cvd });
  }

  const lastCandle = candles[candles.length - 1];
  const priceRange = 300;
  const priceMid = lastCandle ? (lastCandle.high + lastCandle.low) / 2 : 67500;

  set({
    generator: gen,
    trades: historicalTrades,
    candles: candles.slice(-MAX_CANDLES),
    volumeProfile,
    bigTrades: bigTrades.slice(-200),
    sessionStats,
    cvdHistory,
    currentPrice: gen.getCurrentPrice(),
    isConnected: true,
    connectionStatus: 'connected',
    exchangeName: 'Demo',
    viewport: {
      startTime: now - lookback,
      endTime: now,
      priceLow: priceMid - priceRange / 2,
      priceHigh: priceMid + priceRange / 2,
      candleWidthPx: 14,
      pricePerPixel: priceRange / 600,
    },
  });
}

function initConnector(set: any, get: () => MarketState, connector: MarketDataConnector) {
  set({
    connector,
    exchangeName: connector.getName(),
    connectionStatus: 'connecting',
  });

  connector.onStatusChange((status: ConnectionStatus) => {
    set({
      connectionStatus: status,
      isConnected: status === 'connected',
    });
  });

  connector.onTrade((normalizedTrade: NormalizedTrade) => {
    const state = get();
    if (state.isPaused) return;

    const trade = normalizedToTrade(normalizedTrade);
    processNewTrades([trade], set, get);
  });

  connector.connect();
}

function processNewTrades(newTrades: Trade[], set: any, get: () => MarketState) {
  const state = get();
  const allTrades = [...state.trades, ...newTrades].slice(-MAX_TRADES);

  const periodMs = TIMEFRAME_MS[state.timeframe];
  const candles = aggregateIntoFootprints(allTrades, periodMs).slice(-MAX_CANDLES);
  const volumeProfile = calculateVolumeProfile(candles.slice(-60));
  const bigTrades = detectBigTrades(allTrades, state.bigTradeThresholds).slice(-200);
  const sessionStats = calculateSessionStats(allTrades);

  const cvdHistory: { timestamp: number; value: number }[] = [];
  let cvd = 0;
  for (const c of candles) {
    cvd += c.delta;
    cvdHistory.push({ timestamp: c.timestamp, value: cvd });
  }

  // Track trades per second
  const now = Date.now();
  const timestamps = [...state.tradeTimestamps, ...newTrades.map(t => t.timestamp)]
    .filter(t => now - t < 5000);
  const tps = timestamps.length / 5;

  const lastTrade = newTrades[newTrades.length - 1];
  const currentPrice = lastTrade ? lastTrade.price : state.currentPrice;
  const lastTs = lastTrade ? lastTrade.timestamp : state.lastTradeTimestamp;

  const vp = state.viewport;
  const lastCandleTs = candles[candles.length - 1]?.timestamp || 0;
  const isAtEdge = vp.endTime >= (candles[candles.length - 2]?.timestamp || 0);

  set({
    trades: allTrades,
    candles,
    volumeProfile,
    bigTrades,
    sessionStats,
    cvdHistory,
    currentPrice,
    lastTradeTimestamp: lastTs,
    tradesPerSecond: Math.round(tps * 10) / 10,
    tradeTimestamps: timestamps,
    viewport: isAtEdge ? {
      ...vp,
      endTime: lastCandleTs || vp.endTime,
      startTime: (lastCandleTs || vp.endTime) - (vp.endTime - vp.startTime),
    } : vp,
  });
}
