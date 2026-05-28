import { useState, useCallback, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'
import type { Interval } from '../types/market'
import { INSTRUMENTS } from '../types/market'
import { fmtPrice } from '../utils/formatters'
import AssetSelector from './AssetSelector'
import '../brand.css'

const INTERVALS: Interval[] = ['10s', '20s', '40s', '1m', '3m', '5m']

export default function Toolbar() {
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

  const setInterval = useMarketStore(s => s.setInterval)
  const showVWAP = useMarketStore(s => s.showVWAP)
  const showLiquidityLabels = useMarketStore(s => s.showLiquidityLabels)
  const showVolumeProfile = useMarketStore(s => s.showVolumeProfile)
  const toggleOverlay = useMarketStore(s => s.toggleOverlay)

  const [showAssetSelector, setShowAssetSelector] = useState(false)

  // Current instrument info
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
        {/* Left: Brand + Symbol + Price */}
        <div className="toolbar-left">
          <div className="brand-mark" title="Orderflow Cockpit">
            <svg className="brand-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M 4,13.5 Q 24,4 44,13.5" stroke="#0d4f6e" strokeWidth="1.2" opacity="0.3" strokeLinecap="round"/>
              <path d="M 4,34.5 Q 24,44 44,34.5" stroke="#0d4f6e" strokeWidth="1.2" opacity="0.3" strokeLinecap="round"/>
              <path d="M 8,17 Q 24,9.5 40,17" stroke="#00b8c4" strokeWidth="1.6" opacity="0.5" strokeLinecap="round"/>
              <path d="M 8,31 Q 24,38.5 40,31" stroke="#00b8c4" strokeWidth="1.6" opacity="0.5" strokeLinecap="round"/>
              <path d="M 13,21 Q 24,16 35,21" stroke="#00e8dc" strokeWidth="2" opacity="0.75" strokeLinecap="round"/>
              <path d="M 13,27 Q 24,32 35,27" stroke="#00e8dc" strokeWidth="2" opacity="0.75" strokeLinecap="round"/>
              <circle cx="11" cy="18" r="1.5" fill="#00c8d0" opacity="0.5"/>
              <circle cx="37" cy="30" r="1.5" fill="#00c8d0" opacity="0.5"/>
              <circle cx="24" cy="24" r="3" fill="#00f5ec" opacity="0.9"/>
              <circle cx="24" cy="24" r="7" stroke="#00f5ec" strokeWidth="0.5" opacity="0.2"/>
            </svg>
            <span className="brand-text">ORDERFLOW</span>
          </div>

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

        {/* Right: Interval + Nav + Overlays */}
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

          <div className="overlay-toggles">
            <button
              className={`overlay-btn ${showVWAP ? 'active' : ''}`}
              onClick={() => toggleOverlay('showVWAP')}
              title="Toggle VWAP line"
            >VWAP</button>
            <button
              className={`overlay-btn ${showLiquidityLabels ? 'active' : ''}`}
              onClick={() => toggleOverlay('showLiquidityLabels')}
              title="Toggle liquidity level labels"
            >Liq</button>
            <button
              className={`overlay-btn ${showVolumeProfile ? 'active' : ''}`}
              onClick={() => toggleOverlay('showVolumeProfile')}
              title="Toggle volume profile"
            >VP</button>
          </div>
        </div>
      </div>

      {showAssetSelector && (
        <AssetSelector onClose={() => setShowAssetSelector(false)} />
      )}
    </>
  )
}
