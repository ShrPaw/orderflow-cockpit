import { useMarketStore } from '../stores/marketStore'

export default function ConnectionStatus() {
  const mode = useMarketStore(s => s.mode)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const tradeError = useMarketStore(s => s.tradeError)
  const depthError = useMarketStore(s => s.depthError)
  const tickerError = useMarketStore(s => s.tickerError)
  const setMode = useMarketStore(s => s.setMode)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookError = useMarketStore(s => s.orderBookError)
  const resyncOrderBook = useMarketStore(s => s.resyncOrderBook)

  // Derive combined error from per-stream errors
  const errors: string[] = []
  if (tradeError) errors.push(tradeError)
  if (depthError) errors.push(depthError)
  if (tickerError) errors.push(tickerError)
  const connectionError = errors.length > 0 ? errors.join(' · ') : null

  if (mode === 'live') {
    const allConnected = connected && depthConnected && tickerConnected
    const bookProblem = orderBookHealth === 'STALE' || orderBookHealth === 'ERROR' || orderBookHealth === 'RESYNCING' || orderBookHealth === 'DEGRADED'

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
      const isDegraded = orderBookHealth === 'DEGRADED'
      const isResyncing = orderBookHealth === 'RESYNCING'
      return (
        <div className="conn-bar error" style={{
          background: isDegraded ? 'rgba(228,100,59,0.12)' : 'rgba(228,167,59,0.12)',
          borderColor: isDegraded ? 'rgba(228,100,59,0.3)' : 'rgba(228,167,59,0.3)',
        }}>
          <span className="conn-bar-icon">{isDegraded ? '📉' : isResyncing ? '🔄' : '⏳'}</span>
          <span className="conn-bar-text">
            {isDegraded
              ? 'DEGRADED — using top-20 fallback book'
              : isResyncing
                ? 'RESYNCING — showing last known book'
                : `Order book ${orderBookHealth.toLowerCase()}`}
            {orderBookError ? `: ${orderBookError}` : ''}
          </span>
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
