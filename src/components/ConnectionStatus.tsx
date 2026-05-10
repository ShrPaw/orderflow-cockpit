import { useMarketStore } from '../stores/marketStore'

export default function ConnectionStatus() {
  const mode = useMarketStore(s => s.mode)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const depthStale = useMarketStore(s => s.depthStale)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const connectionError = useMarketStore(s => s.connectionError)
  const setMode = useMarketStore(s => s.setMode)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookError = useMarketStore(s => s.orderBookError)
  const resyncOrderBook = useMarketStore(s => s.resyncOrderBook)

  if (mode === 'live') {
    const allConnected = connected && depthConnected && tickerConnected
    const bookHealthy = orderBookHealth === 'HEALTHY'
    const bookProblem = orderBookHealth === 'STALE' || orderBookHealth === 'ERROR' || orderBookHealth === 'RESYNCING'

    if (connectionError) {
      return (
        <div className="conn-bar error">
          <span className="conn-bar-icon">⚠</span>
          <span className="conn-bar-text">{connectionError}</span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
          </span>
          <button className="conn-bar-action" onClick={() => {
            if (bookProblem) resyncOrderBook()
            else {
              setMode('demo')
              setTimeout(() => setMode('live'), 100)
            }
          }}>Reconnect</button>
        </div>
      )
    }
    if (bookProblem) {
      return (
        <div className="conn-bar error" style={{ background: 'rgba(228,167,59,0.12)', borderColor: 'rgba(228,167,59,0.3)' }}>
          <span className="conn-bar-icon">⏳</span>
          <span className="conn-bar-text">Order book {orderBookHealth.toLowerCase()} — liquidity overlays paused{orderBookError ? `: ${orderBookError}` : ''}</span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
          </span>
          <button className="conn-bar-action" onClick={() => resyncOrderBook()}>Resync</button>
        </div>
      )
    }
    if (!allConnected) {
      return (
        <div className="conn-bar connecting">
          <span className="conn-bar-spinner" />
          <span className="conn-bar-text">Connecting to Binance Futures...</span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
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
