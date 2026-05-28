import { useMarketStore } from '../stores/marketStore'

export default function ConnectionStatus() {
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const tradeError = useMarketStore(s => s.tradeError)
  const connectionError = useMarketStore(s => s.connectionError)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)
  const orderBookError = useMarketStore(s => s.orderBookError)
  const resyncOrderBook = useMarketStore(s => s.resyncOrderBook)

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

  // Connection error from store (e.g. stale data warning)
  if (connectionError && !bookRealProblem && !tradeProblem) {
    return (
      <div className="conn-bar error">
        <span className="conn-bar-icon">⚠</span>
        <span className="conn-bar-text">{connectionError}</span>
        <span className="conn-bar-detail">
          ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} depth:{depthConnected?'✓':'✗'}
        </span>
      </div>
    )
  }

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
        <span className="conn-bar-text">Connecting to Binance Futures...</span>
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
        <span className="conn-bar-text">Connecting to Binance Futures...</span>
        <span className="conn-bar-detail">
          ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} depth:{depthConnected?'✓':'✗'}
        </span>
      </div>
    )
  }

  // Default: no bar
  return null
}
