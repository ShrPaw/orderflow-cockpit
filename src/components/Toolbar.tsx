import { useState, useCallback } from 'react'
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

      <div className="toolbar-right">
        <button
          className={`toggle-btn ${followLive ? 'active' : ''}`}
          onClick={() => {
            const next = !followLive
            setFollowLive(next)
          }}
          title="Follow live candle (double-click chart)"
        >
          ◉ Live
        </button>

        <button
          className={`toggle-btn ${mode === 'demo' ? 'active' : ''}`}
          onClick={() => setMode(mode === 'demo' ? 'live' : 'demo')}
        >
          {mode === 'demo' ? '▶ Switch to Live' : '◀ Switch to Demo'}
        </button>
      </div>
    </div>
  )
}
