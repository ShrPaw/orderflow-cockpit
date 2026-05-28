import { useEffect, useRef, useState } from 'react'
import { useMarketStore } from './stores/marketStore'
import { connectBinanceAggTrade, getTradeDiagnostics } from './connectors/binanceAggTrade'
import { createLocalOrderBook, type LocalOrderBookHandle } from './connectors/localOrderBook'
import { fetchTicker24h, connectMiniTicker } from './connectors/binanceTicker'
import { fetchHistoricalKlines } from './connectors/binanceKlines'
import ExecutionChart from './components/ExecutionChart'
import Toolbar from './components/Toolbar'
import SidePanel from './components/SidePanel'
import DOMLite from './components/DOMLite'
import Heatmap from './components/Heatmap'
import TradeFlow from './components/TradeFlow'
import FootprintChart from './components/FootprintChart'
import DeltaHistogram from './components/DeltaHistogram'
import ConnectionStatus from './components/ConnectionStatus'
import AlertFeed from './components/AlertFeed'
import MarketHeader from './components/MarketHeader'
import CommandPalette from './components/CommandPalette'
import './App.css'

export default function App() {
  const [bottomTab, setBottomTab] = useState<'trades' | 'footprint'>('trades')
  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)

  const cleanupTrade = useRef<(() => void) | null>(null)
  const cleanupDepth = useRef<LocalOrderBookHandle | null>(null)
  const cleanupTicker = useRef<(() => void) | null>(null)
  const tickerInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const diagInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Main connection effect ───
  useEffect(() => {
    const store = useMarketStore.getState

    // Cleanup any previous connections
    cleanupTrade.current?.()
    cleanupTrade.current = null
    cleanupDepth.current?.dispose()
    cleanupDepth.current = null
    cleanupTicker.current?.()
    cleanupTicker.current = null
    store().clearOrderBook()

    if (tickerInterval.current) { clearInterval(tickerInterval.current); tickerInterval.current = null }
    if (diagInterval.current) { clearInterval(diagInterval.current); diagInterval.current = null }

    // Fetch historical candles first, then connect live streams
    fetchHistoricalKlines(symbol, interval, 1000).then(historical => {
      if (historical.length > 0) {
        store().loadHistoricalCandles(historical)
        console.log(`[Klines] Loaded ${historical.length} historical candles for ${symbol}`)
      }
    }).catch(err => {
      console.warn('[Klines] Historical load failed:', err)
    })

    // Fetch 24h ticker immediately
    fetchTicker24h(symbol).then(ticker => {
      if (ticker) {
        store().setTicker(ticker)
        store().updateLivePrice(ticker.price, ticker.change, ticker.changePct)
        store().setTickerConnected(true)
      }
    }).catch(() => store().setTickerConnected(false))

    // Refresh ticker every 10s
    tickerInterval.current = setInterval(async () => {
      try {
        const ticker = await fetchTicker24h(symbol)
        if (ticker) {
          store().setTicker(ticker)
          store().setTickerConnected(true)
        }
      } catch {
        store().setTickerConnected(false)
      }
    }, 10_000)

    // Connect mini ticker for live price updates
    cleanupTicker.current = connectMiniTicker(symbol, (price, change, changePct) => {
      store().updateLivePrice(price, change, changePct)
    })

    // Connect trade stream
    cleanupTrade.current = connectBinanceAggTrade(
      symbol,
      (trade) => store().processTrade(trade),
      (connected) => {
        store().setConnected(connected)
        if (!connected) {
          store().setTradeError('Trade stream disconnected')
        } else {
          store().setTradeError(null)
        }
      }
    )

    // Connect local order book (dual-stream: depth20 immediate + strict parallel)
    cleanupDepth.current = createLocalOrderBook(symbol, {
      onSnapshot: (bids, asks, lastUpdateId) => {
        store().setOrderBookSnapshot(bids, asks, lastUpdateId)
        store().setDepth(bids, asks)
        store().setDepthConnected(true)
        store().setDepthError(null)
      },
      onDiffApplied: (bids, asks, lastUpdateId, transactionTime) => {
        store().applyOrderBookDiff(bids, asks, lastUpdateId, transactionTime)
        store().setDepth(bids, asks)
        store().setDepthStale(false)
        store().setDepthLastMessageTime(Date.now())
        if (store().connected) store().setDepthError(null)
      },
      onHealthChange: (health, error) => {
        store().setOrderBookHealth(health, error)
        if (health === 'HEALTHY') {
          store().setDepthConnected(true)
          store().setDepthStale(false)
          store().setDepthError(null)
        } else if (health === 'DEGRADED' || health === 'TOP20') {
          store().setDepthConnected(true)
          store().setDepthStale(false)
        } else if (health === 'DISCONNECTED') {
          store().setDepthConnected(false)
        } else if (health === 'BUFFERING' || health === 'SNAPSHOT_LOADING' || health === 'SYNCING') {
          store().setDepthConnected(true)
        } else if (health === 'STALE' || health === 'RESYNCING') {
          store().setDepthStale(true)
        } else if (health === 'ERROR') {
          store().setDepthConnected(false)
          store().setDepthError(`Book error: ${error}`)
        }
      },
      onSourceChange: (source) => {
        store().setOrderBookSource(source)
      },
      onStale: (reason) => {
        store().markOrderBookStale(reason)
        store().setDepthStale(true)
      },
    })

  // Wire store resyncOrderBook to also trigger engine resync
  useMarketStore.setState({ resyncOrderBook: () => {
    const store = useMarketStore.getState()
    // Set RESYNCING state flags directly (mirrors store resyncOrderBook logic)
    useMarketStore.setState({
      orderBookHealth: "RESYNCING",
      orderBookError: "Resyncing order book…",
      orderBookReconnectAttempts: store.orderBookReconnectAttempts + 1,
      depthStale: true,
      orderBookBufferedEvents: [],
    })
    cleanupDepth.current?.resync()
  }})

    // Periodic diagnostic log
    diagInterval.current = setInterval(() => {
      const td = getTradeDiagnostics()
      const s = useMarketStore.getState()
      console.table({
        'Trade Stream': { url: td.url, opened: td.opened, messages: td.messageCount, parseErrors: td.parseErrors, lastMsg: td.lastMessageTime ? new Date(td.lastMessageTime).toLocaleTimeString() : 'never' },
        'Order Book': { health: s.orderBookHealth, source: s.orderBookSource, lastUpdateId: s.orderBookLastUpdateId, lastEventU: s.orderBookLastEventUpdateId, bidLevels: s.bids.length, askLevels: s.asks.length, error: s.orderBookError ?? 'none' },
      })
    }, 15_000)

    return () => {
      cleanupTrade.current?.()
      cleanupTrade.current = null
      cleanupDepth.current?.dispose()
      cleanupDepth.current = null
      cleanupTicker.current?.()
      cleanupTicker.current = null
      if (tickerInterval.current) { clearInterval(tickerInterval.current); tickerInterval.current = null }
      if (diagInterval.current) { clearInterval(diagInterval.current); diagInterval.current = null }
    }
  }, [symbol, interval])

  // Periodic volume profile rebuild + flow events
  useEffect(() => {
    const iv = setInterval(() => {
      useMarketStore.getState().rebuildVolumeProfile()
      useMarketStore.getState().addHeatmapSnapshot()
      useMarketStore.getState().updateBubbles()
      useMarketStore.getState().tickFlowEvents()
    }, 2000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="app">
      <CommandPalette />
      <ConnectionStatus />
      <Toolbar />
      <MarketHeader />
      <div className="main-area">
        <div className="chart-panel">
          <ExecutionChart />
        </div>
        <div className="right-panels">
          <SidePanel />
          <DOMLite />
          <Heatmap />
        </div>
        <div className="alert-panel">
          <AlertFeed />
        </div>
      </div>
      <div className="delta-strip">
        <DeltaHistogram />
      </div>
      <div className="bottom-bar">
        <div className="bottom-tabs">
          <button className={`bottom-tab ${bottomTab === 'trades' ? 'active' : ''}`} onClick={() => setBottomTab('trades')}>Trades</button>
          <button className={`bottom-tab ${bottomTab === 'footprint' ? 'active' : ''}`} onClick={() => setBottomTab('footprint')}>Footprint</button>
        </div>
        <div className="bottom-content">
          {bottomTab === 'trades' ? <TradeFlow /> : <FootprintChart />}
        </div>
      </div>
    </div>
  )
}
