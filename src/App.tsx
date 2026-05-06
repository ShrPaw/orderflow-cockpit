import { useEffect, useRef } from 'react'
import { useMarketStore } from './stores/marketStore'
import { connectBinanceAggTrade } from './connectors/binanceAggTrade'
import { connectBinanceDepth } from './connectors/binanceDepth'
import { fetchTicker24h, connectMiniTicker } from './connectors/binanceTicker'
import { generateDemoTrade, generateDemoDepth, resetDemoPrice } from './connectors/demoData'
import ChartCanvas from './components/ChartCanvas'
import Toolbar from './components/Toolbar'
import SidePanel from './components/SidePanel'
import DOMLite from './components/DOMLite'
import Heatmap from './components/Heatmap'
import TradeFlow from './components/TradeFlow'
import ConnectionStatus from './components/ConnectionStatus'
import MarketHeader from './components/MarketHeader'
import './App.css'

export default function App() {
  const mode = useMarketStore(s => s.mode)
  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)

  const processTrade = useMarketStore(s => s.processTrade)
  const setDepth = useMarketStore(s => s.setDepth)
  const setConnected = useMarketStore(s => s.setConnected)
  const setDepthConnected = useMarketStore(s => s.setDepthConnected)
  const rebuildVolumeProfile = useMarketStore(s => s.rebuildVolumeProfile)
  const addHeatmapSnapshot = useMarketStore(s => s.addHeatmapSnapshot)
  const updateBubbles = useMarketStore(s => s.updateBubbles)
  const setTicker = useMarketStore(s => s.setTicker)
  const updateLivePrice = useMarketStore(s => s.updateLivePrice)
  const setConnectionError = useMarketStore(s => s.setConnectionError)

  const cleanupTrade = useRef<(() => void) | null>(null)
  const cleanupDepth = useRef<(() => void) | null>(null)
  const cleanupTicker = useRef<(() => void) | null>(null)
  const demoInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live mode connections
  useEffect(() => {
    // Cleanup previous
    cleanupTrade.current?.()
    cleanupDepth.current?.()
    cleanupTicker.current?.()
    if (demoInterval.current) {
      clearInterval(demoInterval.current)
      demoInterval.current = null
    }
    if (tickerInterval.current) {
      clearInterval(tickerInterval.current)
      tickerInterval.current = null
    }

    if (mode === 'live') {
      // Fetch 24h ticker immediately
      fetchTicker24h(symbol).then(ticker => {
        if (ticker) {
          setTicker(ticker)
          updateLivePrice(ticker.price, ticker.change, ticker.changePct)
        }
      })

      // Refresh ticker every 10s
      tickerInterval.current = setInterval(async () => {
        const ticker = await fetchTicker24h(symbol)
        if (ticker) setTicker(ticker)
      }, 10_000)

      // Connect mini ticker for live price updates
      cleanupTicker.current = connectMiniTicker(symbol, (price, change, changePct) => {
        updateLivePrice(price, change, changePct)
      })

      // Connect aggTrade
      cleanupTrade.current = connectBinanceAggTrade(
        symbol,
        (trade) => processTrade(trade),
        (connected) => {
          setConnected(connected)
          if (!connected) {
            setConnectionError('aggTrade stream disconnected')
          } else {
            setConnectionError(null)
          }
        }
      )

      // Connect depth
      cleanupDepth.current = connectBinanceDepth(
        symbol,
        (bids, asks) => setDepth(bids, asks),
        (connected) => setDepthConnected(connected)
      )
    } else {
      // Demo mode
      setConnected(true)
      setDepthConnected(true)
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
      }
    }

    return () => {
      cleanupTrade.current?.()
      cleanupDepth.current?.()
      cleanupTicker.current?.()
      if (tickerInterval.current) clearInterval(tickerInterval.current)
    }
  }, [mode, symbol, processTrade, setDepth, setConnected, setDepthConnected, setTicker, updateLivePrice, setConnectionError])

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
      <Toolbar />
      <MarketHeader />
      <div className="main-area">
        <div className="chart-panel">
          <ChartCanvas />
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
