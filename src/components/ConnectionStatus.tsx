import { useMarketStore } from '../stores/marketStore'

export default function ConnectionStatus() {
  const mode = useMarketStore(s => s.mode)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const connectionError = useMarketStore(s => s.connectionError)
  const setMode = useMarketStore(s => s.setMode)

  if (mode === 'live') {
    const allConnected = connected && depthConnected && tickerConnected

    if (connectionError) {
      return (
        <div className="conn-bar error">
          <span className="conn-bar-icon">⚠</span>
          <span className="conn-bar-text">{connectionError}</span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} depth:{depthConnected?'✓':'✗'}
          </span>
          <button className="conn-bar-action" onClick={() => {
            setMode('demo')
            setTimeout(() => setMode('live'), 100)
          }}>Reconnect</button>
        </div>
      )
    }
    if (!allConnected) {
      return (
        <div className="conn-bar connecting">
          <span className="conn-bar-spinner" />
          <span className="conn-bar-text">Connecting to Binance Futures...</span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} depth:{depthConnected?'✓':'✗'}
          </span>
        </div>
      )
    }
    return null
  }

  return (
    <div className="conn-bar demo">
      <span className="conn-bar-icon">◉</span>
      <span className="conn-bar-text">DEMO MODE — Simulated market data for testing</span>
      <button className="conn-bar-action" onClick={() => setMode('live')}>
        Switch to Live
      </button>
    </div>
  )
}
