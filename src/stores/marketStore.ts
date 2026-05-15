import { create } from 'zustand'
import type {
  Candle, Trade, OrderLevel, Bubble, VolumeLevel, HeatmapLevel,
  Interval, AppMode, Ticker24h, Instrument, OrderBookHealth, OrderBookSource, DiffDepthEvent,
} from '../types/market'
import { INTERVAL_MS } from '../types/market'
import {
  newCandle, processTradeIntoCandle, classifyBubble, computeVolumeProfile,
} from '../utils/aggregation'
import { updateLevelsFromBubbles, resetLevels, type LevelRecord } from '../utils/levelMemory'
import {
  formClusters, type AuctionCluster,
} from '../utils/auctionClusters'
import type { FlowEvent } from '../utils/flowEvents'
import { deriveFlowEvents } from '../utils/flowEvents'
import type { AlertRule } from '../utils/alerts'
import { loadAlertRules, saveAlertRules, getDefaultRules, evaluateAlerts } from '../utils/alerts'

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
  tradeError: string | null
  depthError: string | null
  tickerError: string | null
  lastTradeTime: number

  // ─── Dynamic instruments ───
  instruments: Instrument[]
  instrumentsLoading: boolean

  // ─── Level memory ───
  levelMemory: LevelRecord[]

  // ─── Auction Clusters ───
  clusters: AuctionCluster[]

  // ─── Flow Events ───
  flowEvents: FlowEvent[]

  // ─── Alert Rules ───
  alertRules: AlertRule[]

  // ─── Depth health ───
  depthStale: boolean
  depthLastMessageTime: number

  // ─── Local Order Book ───
  orderBookHealth: OrderBookHealth
  orderBookSource: OrderBookSource
  orderBookLastUpdateId: number
  orderBookLastEventUpdateId: number
  orderBookLastTransactionTime: number
  orderBookReconnectAttempts: number
  orderBookError: string | null
  orderBookBufferedEvents: DiffDepthEvent[]

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
  setOrderBookSnapshot: (bids: OrderLevel[], asks: OrderLevel[], lastUpdateId: number) => void
  applyOrderBookDiff: (bids: OrderLevel[], asks: OrderLevel[], lastUpdateId: number, transactionTime: number) => void
  setOrderBookHealth: (health: OrderBookHealth, error?: string | null) => void
  setOrderBookSource: (source: OrderBookSource) => void
  clearOrderBook: () => void
  markOrderBookStale: (reason: string) => void
  resyncOrderBook: () => void
  rebuildVolumeProfile: () => void
  addHeatmapSnapshot: () => void
  updateBubbles: () => void
  setTicker: (ticker: Ticker24h | null) => void
  updateLivePrice: (price: number, change: number, changePct: number) => void
  setConnectionError: (error: string | null) => void
  setTradeError: (error: string | null) => void
  setDepthError: (error: string | null) => void
  setTickerError: (error: string | null) => void
  setInstruments: (instruments: Instrument[]) => void
  setInstrumentsLoading: (loading: boolean) => void
  loadHistoricalCandles: (candles: Candle[]) => void
  updateClusters: () => void
  setDepthStale: (stale: boolean) => void
  setDepthLastMessageTime: (time: number) => void

  // Flow Events & Alerts
  tickFlowEvents: () => void
  toggleAlertRule: (ruleId: string) => void
  updateAlertRule: (ruleId: string, patch: Partial<AlertRule>) => void
  resetAlertRules: () => void

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
    tradeError: null as string | null,
    depthError: null as string | null,
    tickerError: null as string | null,
    lastTradeTime: 0,
    instruments: [] as Instrument[],
    instrumentsLoading: false,
    levelMemory: [] as LevelRecord[],
    clusters: [] as AuctionCluster[],
    flowEvents: [] as FlowEvent[],
    alertRules: loadAlertRules() as AlertRule[],
    depthStale: false,
    depthLastMessageTime: 0,
    orderBookHealth: 'DISCONNECTED' as OrderBookHealth,
    orderBookSource: 'none' as OrderBookSource,
    orderBookLastUpdateId: 0,
    orderBookLastEventUpdateId: 0,
    orderBookLastTransactionTime: 0,
    orderBookReconnectAttempts: 0,
    orderBookError: null as string | null,
    orderBookBufferedEvents: [] as DiffDepthEvent[],
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
    tradeError: null as string | null,
    depthError: null as string | null,
    tickerError: null as string | null,
    lastTradeTime: 0,
    clusters: [] as AuctionCluster[],
    flowEvents: [] as FlowEvent[],
    depthStale: false,
    depthLastMessageTime: 0,
    orderBookHealth: 'DISCONNECTED' as OrderBookHealth,
    orderBookSource: 'none' as OrderBookSource,
    orderBookLastUpdateId: 0,
    orderBookLastEventUpdateId: 0,
    orderBookLastTransactionTime: 0,
    orderBookReconnectAttempts: 0,
    orderBookError: null as string | null,
    orderBookBufferedEvents: [] as DiffDepthEvent[],
  }
}

