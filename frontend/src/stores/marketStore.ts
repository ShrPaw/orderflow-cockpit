import { create } from 'zustand';
import { Trade, FootprintCandle, VolumeProfile, BigTrade, SessionStats, Timeframe, ChartViewport } from '../types';
import {
  DataSource, ConnectionStatus, NormalizedTrade, NormalizedBookUpdate,
  DepthSnapshot, HeatmapCell, OrderBookStatus, OrderBookDiagnostics,
} from '../types/connector';
import { MarketDataGenerator, aggregateIntoFootprints, calculateVolumeProfile, detectBigTrades, calculateSessionStats } from '../utils/dataGenerator';
import { BinanceFuturesConnector } from '../connectors/binance';
import { HyperliquidConnector } from '../connectors/hyperliquid';
import { BinanceDepthConnector } from '../connectors/binanceDepth';
import type { MarketDataConnector, DepthConnector } from '../types/connector';

const MAX_TRADES = 50000;
const MAX_CANDLES = 2000;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1s': 1000, '5s': 5000, '15s': 15000, '30s': 30000,
  '1m': 60000, '5m': 300000, '15m': 900000,
};

interface OrderBookState {
  bids: Map<number, number>;
  asks: Map<number, number>;
  bestBid: number;
  bestAsk: number;
  spread: number;
  lastUpdated: number;
  totalBidSize: number;
  totalAskSize: number;
}

