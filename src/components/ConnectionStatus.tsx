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

    // depth20 is providing valid live data — this is NORMAL, not degraded
    const bookLiveTop20 = orderBookHealth === 'TOP20' || orderBookHealth === 'DEGRADED'

    // Strict sync is in progress but depth20 is handling display
    const bookTransitional = orderBookHealth === 'SNAPSHOT_LOADING'
      || orderBookHealth === 'SYNCING'
      || orderBookHealth === 'BUFFERING'
      || orderBookHealth === 'RESYNCING'
      || orderBookHealth === 'CONNECTING'

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

    // Priority 3: All good — ticker, trades, and display book are live
    // depth20 as display source is perfectly normal and stable.
    // No warning bar needed.
    if (bookLiveTop20 && connected && tickerConnected) {
      return null
    }

    // Priority 4: Strict book is healthy — even better
    if (orderBookHealth === 'HEALTHY' && connected && tickerConnected) {
      return null
    }

    // Priority 5: Transitional — strict sync in progress, depth20 may not be ready yet
    if (bookTransitional && !bookLiveTop20) {
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

    // Priority 6: Still connecting streams
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

    // Default: no bar
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
