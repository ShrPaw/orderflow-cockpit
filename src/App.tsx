import { useEffect, useRef, useState } from 'react'
import { useMarketStore } from './stores/marketStore'
import { connectBinanceAggTrade, getTradeDiagnostics } from './connectors/binanceAggTrade'
import { createLocalOrderBook } from './connectors/localOrderBook'
import { fetchTicker24h, connectMiniTicker } from './connectors/binanceTicker'
import { fetchHistoricalKlines } from './connectors/binanceKlines'
import { generateDemoTrade, generateDemoDepth, resetDemoPrice } from './connectors/demoData'
import ChartCanvas from './components/ChartCanvas'
import LightweightChartCanvas from './components/LightweightChartCanvas'

// Chart engine toggle — 'legacy' is default, 'lightweight' is experimental
// Lightweight Charts does not yet support orderflow overlays
// (round levels, orderbook liquidity, rejection coloring, bubbles, heatmap, etc.)
export type ChartEngine = 'legacy' | 'lightweight'
import Toolbar from './components/Toolbar'
import SidePanel from './components/SidePanel'
import DOMLite from './components/DOMLite'
import Heatmap from './components/Heatmap'
import TradeFlow from './components/TradeFlow'
import ConnectionStatus from './components/ConnectionStatus'
import MarketHeader from './components/MarketHeader'
import './App.css'

export default function App() {
  const [chartEngine, setChartEngine] = useState<ChartEngine>('legacy')
  const mode = useMarketStore(s => s.mode)
  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)

  const cleanupTrade = useRef<(() => void) | null>(null)
  const cleanupDepth = useRef<(() => void) | null>(null)
  const cleanupTicker = useRef<(() => void) | null>(null)
  const demoInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const depthDemoInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const diagInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Main connection effect ───
  // Dependencies are ONLY the primitives that require full reconnect:
  //   mode, symbol, interval
  // All store actions are accessed via useMarketStore.getState() inside callbacks
  // so they never cause this effect to re-run.
  useEffect(() => {
    const store = useMarketStore.getState

    // Cleanup any previous connections
    cleanupTrade.current?.()
    cleanupTrade.current = null
    cleanupDepth.current?.()
    cleanupDepth.current = null
    cleanupTicker.current?.()
    cleanupTicker.current = null
    store().clearOrderBook()

    if (demoInterval.current) { clearInterval(demoInterval.current); demoInterval.current = null }
    if (depthDemoInterval.current) { clearInterval(depthDemoInterval.current); depthDemoInterval.current = null }
    if (tickerInterval.current) { clearInterval(tickerInterval.current); tickerInterval.current = null }
    if (diagInterval.current) { clearInterval(diagInterval.current); diagInterval.current = null }

    if (mode === 'live') {
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

      // Connect local order book (diff depth stream + REST snapshot + sequence validation)
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
          } else if (health === 'DISCONNECTED') {
            store().setDepthConnected(false)
          } else if (health === 'STALE' || health === 'RESYNCING') {
            store().setDepthStale(true)
            if (error) store().setDepthError(error)
          } else if (health === 'ERROR') {
            store().setDepthConnected(false)
            if (error) store().setDepthError(`Order book error: ${error}`)
          }
        },
        onStale: (reason) => {
          store().markOrderBookStale(reason)
          store().setDepthStale(true)
          store().setDepthError(`Depth book stale — ${reason}`)
        },
      })

      // Periodic diagnostic log
      diagInterval.current = setInterval(() => {
        const td = getTradeDiagnostics()
        const s = useMarketStore.getState()
        console.table({
          'Trade Stream': { url: td.url, opened: td.opened, messages: td.messageCount, parseErrors: td.parseErrors, lastMsg: td.lastMessageTime ? new Date(td.lastMessageTime).toLocaleTimeString() : 'never' },
          'Order Book': { health: s.orderBookHealth, lastUpdateId: s.orderBookLastUpdateId, lastEventU: s.orderBookLastEventUpdateId, bidLevels: s.bids.length, askLevels: s.asks.length, error: s.orderBookError ?? 'none' },
        })
      }, 15_000)

    } else {
      // Demo mode
      store().setConnected(true)
      store().setDepthConnected(true)
      store().setTickerConnected(true)
      store().setOrderBookHealth('HEALTHY')
      resetDemoPrice()

      demoInterval.current = setInterval(() => {
        store().processTrade(generateDemoTrade())
      }, 100)

      depthDemoInterval.current = setInterval(() => {
        const depth = generateDemoDepth()
        store().setDepth(depth.bids, depth.asks)
      }, 200)
    }

    return () => {
      cleanupTrade.current?.()
      cleanupTrade.current = null
      cleanupDepth.current?.()
      cleanupDepth.current = null
      cleanupTicker.current?.()
      cleanupTicker.current = null
      if (demoInterval.current) { clearInterval(demoInterval.current); demoInterval.current = null }
      if (depthDemoInterval.current) { clearInterval(depthDemoInterval.current); depthDemoInterval.current = null }
      if (tickerInterval.current) { clearInterval(tickerInterval.current); tickerInterval.current = null }
      if (diagInterval.current) { clearInterval(diagInterval.current); diagInterval.current = null }
    }
  }, [mode, symbol, interval])

  // Periodic volume profile rebuild
  useEffect(() => {
    const iv = setInterval(() => {
      useMarketStore.getState().rebuildVolumeProfile()
      useMarketStore.getState().addHeatmapSnapshot()
      useMarketStore.getState().updateBubbles()
    }, 2000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="app">
      <ConnectionStatus />
      <Toolbar chartEngine={chartEngine} onChartEngineChange={setChartEngine} />
      <MarketHeader />
      <div className="main-area">
        <div className="chart-panel">
          {chartEngine === 'lightweight' ? <LightweightChartCanvas /> : <ChartCanvas />}
        </div>
        <div className="right-panels">
          <SidePanel />
          <DOMLite />
          <Heatmap />
        </div>
      </div>
      <div className="bottom-bar">
        <TradeFlow />
      </div>
    </div>
  )
}
