import { create } from 'zustand'
import type {
  Candle, Trade, OrderLevel, Bubble, VolumeLevel, HeatmapLevel,
  Interval, AppMode, Ticker24h, Instrument,
} from '../types/market'
import { INTERVAL_MS } from '../types/market'
import {
  newCandle, processTradeIntoCandle, classifyBubble, computeVolumeProfile,
} from '../utils/aggregation'

interface MarketState {
  mode: AppMode
  symbol: string
  interval: Interval
  connected: boolean
  depthConnected: boolean
  tickerConnected: boolean
  followLive: boolean

  candles: Candle[]
  currentCandle: Candle | null

  bids: OrderLevel[]
  asks: OrderLevel[]

  recentTrades: Trade[]
  largeTrades: Trade[]

  delta: number
  cvd: number
  totalVolume: number
  buyVolume: number
  sellVolume: number

  bubbles: Bubble[]

  volumeProfile: VolumeLevel[]
  heatmapLevels: HeatmapLevel[]

  // ─── Live market data ───
  ticker: Ticker24h | null
  livePrice: number
  liveChange: number
  liveChangePct: number
  connectionError: string | null
  lastTradeTime: number

  // ─── Dynamic instruments ───
  instruments: Instrument[]
  instrumentsLoading: boolean

  // Actions
  setMode: (mode: AppMode) => void
  setSymbol: (symbol: string) => void
  setInterval: (interval: Interval) => void
  setConnected: (connected: boolean) => void
  setDepthConnected: (depthConnected: boolean) => void
  setTickerConnected: (tickerConnected: boolean) => void
  setFollowLive: (follow: boolean) => void
  processTrade: (trade: Trade) => void
  setDepth: (bids: OrderLevel[], asks: OrderLevel[]) => void
  rebuildVolumeProfile: () => void
  addHeatmapSnapshot: () => void
  updateBubbles: () => void
  setTicker: (ticker: Ticker24h | null) => void
  updateLivePrice: (price: number, change: number, changePct: number) => void
  setConnectionError: (error: string | null) => void
  setInstruments: (instruments: Instrument[]) => void
  setInstrumentsLoading: (loading: boolean) => void
  loadHistoricalCandles: (candles: Candle[]) => void
  reset: () => void
}

const MAX_CANDLES = 1500
const MAX_RECENT_TRADES = 200
const MAX_LARGE_TRADES = 100
const MAX_HEATMAP = 3000
const MAX_BUBBLES = 500

const STALE_THRESHOLD = 15_000

function getInitialState() {
  return {
    mode: 'live' as AppMode,
    symbol: 'BTCUSDT',
    interval: '40s' as Interval,
    connected: false,
    depthConnected: false,
    tickerConnected: false,
    followLive: true,
    candles: [] as Candle[],
    currentCandle: null as Candle | null,
    bids: [] as OrderLevel[],
    asks: [] as OrderLevel[],
    recentTrades: [] as Trade[],
    largeTrades: [] as Trade[],
    delta: 0,
    cvd: 0,
    totalVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    bubbles: [] as Bubble[],
    volumeProfile: [] as VolumeLevel[],
    heatmapLevels: [] as HeatmapLevel[],
    ticker: null as Ticker24h | null,
    livePrice: 0,
    liveChange: 0,
    liveChangePct: 0,
    connectionError: null as string | null,
    lastTradeTime: 0,
    instruments: [] as Instrument[],
    instrumentsLoading: false,
  }
}

// All data buffers that must be reset on symbol switch
function getDataResetFields() {
  return {
    connected: false,
    depthConnected: false,
    tickerConnected: false,
    followLive: true,
    candles: [] as Candle[],
    currentCandle: null as Candle | null,
    bids: [] as OrderLevel[],
    asks: [] as OrderLevel[],
    recentTrades: [] as Trade[],
    largeTrades: [] as Trade[],
    delta: 0,
    cvd: 0,
    totalVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    bubbles: [] as Bubble[],
    volumeProfile: [] as VolumeLevel[],
    heatmapLevels: [] as HeatmapLevel[],
    ticker: null as Ticker24h | null,
    livePrice: 0,
    liveChange: 0,
    liveChangePct: 0,
    connectionError: null as string | null,
    lastTradeTime: 0,
  }
}

