import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtQty } from '../utils/formatters'
import { getBookDisplayState } from '../utils/bookValidation'

export default function DOMLite() {
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const symbol = useMarketStore(s => s.symbol)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)

  // Single source of truth for book display state
  const book = getBookDisplayState({
    bids,
    asks,
    symbol,
    orderBookSource,
    orderBookHealth,
    depthStale,
  })

  const hasData = bids.length > 0 || asks.length > 0
  const isTransitional = orderBookHealth === 'CONNECTING'
    || orderBookHealth === 'BUFFERING'
    || orderBookHealth === 'SNAPSHOT_LOADING'
    || orderBookHealth === 'SYNCING'

  const showDimmed = !book.valid || book.warning

  const maxQty = Math.max(
    1,
    ...bids.slice(0, 10).map(b => b.qty),
    ...asks.slice(0, 10).map(a => a.qty)
  )

  const bidTotal = bids.slice(0, 10).reduce((s, b) => s + b.qty, 0)
  const askTotal = asks.slice(0, 10).reduce((s, a) => s + a.qty, 0)
  const imbalance = bidTotal + askTotal > 0
    ? ((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
    : 0

  return (
    <div className="dom-lite" style={showDimmed ? { opacity: 0.6 } : undefined}>
      <div className="dom-header">
        <span className="dom-title">Order Book</span>
        <span className="dom-mid">{hasData ? fmtPrice(book.midPrice) : '—'}</span>
      </div>

      {/* Source label — only when book is valid */}
      {book.canShowBookMetrics && (
        <div style={{ padding: '2px 8px', fontSize: 9, color: book.status === 'STRICT_DEPTH' ? '#2dd4a0' : '#4fc3f7', textAlign: 'center', fontFamily: 'monospace' }}>
          {book.sourceLabel}
        </div>
      )}

      {/* Invalid book — show compact warning, not levels */}
      {hasData && book.status === 'INVALID' && (
        <div style={{ padding: '6px 8px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#ef6461', fontWeight: 600, marginBottom: 4 }}>
            Book integrity check failed
          </div>
          <div style={{ fontSize: 9, color: '#6b7d96', fontFamily: 'monospace' }}>
            Spread {book.spreadPct.toFixed(4)}% exceeds {symbol} limit {book.thresholds.invalid}%
          </div>
        </div>
      )}

      {/* Warning spread — show degraded state */}
      {hasData && book.warning && book.status !== 'INVALID' && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          {book.invalidReason}
        </div>
      )}

      {/* Transitional state */}
      {!hasData && isTransitional && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#4fc3f7', textAlign: 'center', fontFamily: 'monospace' }}>
          Book initializing...
        </div>
      )}

      {!hasData && !isTransitional && !book.valid && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          Book unavailable — reconnecting
        </div>
      )}

      {/* Show levels only when book is valid */}
      {hasData && book.canShowBookMetrics && (
        <>
          <div className="dom-asks">
            {asks.slice(0, 10).reverse().map((a, i) => (
              <div key={i} className="dom-row ask">
                <span className="dom-qty">{fmtQty(a.qty)}</span>
                <div className="dom-bar ask" style={{ width: `${(a.qty / maxQty) * 100}%` }} />
                <span className="dom-price">{fmtPrice(a.price)}</span>
              </div>
            ))}
          </div>

          <div className="dom-spread">
            <span>Spread: {fmtPrice(book.spread)} ({book.spreadPct.toFixed(4)}%)</span>
          </div>

          <div className="dom-bids">
            {bids.slice(0, 10).map((b, i) => (
              <div key={i} className="dom-row bid">
                <span className="dom-price">{fmtPrice(b.price)}</span>
                <div className="dom-bar bid" style={{ width: `${(b.qty / maxQty) * 100}%` }} />
                <span className="dom-qty">{fmtQty(b.qty)}</span>
              </div>
            ))}
          </div>

          <div className="dom-imbalance">
            <span className={imbalance > 0 ? 'green' : imbalance < 0 ? 'red' : ''}>
              {imbalance > 0 ? '▲' : imbalance < 0 ? '▼' : '—'} {Math.abs(imbalance).toFixed(1)}%
            </span>
            <span className="dom-side-hint">
              {imbalance > 15 ? 'Bid heavy' : imbalance < -15 ? 'Ask heavy' : 'Balanced'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
