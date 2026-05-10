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

  const processTrade = useMarketStore(s => s.processTrade)
  const setDepth = useMarketStore(s => s.setDepth)
  const setConnected = useMarketStore(s => s.setConnected)
  const setDepthConnected = useMarketStore(s => s.setDepthConnected)
  const setTickerConnected = useMarketStore(s => s.setTickerConnected)
  const rebuildVolumeProfile = useMarketStore(s => s.rebuildVolumeProfile)
  const addHeatmapSnapshot = useMarketStore(s => s.addHeatmapSnapshot)
  const updateBubbles = useMarketStore(s => s.updateBubbles)
  const setTicker = useMarketStore(s => s.setTicker)
  const updateLivePrice = useMarketStore(s => s.updateLivePrice)
  const setConnectionError = useMarketStore(s => s.setConnectionError)
  const loadHistoricalCandles = useMarketStore(s => s.loadHistoricalCandles)
  const setDepthStale = useMarketStore(s => s.setDepthStale)
  const setDepthLastMessageTime = useMarketStore(s => s.setDepthLastMessageTime)
  const setOrderBookSnapshot = useMarketStore(s => s.setOrderBookSnapshot)
  const applyOrderBookDiff = useMarketStore(s => s.applyOrderBookDiff)
  const setOrderBookHealth = useMarketStore(s => s.setOrderBookHealth)
  const markOrderBookStale = useMarketStore(s => s.markOrderBookStale)
  const clearOrderBook = useMarketStore(s => s.clearOrderBook)

  const cleanupTrade = useRef<(() => void) | null>(null)
  const cleanupDepth = useRef<(() => void) | null>(null)
  const cleanupTicker = useRef<(() => void) | null>(null)
  const demoInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const diagInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live mode connections
  useEffect(() => {
    // Cleanup previous
    cleanupTrade.current?.()
    cleanupDepth.current?.()
    clearOrderBook()
    cleanupTicker.current?.()
    if (demoInterval.current) {
      clearInterval(demoInterval.current)
      demoInterval.current = null
    }
    if (tickerInterval.current) {
      clearInterval(tickerInterval.current)
      tickerInterval.current = null
    }
    if (diagInterval.current) {
      clearInterval(diagInterval.current)
      diagInterval.current = null
    }

    if (mode === 'live') {
      // Fetch historical candles first, then connect live streams
      fetchHistoricalKlines(symbol, interval, 1000).then(historical => {
        if (historical.length > 0) {
          loadHistoricalCandles(historical)
          console.log(`[Klines] Loaded ${historical.length} historical candles for ${symbol}`)
        }
      }).catch(err => {
        console.warn('[Klines] Historical load failed:', err)
      })

      // Fetch 24h ticker immediately
      fetchTicker24h(symbol).then(ticker => {
        if (ticker) {
          setTicker(ticker)
          updateLivePrice(ticker.price, ticker.change, ticker.changePct)
          setTickerConnected(true)
        }
      }).catch(() => setTickerConnected(false))

      // Refresh ticker every 10s
      tickerInterval.current = setInterval(async () => {
        try {
          const ticker = await fetchTicker24h(symbol)
          if (ticker) {
            setTicker(ticker)
            setTickerConnected(true)
          }
        } catch {
          setTickerConnected(false)
        }
      }, 10_000)

      // Connect mini ticker for live price updates
      cleanupTicker.current = connectMiniTicker(symbol, (price, change, changePct) => {
        updateLivePrice(price, change, changePct)
      })

      // Connect trade stream (@trade replaces dead @aggTrade)
      cleanupTrade.current = connectBinanceAggTrade(
        symbol,
        (trade) => processTrade(trade),
        (connected) => {
          setConnected(connected)
          if (!connected) {
            setConnectionError('Trade stream disconnected')
          } else {
            setConnectionError(null)
          }
        }
      )

      // Connect local order book (diff depth stream + REST snapshot + sequence validation)
      cleanupDepth.current = createLocalOrderBook(symbol, {
        onSnapshot: (bids, asks, lastUpdateId) => {
          setOrderBookSnapshot(bids, asks, lastUpdateId)
          setDepth(bids, asks)
          setDepthConnected(true)
          setConnectionError(null)
        },
        onDiffApplied: (bids, asks, lastUpdateId, transactionTime) => {
          applyOrderBookDiff(bids, asks, lastUpdateId, transactionTime)
          setDepth(bids, asks)
          setDepthStale(false)
          setDepthLastMessageTime(Date.now())
          const state = useMarketStore.getState()
          if (state.connected) setConnectionError(null)
        },
        onHealthChange: (health, error) => {
          setOrderBookHealth(health, error)
          if (health === 'HEALTHY') {
            setDepthConnected(true)
            setDepthStale(false)
          } else if (health === 'DISCONNECTED') {
            setDepthConnected(false)
          } else if (health === 'STALE' || health === 'RESYNCING') {
            setDepthStale(true)
            if (error) setConnectionError(error)
          } else if (health === 'ERROR') {
            setDepthConnected(false)
            if (error) setConnectionError(`Order book error: ${error}`)
          }
        },
        onStale: (reason) => {
          markOrderBookStale(reason)
          setDepthStale(true)
          setConnectionError(`Depth book stale — ${reason}`)
        },
      })

      // Periodic diagnostic log
      diagInterval.current = setInterval(() => {
        const td = getTradeDiagnostics()
        const state = useMarketStore.getState()
        console.table({
          'Trade Stream': { url: td.url, opened: td.opened, messages: td.messageCount, parseErrors: td.parseErrors, lastMsg: td.lastMessageTime ? new Date(td.lastMessageTime).toLocaleTimeString() : 'never' },
          'Order Book': { health: state.orderBookHealth, lastUpdateId: state.orderBookLastUpdateId, lastEventU: state.orderBookLastEventUpdateId, bidLevels: state.bids.length, askLevels: state.asks.length, error: state.orderBookError ?? 'none' },
        })
      }, 15_000)

    } else {
      // Demo mode
      setConnected(true)
      setDepthConnected(true)
      setTickerConnected(true)
      setOrderBookHealth('HEALTHY')
      resetDemoPrice()

      demoInterval.current = setInterval(() => {
        const trade = generateDemoTrade()
        processTrade(trade)
      }, 100)

      const depthInterval = setInterval(() => {
        const depth = generateDemoDepth()
        setDepth(depth.bids, depth.asks)
      }, 200)

      return () => {
        if (demoInterval.current) clearInterval(demoInterval.current)
        clearInterval(depthInterval)
        setConnected(false)
        setDepthConnected(false)
        setTickerConnected(false)
      }
    }

    return () => {
      cleanupTrade.current?.()
      cleanupDepth.current?.()
      cleanupTicker.current?.()
      if (tickerInterval.current) clearInterval(tickerInterval.current)
      if (diagInterval.current) clearInterval(diagInterval.current)
    }
  }, [mode, symbol, interval, processTrade, setDepth, setConnected, setDepthConnected, setTickerConnected, setTicker, updateLivePrice, setConnectionError, loadHistoricalCandles])

  // Periodic volume profile rebuild
  useEffect(() => {
    const iv = setInterval(() => {
      rebuildVolumeProfile()
      addHeatmapSnapshot()
      updateBubbles()
    }, 2000)
    return () => clearInterval(iv)
  }, [rebuildVolumeProfile, addHeatmapSnapshot, updateBubbles])

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
