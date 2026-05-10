import { useMarketStore } from '../stores/marketStore'

export default function ConnectionStatus() {
  const mode = useMarketStore(s => s.mode)
  const connected = useMarketStore(s => s.connected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const tradeError = useMarketStore(s => s.tradeError)
  const tickerError = useMarketStore(s => s.tickerError)
  const setMode = useMarketStore(s => s.setMode)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)
  const orderBookError = useMarketStore(s => s.orderBookError)
  const resyncOrderBook = useMarketStore(s => s.resyncOrderBook)

  if (mode === 'live') {
    const allConnected = connected && depthConnected && tickerConnected
    const bookProblem = orderBookHealth !== 'HEALTHY' && orderBookHealth !== 'TOP20' && orderBookHealth !== 'DISCONNECTED'
    const tradeProblem = !connected || !!tradeError

    // Priority 1: Trade stream issues (separate from book)
    if (tradeProblem && !bookProblem) {
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

    // Priority 2: Book issues
    if (bookProblem) {
      const isDegraded = orderBookHealth === 'DEGRADED'
      const isResyncing = orderBookHealth === 'RESYNCING'
      const isSnapshot = orderBookHealth === 'SNAPSHOT_LOADING' || orderBookHealth === 'SYNCING'
      const isStale = orderBookHealth === 'STALE'

      let bookMsg: string
      if (isDegraded) {
        bookMsg = 'Book using top-20 fallback \u2014 strict sync retrying'
      } else if (isResyncing) {
        bookMsg = 'Strict book syncing in background \u2014 top-20 book active'
      } else if (isSnapshot) {
        bookMsg = 'Strict book syncing in background \u2014 top-20 book active'
      } else if (isStale) {
        bookMsg = 'Order book STALE \u2014 no recent updates'
      } else {
        bookMsg = `Order book ${orderBookHealth.toLowerCase()}`
      }
      if (orderBookError) bookMsg += `: ${orderBookError}`

      const tradeStatus = tradeProblem
        ? ` | trades: ${tradeError || 'disconnected'}`
        : ''

      return (
        <div className="conn-bar error" style={{
          background: isDegraded ? 'rgba(228,100,59,0.12)' : 'rgba(228,167,59,0.12)',
          borderColor: isDegraded ? 'rgba(228,100,59,0.3)' : 'rgba(228,167,59,0.3)',
        }}>
          <span className="conn-bar-icon">{isDegraded ? '📉' : isResyncing ? '🔄' : '⏳'}</span>
          <span className="conn-bar-text">{bookMsg}{tradeStatus}</span>
          <span className="conn-bar-detail">
            source:{orderBookSource} ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
          </span>
          <button className="conn-bar-action" onClick={() => resyncOrderBook()}>Resync Book</button>
        </div>
      )
    }

    // Priority 3: Both trade + book problems
    if (tradeProblem && bookProblem) {
      return (
        <div className="conn-bar error">
          <span className="conn-bar-icon">⚠</span>
          <span className="conn-bar-text">
            Multiple streams: {tradeError || 'trade issue'} · book:{orderBookHealth}
          </span>
          <span className="conn-bar-detail">
            source:{orderBookSource} ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'} book:{orderBookHealth}
          </span>
          <button className="conn-bar-action" onClick={() => {
            resyncOrderBook()
            setMode('demo')
            setTimeout(() => setMode('live'), 100)
          }}>Reconnect All</button>
        </div>
      )
    }

    // Priority 4: TOP20 active (depth20 providing book, strict not yet healthy)
    if (orderBookHealth === 'TOP20') {
      return (
        <div className="conn-bar connecting" style={{
          background: 'rgba(79,195,247,0.08)',
          borderColor: 'rgba(79,195,247,0.2)',
        }}>
          <span className="conn-bar-spinner" />
          <span className="conn-bar-text">Book using top-20 fallback \u2014 strict sync loading</span>
          <span className="conn-bar-detail">
            source:{orderBookSource} ticker:{tickerConnected?'✓':'✗'} trades:{connected?'✓':'✗'}
          </span>
        </div>
      )
    }

    // Priority 5: Still connecting
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
      <span className="conn-bar-text">DEMO MODE \u2014 Simulated market data for testing</span>
      <button className="conn-bar-action" onClick={() => setMode('live')}>
        Switch to Live
      </button>
    </div>
  )
}
