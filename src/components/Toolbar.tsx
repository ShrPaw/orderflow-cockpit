import { useState, useCallback, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'
import type { Interval } from '../types/market'
import { INSTRUMENTS } from '../types/market'
import { fmtPrice } from '../utils/formatters'
import AssetSelector from './AssetSelector'

const INTERVALS: Interval[] = ['10s', '20s', '40s', '1m', '3m', '5m']

export default function Toolbar() {
  const mode = useMarketStore(s => s.mode)
  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const followLive = useMarketStore(s => s.followLive)
  const livePrice = useMarketStore(s => s.livePrice)
  const liveChange = useMarketStore(s => s.liveChange)
  const liveChangePct = useMarketStore(s => s.liveChangePct)
  const tradeError = useMarketStore(s => s.tradeError)
  const tickerError = useMarketStore(s => s.tickerError)
  const instruments = useMarketStore(s => s.instruments)

  const setMode = useMarketStore(s => s.setMode)
  const setInterval = useMarketStore(s => s.setInterval)

  const [showAssetSelector, setShowAssetSelector] = useState(false)

  // Current instrument info — check dynamic list first, then static fallback
  const allInstruments = instruments.length > 0 ? instruments : INSTRUMENTS
  const instrument = allInstruments.find(i => i.symbol === symbol)
  const baseName = instrument?.base ?? symbol.replace('USDT', '')

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    const api = (window as any).__chartApi
    if (!api) return
    switch (e.key) {
      case 'Home':
        e.preventDefault()
        api.goLive()
        break
      case 'r':
      case 'R':
        e.preventDefault()
        api.resetView()
        break
      case 'f':
      case 'F':
        e.preventDefault()
        api.fitRecent()
        break
      case 'a':
      case 'A':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          api.fitAll()
        }
        break
      case '0':
        e.preventDefault()
        api.resetView()
        break
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const chartApi = (window as any).__chartApi
  const isUp = liveChange >= 0
  const priceColor = liveChangePct > 0 ? 'green' : liveChangePct < 0 ? 'red' : ''

  return (
    <>
      <div className="toolbar">
        {/* Left: Symbol + Price */}
        <div className="toolbar-left">
          <button
            className={`mode-toggle ${mode}`}
            onClick={() => setMode(mode === 'demo' ? 'live' : 'demo')}
            title={mode === 'live' ? 'Switch to Demo' : 'Switch to Live'}
          >
            <span className="mode-dot" />
            {mode === 'live' ? 'LIVE' : 'DEMO'}
          </button>

          <div className="symbol-block" onClick={() => setShowAssetSelector(true)}>
            <span className="symbol-name">{baseName}</span>
            <span className="symbol-quote">/USDT</span>
            <span className="symbol-chevron">▾</span>
          </div>

          {livePrice > 0 && (
            <div className="price-block">
              <span className={`price-value ${priceColor}`}>
                {fmtPrice(livePrice)}
              </span>
              <span className={`price-change ${priceColor}`}>
                {isUp ? '+' : ''}{liveChange.toFixed(2)} ({isUp ? '+' : ''}{liveChangePct.toFixed(2)}%)
              </span>
            </div>
          )}

          <div className="connection-dots">
            <span
              className={`conn-dot ${tickerConnected ? 'ok' : 'fail'}`}
              title={tickerConnected ? 'Ticker connected' : 'Ticker disconnected'}
            />
            <span
              className={`conn-dot ${connected ? 'ok' : 'fail'}`}
              title={connected ? 'Trade stream connected' : 'Trade stream disconnected'}
            />
            <span
              className={`conn-dot ${depthConnected ? 'ok' : 'fail'}`}
              title={depthConnected ? 'Depth connected' : 'Depth disconnected'}
            />
          </div>

          {(() => {
            // Only show trade/ticker errors in toolbar — book health shown in ConnectionStatus
            const errors = [tradeError, tickerError].filter(Boolean)
            const connectionError = errors.length > 0 ? errors.join(' · ') : null
            return connectionError ? (
              <span className="conn-error" title={connectionError}>⚠</span>
            ) : null
          })()}
        </div>

        {/* Center: View mode */}
        <div className="toolbar-center">
          <div className={`view-indicator ${followLive ? 'live' : 'history'}`}>
            <span className="view-pulse" />
            <span>{followLive ? 'LIVE FEED' : 'HISTORY'}</span>
          </div>
        </div>

        {/* Right: Interval + Nav */}
        <div className="toolbar-right">
          <select
            className="interval-select"
            value={interval}
            onChange={e => setInterval(e.target.value as Interval)}
          >
            {INTERVALS.map(i => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>

          <div className="nav-group">
            <button
              className={`nav-btn ${followLive ? 'active' : ''}`}
              onClick={() => chartApi?.goLive()}
              title="Return to live edge (Home)"
            >◉ Live</button>
            <button
              className="nav-btn"
              onClick={() => chartApi?.fitRecent()}
              title="Fit recent 250 candles (F)"
            >⊞ Recent</button>
            <button
              className="nav-btn"
              onClick={() => chartApi?.fitAll()}
              title="Fit all history (A)"
            >⊞ All</button>
            <button
              className="nav-btn"
              onClick={() => chartApi?.resetView()}
              title="Reset view (R / 0)"
            >↺ Reset</button>
          </div>
        </div>
      </div>

      {showAssetSelector && (
        <AssetSelector onClose={() => setShowAssetSelector(false)} />
      )}
    </>
  )
}