const defaultDiagnostics: OrderBookDiagnostics = {
  status: 'disconnected',
  lastUpdateId: 0,
  lastAppliedUpdateId: 0,
  prevFinalUpdateId: 0,
  bufferedEventCount: 0,
  sequenceBreakCount: 0,
  lastDepthEventTime: 0,
  bookAgeMs: -1,
  bidLevelCount: 0,
  askLevelCount: 0,
  streamSpeed: '100ms',
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

  // Order book
  orderBook: OrderBookState;
  orderBookDiagnostics: OrderBookDiagnostics;
  heatmapData: HeatmapCell[];
  heatmapMaxSize: number;

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

  // Heatmap settings
  showHeatmap: boolean;
  heatmapDepthLevels: number;
  heatmapIntensity: number;
  heatmapTickSize: number;

  // Connection state
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  depthConnectionStatus: ConnectionStatus;
  exchangeName: string;
  lastTradeTimestamp: number;
  tradesPerSecond: number;
  isPaused: boolean;

  // Internal
  connector: MarketDataConnector | null;
  depthConnector: DepthConnector | null;
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
  setShowHeatmap: (v: boolean) => void;
  setHeatmapDepthLevels: (v: number) => void;
  setHeatmapIntensity: (v: number) => void;
  setHeatmapTickSize: (v: number) => void;
  setStreamSpeed: (speed: '100ms' | '500ms' | 'default') => void;
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

const emptyOrderBook: OrderBookState = {
  bids: new Map(),
  asks: new Map(),
  bestBid: 0,
  bestAsk: 0,
  spread: 0,
  lastUpdated: 0,
  totalBidSize: 0,
  totalAskSize: 0,
};

export const useMarketStore = create<MarketState>((set, get) => ({
  trades: [],
  candles: [],
  volumeProfile: { levels: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, totalVolume: 0 },
  bigTrades: [],
  sessionStats: { totalVolume: 0, totalBuyVolume: 0, totalSellVolume: 0, netDelta: 0, highPrice: 0, lowPrice: 0, tradeCount: 0, vwap: 0, bigTradeCount: 0 },
  cvdHistory: [],
  currentPrice: 0,
  orderBook: { ...emptyOrderBook, bids: new Map(), asks: new Map() },
  orderBookDiagnostics: { ...defaultDiagnostics },
  heatmapData: [],
  heatmapMaxSize: 1,
  timeframe: '5s',
  dataSource: 'demo',
  tickSize: 10,
  bigTradeThresholds: { medium: 100000, large: 500000, extreme: 1000000 },
  showBigTrades: true,
  showVolumeProfile: true,
  showCVD: true,
  showDelta: true,
  bigTradeFilter: 'all',
  showHeatmap: true,
  heatmapDepthLevels: 50,
  heatmapIntensity: 0.7,
  heatmapTickSize: 10,
  isConnected: false,
  connectionStatus: 'disconnected',
  depthConnectionStatus: 'disconnected',
  exchangeName: 'Demo',
  lastTradeTimestamp: 0,
  tradesPerSecond: 0,
  isPaused: false,
  connector: null,
  depthConnector: null,
  generator: null,
  viewport: { startTime: 0, endTime: 0, priceLow: 0, priceHigh: 0, candleWidthPx: 12, pricePerPixel: 2 },
  tradeTimestamps: [],

  setDataSource: (source: DataSource) => {
    const state = get();
    if (state.connector) state.connector.disconnect();
    if (state.depthConnector) state.depthConnector.disconnect();
    set({
      trades: [],
      candles: [],
      volumeProfile: { levels: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, totalVolume: 0 },
      bigTrades: [],
      sessionStats: { totalVolume: 0, totalBuyVolume: 0, totalSellVolume: 0, netDelta: 0, highPrice: 0, lowPrice: 0, tradeCount: 0, vwap: 0, bigTradeCount: 0 },
      cvdHistory: [],
      currentPrice: 0,
      orderBook: { ...emptyOrderBook, bids: new Map(), asks: new Map() },
      orderBookDiagnostics: { ...defaultDiagnostics },
      heatmapData: [],
      dataSource: source,
      connector: null,
      depthConnector: null,
      generator: null,
      isConnected: false,
      connectionStatus: 'disconnected',
      depthConnectionStatus: 'disconnected',
      exchangeName: source === 'demo' ? 'Demo' : source === 'binance' ? 'Binance Futures' : 'Hyperliquid',
      lastTradeTimestamp: 0,
      tradesPerSecond: 0,
    });
    get().init();
  },

  init: () => {
    const state = get();
    const { dataSource } = state;

    if (dataSource === 'demo') {
      initDemo(set, get);
    } else if (dataSource === 'binance') {
      initBinanceWithDepth(set, get);
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
  setShowHeatmap: (v) => set({ showHeatmap: v }),
  setHeatmapDepthLevels: (v) => set({ heatmapDepthLevels: v }),
  setHeatmapIntensity: (v) => set({ heatmapIntensity: v }),
  setHeatmapTickSize: (v) => set({ heatmapTickSize: v }),

  setStreamSpeed: (speed) => {
    const state = get();
    if (state.depthConnector) {
      (state.depthConnector as BinanceDepthConnector).setStreamSpeed(speed);
    }
    set((s) => ({
      orderBookDiagnostics: { ...s.orderBookDiagnostics, streamSpeed: speed },
    }));
  },

  reconnect: () => {
    const state = get();
    if (state.connector) state.connector.disconnect();
    if (state.depthConnector) state.depthConnector.disconnect();
    set({
      trades: [], candles: [], isConnected: false, connectionStatus: 'disconnected',
      depthConnectionStatus: 'disconnected',
      orderBook: { ...emptyOrderBook, bids: new Map(), asks: new Map() },
      orderBookDiagnostics: { ...defaultDiagnostics },
      heatmapData: [],
    });
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

function initBinanceWithDepth(set: any, get: () => MarketState) {
  // Initialize aggTrade connector
  const tradeConnector = new BinanceFuturesConnector();
  initConnector(set, get, tradeConnector);

  // Initialize depth connector
  const depthConnector = new BinanceDepthConnector();
  set({ depthConnector, depthConnectionStatus: 'connecting' });

  depthConnector.onStatusChange((status: ConnectionStatus) => {
    set({ depthConnectionStatus: status });
  });

  depthConnector.onDiagnostics((diag: Partial<OrderBookDiagnostics>) => {
    set((s: any) => ({
      orderBookDiagnostics: { ...s.orderBookDiagnostics, ...diag },
    }));
  });

  // Handle snapshot: clear book and rebuild from snapshot
  depthConnector.onSnapshot((snapshot: DepthSnapshot) => {
    const ob: OrderBookState = {
      bids: new Map(),
      asks: new Map(),
      bestBid: 0,
      bestAsk: 0,
      spread: 0,
      lastUpdated: Date.now(),
      totalBidSize: 0,
      totalAskSize: 0,
    };

    // Initialize from snapshot
    for (const [p, q] of snapshot.bids) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty > 0) ob.bids.set(price, qty);
    }
    for (const [p, q] of snapshot.asks) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      if (qty > 0) ob.asks.set(price, qty);
    }

    // Calculate best bid/ask
    let bestBid = 0, bestAsk = Infinity, totalBid = 0, totalAsk = 0;
    for (const [price, size] of ob.bids) {
      totalBid += size;
      if (price > bestBid) bestBid = price;
    }
    for (const [price, size] of ob.asks) {
      totalAsk += size;
      if (price < bestAsk) bestAsk = price;
    }
    ob.bestBid = bestBid;
    ob.bestAsk = bestAsk === Infinity ? 0 : bestAsk;
    ob.spread = ob.bestAsk > 0 && ob.bestBid > 0 ? ob.bestAsk - ob.bestBid : 0;
    ob.totalBidSize = totalBid;
    ob.totalAskSize = totalAsk;

    set({
      orderBook: ob,
      heatmapData: [],
      heatmapMaxSize: 1,
      orderBookDiagnostics: {
        ...get().orderBookDiagnostics,
        bidLevelCount: ob.bids.size,
        askLevelCount: ob.asks.size,
      },
    });
  });

  // Handle incremental updates
  depthConnector.onBookUpdate((update: NormalizedBookUpdate) => {
    const state = get();
    if (state.isPaused) return;
    processBookUpdate(update, set, get);
  });

  depthConnector.connect();
}

function initConnector(set: any, get: () => MarketState, connector: MarketDataConnector) {
  set({ connector, exchangeName: connector.getName(), connectionStatus: 'connecting' });

  connector.onStatusChange((status: ConnectionStatus) => {
    set({ connectionStatus: status, isConnected: status === 'connected' });
  });

  connector.onTrade((normalizedTrade: NormalizedTrade) => {
    const state = get();
    if (state.isPaused) return;
    const trade = normalizedToTrade(normalizedTrade);
    processNewTrades([trade], set, get);
  });

  connector.connect();
}

function processBookUpdate(update: NormalizedBookUpdate, set: any, get: () => MarketState) {
  const state = get();
  const ob = { ...state.orderBook };
  ob.bids = new Map(ob.bids);
  ob.asks = new Map(ob.asks);
  ob.lastUpdated = update.timestamp;

  // Apply bid updates (absolute quantities, not deltas)
  for (const [price, size] of update.bids) {
    if (size === 0) ob.bids.delete(price);
    else ob.bids.set(price, size);
  }

  // Apply ask updates (absolute quantities, not deltas)
  for (const [price, size] of update.asks) {
    if (size === 0) ob.asks.delete(price);
    else ob.asks.set(price, size);
  }

  // Find best bid/ask
  let bestBid = 0, bestAsk = Infinity;
  let totalBidSize = 0, totalAskSize = 0;

  for (const [price, size] of ob.bids) {
    totalBidSize += size;
    if (price > bestBid) bestBid = price;
  }
  for (const [price, size] of ob.asks) {
    totalAskSize += size;
    if (price < bestAsk) bestAsk = price;
  }

  ob.bestBid = bestBid;
  ob.bestAsk = bestAsk === Infinity ? 0 : bestAsk;
  ob.spread = ob.bestAsk > 0 && ob.bestBid > 0 ? ob.bestAsk - ob.bestBid : 0;
  ob.totalBidSize = totalBidSize;
  ob.totalAskSize = totalAskSize;

  // Build heatmap only if synced
  const bookStatus = get().orderBookDiagnostics.status;
  let heatmapData = state.heatmapData;
  let heatmapMaxSize = state.heatmapMaxSize;

  if (bookStatus === 'synced') {
    const heatmap = buildHeatmap(ob, state.heatmapDepthLevels, state.heatmapTickSize, state.currentPrice);
    heatmapData = heatmap.cells;
    heatmapMaxSize = heatmap.maxSize;
  }

  set({
    orderBook: ob,
    heatmapData,
    heatmapMaxSize,
    orderBookDiagnostics: {
      ...get().orderBookDiagnostics,
      bidLevelCount: ob.bids.size,
      askLevelCount: ob.asks.size,
      lastAppliedUpdateId: update.updateId,
    },
  });
}

function buildHeatmap(
  ob: OrderBookState,
  maxLevels: number,
  tickSize: number,
  currentPrice: number
): { cells: HeatmapCell[]; maxSize: number } {
  const cells: HeatmapCell[] = [];
  let maxSize = 0;

  const bidAgg = new Map<number, number>();
  for (const [price, size] of ob.bids) {
    const rounded = Math.floor(price / tickSize) * tickSize;
    bidAgg.set(rounded, (bidAgg.get(rounded) || 0) + size);
  }

  const askAgg = new Map<number, number>();
  for (const [price, size] of ob.asks) {
    const rounded = Math.ceil(price / tickSize) * tickSize;
    askAgg.set(rounded, (askAgg.get(rounded) || 0) + size);
  }

  for (const size of bidAgg.values()) maxSize = Math.max(maxSize, size);
  for (const size of askAgg.values()) maxSize = Math.max(maxSize, size);

  const mid = currentPrice || ((ob.bestBid + ob.bestAsk) / 2);

  const sortedBids = Array.from(bidAgg.entries())
    .filter(([p]) => p <= mid)
    .sort((a, b) => b[0] - a[0])
    .slice(0, maxLevels);

  const sortedAsks = Array.from(askAgg.entries())
    .filter(([p]) => p >= mid)
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxLevels);

  const now = ob.lastUpdated;

  for (const [price, size] of sortedBids) {
    cells.push({ price, side: 'bid', size, intensity: maxSize > 0 ? size / maxSize : 0, timestamp: now });
  }

  for (const [price, size] of sortedAsks) {
    cells.push({ price, side: 'ask', size, intensity: maxSize > 0 ? size / maxSize : 0, timestamp: now });
  }

  return { cells, maxSize: maxSize || 1 };
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