export const useMarketStore = create<MarketState>((set, get) => ({
  ...getInitialState(),

  setMode: (mode) => set({ mode }),
  setSymbol: (symbol) => {
    // Clean reset of ALL data buffers — no stale state leakage
    set({
      ...getDataResetFields(),
      symbol,
      mode: get().mode,
      interval: get().interval,
      instruments: get().instruments,
      instrumentsLoading: get().instrumentsLoading,
    })
  },
  setInterval: (interval) => {
    set({ interval, candles: [], currentCandle: null, bubbles: [] })
  },
  setConnected: (connected) => {
    const update: Partial<MarketState> = { connected }
    if (connected) {
      update.connectionError = null
    }
    set(update as any)
  },
  setDepthConnected: (depthConnected) => set({ depthConnected }),
  setTickerConnected: (tickerConnected) => set({ tickerConnected }),
  setFollowLive: (followLive) => set({ followLive }),

  processTrade: (trade) => {
    const state = get()
    const intervalMs = INTERVAL_MS[state.interval]
    const bucket = Math.floor(trade.time / intervalMs) * intervalMs

    let currentCandle = state.currentCandle

    if (!currentCandle || currentCandle.openTime !== bucket) {
      if (currentCandle) {
        const closedBubbles = currentCandle.bubbles.map(b =>
          b.state === 'PENDING' ? { ...b, state: 'EXHAUSTED' as const, confidence: 0.4 } : b
        )
        const closed = { ...currentCandle, bubbles: closedBubbles }
        const candles = [...state.candles, closed].slice(-MAX_CANDLES)
        set({ candles })
      }
      currentCandle = newCandle(bucket, trade.price)
    }

    currentCandle = processTradeIntoCandle(currentCandle, trade)

    currentCandle = {
      ...currentCandle,
      bubbles: currentCandle.bubbles.map(b =>
        classifyBubble(b, currentCandle!.close, currentCandle!.high, currentCandle!.low)
      ),
    }

    const recentTrades = [trade, ...state.recentTrades].slice(0, MAX_RECENT_TRADES)

    const largeTrades = trade.notional > 5000
      ? [trade, ...state.largeTrades].slice(0, MAX_LARGE_TRADES)
      : state.largeTrades

    const totalVolume = state.totalVolume + trade.qty
    const buyVolume = state.buyVolume + (trade.side === 'buy' ? trade.qty : 0)
    const sellVolume = state.sellVolume + (trade.side === 'sell' ? trade.qty : 0)
    const delta = state.delta + (trade.side === 'buy' ? trade.qty : -trade.qty)
    const cvd = state.cvd + (trade.side === 'buy' ? trade.qty : -trade.qty)

    // ─── Bubble state synchronization ───
    // BUGFIX: state.bubbles previously stored stale copies that never updated.
    // Now we ensure state.bubbles always contains the LATEST classified versions.
    //
    // currentCandle.bubbles has the freshest state (just classified above).
    // We build a lookup of current-candle bubbles by id, then:
    //   - replace old entries with updated versions
    //   - add truly new bubbles
    //   - keep closed-candle bubbles that are still in the buffer
    const currentBubbleMap = new Map(currentCandle.bubbles.map(b => [b.id, b]))
    const mergedBubbles: Bubble[] = []
    for (const b of state.bubbles) {
      const updated = currentBubbleMap.get(b.id)
      if (updated) {
        // Use the latest classified version, not the stale one
        mergedBubbles.push(updated)
        currentBubbleMap.delete(b.id)
      } else {
        // Bubble from a closed candle — keep it (already classified)
        mergedBubbles.push(b)
      }
    }
    // Add any brand-new bubbles that weren't in state.bubbles yet
    for (const b of currentBubbleMap.values()) {
      mergedBubbles.push(b)
    }
    const allBubbles = mergedBubbles.slice(-MAX_BUBBLES)

    set({
      currentCandle,
      recentTrades,
      largeTrades,
      totalVolume,
      buyVolume,
      sellVolume,
      delta,
      cvd,
      bubbles: allBubbles,
      livePrice: trade.price,
      lastTradeTime: trade.time,
    })
  },

  setDepth: (bids, asks) => set({ bids, asks }),

  rebuildVolumeProfile: () => {
    const state = get()
    const allCandles = state.currentCandle
      ? [...state.candles, state.currentCandle]
      : state.candles
    const profile = computeVolumeProfile(allCandles)
    set({ volumeProfile: profile as VolumeLevel[] })
  },

  addHeatmapSnapshot: () => {
    const state = get()
    if (state.bids.length === 0 && state.asks.length === 0) return

    const now = Date.now()
    const snapshot: HeatmapLevel[] = []

    for (const bid of state.bids.slice(0, 10)) {
      snapshot.push({ time: now, price: bid.price, volume: bid.qty, bidVolume: bid.qty, askVolume: 0 })
    }
    for (const ask of state.asks.slice(0, 10)) {
      snapshot.push({ time: now, price: ask.price, volume: ask.qty, bidVolume: 0, askVolume: ask.qty })
    }

    const heatmapLevels = [...state.heatmapLevels, ...snapshot].slice(-MAX_HEATMAP)
    set({ heatmapLevels })
  },

  updateBubbles: () => {
    const state = get()
    if (!state.currentCandle) return

    if (state.mode === 'live' && state.connected && state.lastTradeTime > 0) {
      const stale = Date.now() - state.lastTradeTime > STALE_THRESHOLD
      if (stale && !state.connectionError) {
        set({ connectionError: 'No trades received — data may be stale' })
      }
    }

    // Re-classify all current candle bubbles with latest price data
    const updatedCurrentBubbles = state.currentCandle.bubbles.map(b =>
      classifyBubble(b, state.currentCandle!.close, state.currentCandle!.high, state.currentCandle!.low)
    )

    // Propagate updated states to the global bubbles array
    // This is the periodic re-classification that makes bubbles change color over time
    const updatedMap = new Map(updatedCurrentBubbles.map(b => [b.id, b]))
    const updatedGlobalBubbles = state.bubbles.map(b => updatedMap.get(b.id) ?? b)

    set({
      currentCandle: { ...state.currentCandle, bubbles: updatedCurrentBubbles },
      bubbles: updatedGlobalBubbles,
    })
  },

  setTicker: (ticker) => set({ ticker }),
  updateLivePrice: (price, change, changePct) => set({
    livePrice: price,
    liveChange: change,
    liveChangePct: changePct,
  }),
  setConnectionError: (error) => set({ connectionError: error }),
  setInstruments: (instruments) => set({ instruments }),
  setInstrumentsLoading: (loading) => set({ instrumentsLoading: loading }),

  loadHistoricalCandles: (historicalCandles) => {
    const state = get()
    // Merge with existing candles, deduplicate by openTime, sort ascending
    const existing = state.candles
    const merged = new Map<number, Candle>()
    for (const c of existing) merged.set(c.openTime, c)
    for (const c of historicalCandles) {
      // Only add if we don't already have a candle at this time
      // (live data takes priority over historical)
      if (!merged.has(c.openTime)) merged.set(c.openTime, c)
    }
    const sorted = Array.from(merged.values()).sort((a, b) => a.openTime - b.openTime)
    set({ candles: sorted.slice(-MAX_CANDLES) })
  },

  reset: () => set(getInitialState()),
}))
