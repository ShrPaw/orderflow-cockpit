import { useState, useCallback, useEffect } from 'react'
import { useMarketStore } from '../stores/marketStore'
import type { Interval } from '../types/market'

const INTERVALS: Interval[] = ['10s', '20s', '40s', '1m', '3m', '5m']

export default function Toolbar() {
  const mode = useMarketStore(s => s.mode)
  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const followLive = useMarketStore(s => s.followLive)

  const setMode = useMarketStore(s => s.setMode)
  const setSymbol = useMarketStore(s => s.setSymbol)
  const setInterval = useMarketStore(s => s.setInterval)
  const setFollowLive = useMarketStore(s => s.setFollowLive)

  const [inputValue, setInputValue] = useState(symbol)

  const onSymbolSubmit = useCallback(() => {
    const sym = inputValue.trim().toUpperCase()
    if (sym) setSymbol(sym)
  }, [inputValue, setSymbol])

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSymbolSubmit()
  }, [onSymbolSubmit])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const chartApi = (window as any).__chartApi

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className={`status-pill ${mode === 'live' ? 'live' : 'demo'}`}>
          {mode === 'live' ? '● LIVE' : '◉ DEMO'}
        </div>

        <input
          className="symbol-input"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={onKey}
          onBlur={onSymbolSubmit}
          placeholder="BTCUSDT"
        />

        <select
          className="interval-select"
          value={interval}
          onChange={e => setInterval(e.target.value as Interval)}
        >
          {INTERVALS.map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>

        <div className="connection-status">
          <span className={`dot ${connected ? 'green' : 'red'}`} title="aggTrade" />
          <span className={`dot ${depthConnected ? 'green' : 'red'}`} title="depth" />
        </div>
      </div>

      <div className="toolbar-center">
        <div className={`view-mode-indicator ${followLive ? 'live' : 'manual'}`}>
          <span className="view-dot" />
          <span className="view-label">{followLive ? 'LIVE' : 'HISTORY'}</span>
        </div>
      </div>

      <div className="toolbar-right">
        <div className="nav-controls">
          <button
            className={`nav-btn ${followLive ? 'active' : ''}`}
            onClick={() => chartApi?.goLive()}
            title="Return to live edge (Home)"
          >
            ◉ Live
          </button>
          <button
            className="nav-btn"
            onClick={() => chartApi?.fitRecent()}
            title="Fit recent 250 candles (F)"
          >
            ⊞ Recent
          </button>
          <button
            className="nav-btn"
            onClick={() => chartApi?.fitAll()}
            title="Fit all history (A)"
          >
            ⊞ All
          </button>
          <button
            className="nav-btn"
            onClick={() => chartApi?.resetView()}
            title="Reset view (R / 0)"
          >
            ↺ Reset
          </button>
        </div>

        <div className="toolbar-divider" />

        <button
          className={`toggle-btn ${mode === 'demo' ? 'active' : ''}`}
          onClick={() => setMode(mode === 'demo' ? 'live' : 'demo')}
        >
          {mode === 'demo' ? '▶ Live' : '◉ Demo'}
        </button>
      </div>
    </div>
  )
}
