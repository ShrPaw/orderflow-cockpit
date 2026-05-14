import { useMarketStore } from '../stores/marketStore'

export default function ConnectionStatus() {
  const mode = useMarketStore(s => s.mode)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const tradeError = useMarketStore(s => s.tradeError)
  const setMode = useMarketStore(s => s.setMode)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)
  const orderBookError = useMarketStore(s => s.orderBookError)
  const resyncOrderBook = useMarketStore(s => s.resyncOrderBook)

  if (mode === 'live') {
    const tradeProblem = !connected || !!tradeError
    const bookRealProblem = orderBookHealth === 'STALE' || orderBookHealth === 'ERROR'
    const bookDegraded = orderBookHealth === 'DEGRADED'
    // Transitional states — strict sync in progress, depth20 providing data
    const bookTransitional = orderBookHealth === 'SNAPSHOT_LOADING'
      || orderBookHealth === 'SYNCING'
      || orderBookHealth === 'BUFFERING'
      || orderBookHealth === 'RESYNCING'

    // Priority 1: Real book problems (STALE / ERROR)
    if (bookRealProblem) {
      return (
        <div className="conn-bar error">
          <span className="conn-bar-icon">⚠</span>
          <span className="conn-bar-text">
            {orderBookError || `Order book ${orderBookHealth.toLowerCase()}`}
          </span>
          <span className="conn-bar-detail">
            source:{orderBookSource} ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'}
          </span>
          <button className="conn-bar-action" onClick={() => resyncOrderBook()}>Resync Book</button>
        </div>
      )
    }

    // Priority 2: Trade stream down
    if (tradeProblem) {
      return (
        <div className="conn-bar error">
          <span className="conn-bar-icon">⚠</span>
          <span className="conn-bar-text">
            {tradeError || 'Trade stream disconnected'}
          </span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
          </span>
          <button className="conn-bar-action" onClick={() => {
            setMode('demo')
            setTimeout(() => setMode('live'), 100)
          }}>Reconnect</button>
        </div>
      )
    }

    // Priority 3: DEGRADED — strict sync failed, using depth20 fallback
    // This is an honest warning, not a crisis — the book still works.
    if (bookDegraded) {
      return (
        <div className="conn-bar connecting" style={{
          background: 'rgba(228,167,59,0.08)',
          borderColor: 'rgba(228,167,59,0.2)',
        }}>
          <span className="conn-bar-icon">↻</span>
          <span className="conn-bar-text">Order book using top-20 fallback — strict sync retrying</span>
          <span className="conn-bar-detail">
            source:{orderBookSource} ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'}
          </span>
          <button className="conn-bar-action" onClick={() => resyncOrderBook()}>Resync</button>
        </div>
      )
    }

    // Priority 4: Transitional states — strict sync in progress
    // depth20 is providing live data, so this is NOT an error.
    // Show as a subtle loading indicator, not a scary warning.
    if (bookTransitional) {
      return (
        <div className="conn-bar connecting">
          <span className="conn-bar-spinner" />
          <span className="conn-bar-text">Order book loading…</span>
          <span className="conn-bar-detail">
            source:{orderBookSource} ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'}
          </span>
        </div>
      )
    }

    // Priority 5: Still connecting streams
    if (!connected || !depthConnected || !tickerConnected) {
      return (
        <div className="conn-bar connecting">
          <span className="conn-bar-spinner" />
          <span className="conn-bar-text">Connecting to Binance Futures…</span>
          <span className="conn-bar-detail">
            ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
          </span>
        </div>
      )
    }

    // All good — no bar
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