export const useMarketStore = create<MarketState>((set, get) => ({
  ...getInitialState(),

  setMode: (mode) => set({ mode }),
  setSymbol: (symbol) => {
    // Clean reset of ALL data buffers — no stale state leakage
    resetLevels()
    set({
      ...getDataResetFields(),
      symbol,
      mode: get().mode,
      interval: get().interval,
      instruments: get().instruments,
      instrumentsLoading: get().instrumentsLoading,
      levelMemory: [],
    })
  },
  setInterval: (interval) => {
    set({ interval, candles: [], currentCandle: null, bubbles: [] })
  },
  setConnected: (connected) => {
    const update: Partial<MarketState> = { connected, tradeError: connected ? null : undefined }
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

  setOrderBookSnapshot: (bids, asks, lastUpdateId) => {
    set({
      bids,
      asks,
      orderBookLastUpdateId: lastUpdateId,
      orderBookLastEventUpdateId: lastUpdateId,
      orderBookError: null,
      orderBookReconnectAttempts: 0,
      depthStale: false,
      depthConnected: true,
    })
  },

  applyOrderBookDiff: (bids, asks, lastUpdateId, transactionTime) => {
    const state = get()
    set({
      bids,
      asks,
      orderBookLastEventUpdateId: lastUpdateId,
      orderBookLastTransactionTime: transactionTime,
      // Only set HEALTHY if currently in a syncing state (let engine control)
      // The engine sets health via setOrderBookHealth callback
      depthStale: false,
      depthLastMessageTime: Date.now(),
    })
  },

  setOrderBookHealth: (health, error = null) => {
    const isConnected = health !== 'DISCONNECTED' && health !== 'ERROR'
    const isLive = health === 'HEALTHY' || health === 'DEGRADED' || health === 'TOP20'
    set({
      orderBookHealth: health,
      orderBookError: error,
      depthStale: !isLive,
      depthConnected: isConnected,
    })
  },

  setOrderBookSource: (source) => set({ orderBookSource: source }),

  clearOrderBook: () => set({
    bids: [],
    asks: [],
    orderBookLastUpdateId: 0,
    orderBookLastEventUpdateId: 0,
    orderBookLastTransactionTime: 0,
    orderBookHealth: 'DISCONNECTED',
    orderBookSource: 'none',
    orderBookError: null,
    orderBookReconnectAttempts: 0,
    depthStale: false,
    depthConnected: false,
    depthLastMessageTime: 0,
  }),

  markOrderBookStale: (reason) => set({
    orderBookHealth: 'STALE',
    orderBookError: reason,
    depthStale: true,
  }),

  resyncOrderBook: () => {
    const state = get()
    set({
      orderBookHealth: 'RESYNCING',
      orderBookError: 'Resyncing order book…',
      orderBookReconnectAttempts: state.orderBookReconnectAttempts + 1,
      depthStale: true,
      orderBookBufferedEvents: [],
    })
  },

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
      // Use local time for stale detection to avoid Binance server clock skew
      const timeSinceLastTrade = Date.now() - state.lastTradeTime
      const isStale = timeSinceLastTrade > STALE_THRESHOLD
      // Only set trade stale if we were previously receiving trades
      // Don't clear it if depthError is also set (keep messages separate)
      if (isStale && !state.tradeError) {
        set({ tradeError: `No trades for ${(timeSinceLastTrade / 1000).toFixed(0)}s — trade stream may be stale` })
      } else if (!isStale && state.tradeError && state.tradeError.startsWith('No trades for')) {
        // Clear stale message when trades resume
        set({ tradeError: null })
      }
    }

    // Re-classify all current candle bubbles with latest price data
    const updatedCurrentBubbles = state.currentCandle.bubbles.map(b =>
      classifyBubble(b, state.currentCandle!.close, state.currentCandle!.high, state.currentCandle!.low)
    )

    // Propagate updated states to the global bubbles array
    const updatedMap = new Map(updatedCurrentBubbles.map(b => [b.id, b]))
    const updatedGlobalBubbles = state.bubbles.map(b => updatedMap.get(b.id) ?? b)

    // Update level memory from bubbles + orderbook
    const levelMemory = updateLevelsFromBubbles(
      updatedGlobalBubbles,
      state.bids,
      state.asks,
      state.livePrice
    )

    // Update auction clusters
    const clusters = formClusters(
      updatedGlobalBubbles,
      state.interval,
      state.livePrice,
      state.currentCandle!.high,
      state.currentCandle!.low,
      state.clusters
    )

    set({
      currentCandle: { ...state.currentCandle, bubbles: updatedCurrentBubbles },
      bubbles: updatedGlobalBubbles,
      levelMemory,
      clusters,
    })
  },

  setTicker: (ticker) => set({ ticker }),
  updateLivePrice: (price, change, changePct) => set({
    livePrice: price,
    liveChange: change,
    liveChangePct: changePct,
  }),
  setConnectionError: (error) => set({ connectionError: error }),
  setTradeError: (error) => set({ tradeError: error }),
  setDepthError: (error) => set({ depthError: error }),
  setTickerError: (error) => set({ tickerError: error }),
  setInstruments: (instruments) => set({ instruments }),
  setInstrumentsLoading: (loading) => set({ instrumentsLoading: loading }),

  loadHistoricalCandles: (historicalCandles) => {
    const state = get()
    const existing = state.candles
    const merged = new Map<number, Candle>()
    for (const c of existing) merged.set(c.openTime, c)
    for (const c of historicalCandles) {
      if (!merged.has(c.openTime)) merged.set(c.openTime, c)
    }
    const sorted = Array.from(merged.values()).sort((a, b) => a.openTime - b.openTime)
    set({ candles: sorted.slice(-MAX_CANDLES) })
  },

  updateClusters: () => {
    const state = get()
    const clusters = formClusters(
      state.bubbles,
      state.interval,
      state.livePrice,
      state.currentCandle?.high ?? state.livePrice,
      state.currentCandle?.low ?? state.livePrice,
      state.clusters
    )
    set({ clusters })
  },

  setDepthStale: (stale) => set({ depthStale: stale }),
  setDepthLastMessageTime: (time) => set({ depthLastMessageTime: time }),

  // ─── Flow Events & Alerts ───
  tickFlowEvents: () => {
    const state = get()
    const now = Date.now()

    // Get spread info inline (avoid circular import)
    let spreadPct = 0
    if (state.bids.length > 0 && state.asks.length > 0) {
      const bestBid = state.bids[0].price
      const bestAsk = state.asks[0].price
      if (bestBid > 0 && bestAsk > bestBid) {
        spreadPct = ((bestAsk - bestBid) / bestBid) * 100
      }
    }

    // Derive flow events from market activity
    const newFlowEvents = deriveFlowEvents({
      recentTrades: state.recentTrades,
      bids: state.bids,
      asks: state.asks,
      bubbles: state.bubbles,
      livePrice: state.livePrice,
      spreadPct,
      previousEvents: state.flowEvents,
      now,
    })

    // Evaluate alert rules
    const { events: alertEvents } = evaluateAlerts({
      rules: state.alertRules,
      recentTrades: state.recentTrades,
      bids: state.bids,
      asks: state.asks,
      livePrice: state.livePrice,
      spreadPct,
      now,
    })

    // Merge alert events into flow events
    const merged = alertEvents.length > 0
      ? [...alertEvents, ...newFlowEvents].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30)
      : newFlowEvents

    set({ flowEvents: merged })
  },

  toggleAlertRule: (ruleId) => {
    const rules = get().alertRules.map(r =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    )
    saveAlertRules(rules)
    set({ alertRules: rules })
  },

  updateAlertRule: (ruleId, patch) => {
    const rules = get().alertRules.map(r =>
      r.id === ruleId ? { ...r, ...patch } : r
    )
    saveAlertRules(rules)
    set({ alertRules: rules })
  },

  resetAlertRules: () => {
    const defaults = getDefaultRules()
    saveAlertRules(defaults)
    set({ alertRules: defaults })
  },

  reset: () => set(getInitialState()),
}))
