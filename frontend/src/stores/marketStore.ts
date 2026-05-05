import { create } from 'zustand';
import { Trade, FootprintCandle, VolumeProfile, BigTrade, SessionStats, Timeframe, ChartViewport } from '../types';
import { MarketDataGenerator, aggregateIntoFootprints, calculateVolumeProfile, detectBigTrades, calculateSessionStats } from '../utils/dataGenerator';

const MAX_TRADES = 50000;
const MAX_CANDLES = 2000;

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1s': 1000, '5s': 5000, '15s': 15000, '30s': 30000,
  '1m': 60000, '5m': 300000, '15m': 900000,
};

interface MarketState {
  trades: Trade[];
  candles: FootprintCandle[];
  volumeProfile: VolumeProfile;
  bigTrades: BigTrade[];
  sessionStats: SessionStats;
  cvdHistory: { timestamp: number; value: number }[];
  currentPrice: number;
  timeframe: Timeframe;
  isConnected: boolean;
  isPaused: boolean;
  generator: MarketDataGenerator | null;
  viewport: ChartViewport;
  bigTradeThresholds: { medium: number; large: number; extreme: number };
  showBigTrades: boolean;
  showVolumeProfile: boolean;
  showCVD: boolean;
  showDelta: boolean;
  bigTradeFilter: 'all' | 'medium' | 'large' | 'extreme';

  init: () => void;
  tick: () => void;
  setTimeframe: (tf: Timeframe) => void;
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
}

export const useMarketStore = create<MarketState>((set, get) => ({
  trades: [],
  candles: [],
  volumeProfile: { levels: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, totalVolume: 0 },
  bigTrades: [],
  sessionStats: { totalVolume: 0, totalBuyVolume: 0, totalSellVolume: 0, netDelta: 0, highPrice: 0, lowPrice: 0, tradeCount: 0, vwap: 0, bigTradeCount: 0 },
  cvdHistory: [],
  currentPrice: 67500,
  timeframe: '5s',
  isConnected: false,
  isPaused: false,
  generator: null,
  viewport: { startTime: 0, endTime: 0, priceLow: 67000, priceHigh: 68000, candleWidthPx: 12, pricePerPixel: 2 },
  bigTradeThresholds: { medium: 2, large: 10, extreme: 50 },
  showBigTrades: true,
  showVolumeProfile: true,
  showCVD: true,
  showDelta: true,
  bigTradeFilter: 'all',

  init: () => {
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
      viewport: {
        startTime: now - lookback,
        endTime: now,
        priceLow: priceMid - priceRange / 2,
        priceHigh: priceMid + priceRange / 2,
        candleWidthPx: 14,
        pricePerPixel: priceRange / 600,
      },
    });
  },

  tick: () => {
    const state = get();
    if (!state.generator || state.isPaused) return;

    const batchSize = 3 + Math.floor(Math.random() * 8);
    const newTrades = state.generator.generateBatch(batchSize);
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

    const currentPrice = state.generator.getCurrentPrice();
    const vp = state.viewport;
    const isAtEdge = vp.endTime >= candles[candles.length - 2]?.timestamp;

    set({
      trades: allTrades,
      candles,
      volumeProfile,
      bigTrades,
      sessionStats,
      cvdHistory,
      currentPrice,
      viewport: isAtEdge ? {
        ...vp,
        endTime: candles[candles.length - 1]?.timestamp || vp.endTime,
        startTime: (candles[candles.length - 1]?.timestamp || vp.endTime) - (vp.endTime - vp.startTime),
      } : vp,
    });
  },

  setTimeframe: (tf) => {
    const state = get();
    const periodMs = TIMEFRAME_MS[tf];
    const candles = aggregateIntoFootprints(state.trades, periodMs).slice(-MAX_CANDLES);
    set({ timeframe: tf, candles });
  },

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
}));
