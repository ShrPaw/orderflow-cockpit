import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtQty } from '../utils/formatters'
import { getSpreadInfo } from '../utils/bookValidation'

export default function DOMLite() {
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)
  const livePrice = useMarketStore(s => s.livePrice)

  const isHealthy = orderBookHealth === 'HEALTHY'
  const isTop20 = orderBookHealth === 'TOP20'
  const isDegraded = orderBookHealth === 'DEGRADED'
  const isUsable = isHealthy || isTop20 || isDegraded
  const isTransitional = orderBookHealth === 'CONNECTING'
    || orderBookHealth === 'BUFFERING'
    || orderBookHealth === 'SNAPSHOT_LOADING'
    || orderBookHealth === 'SYNCING'

  // During transitional states, if we have data from depth20, still show it
  const hasData = bids.length > 0 || asks.length > 0
  const showDimmed = (!isUsable && !isTransitional) || depthStale

  // Spread validation
  const spreadInfo = getSpreadInfo(bids, asks)
  const { spread, spreadPct, midPrice, sane: spreadSane } = spreadInfo

  // Full book integrity check
  const bookValid = hasData && spreadSane

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

  // Source label — honest but not scary
  const sourceLabel =
    orderBookSource === 'strict' ? 'STRICT DEPTH' :
    orderBookSource === 'depth20' ? 'LIVE TOP-20' :
    ''

  // Health badge — only show when something is actually wrong
  const healthBadge =
    orderBookHealth === 'STALE' ? ' ⚠STALE' :
    orderBookHealth === 'ERROR' ? ' ❌ERROR' :
    '' // HEALTHY, TOP20, DEGRADED, transitional → no badge

  return (
    <div className="dom-lite" style={showDimmed ? { opacity: 0.6 } : undefined}>
      <div className="dom-header">
        <span className="dom-title">Order Book{healthBadge}</span>
        <span className="dom-mid">{fmtPrice(midPrice)}</span>
      </div>

      {/* Source label — subtle, not alarming */}
      {sourceLabel && hasData && (
        <div style={{ padding: '2px 8px', fontSize: 9, color: orderBookSource === 'strict' ? '#2dd4a0' : '#4fc3f7', textAlign: 'center', fontFamily: 'monospace' }}>
          {sourceLabel}
        </div>
      )}

      {/* Spread warning — only when genuinely invalid */}
      {hasData && !spreadSane && (
        <div style={{ padding: '2px 8px', fontSize: 9, color: '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          Book integrity check failed — spread {spreadPct.toFixed(3)}%
        </div>
      )}

      {/* Warning for non-usable states without data */}
      {!hasData && isTransitional && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#4fc3f7', textAlign: 'center', fontFamily: 'monospace' }}>
          Book initializing...
        </div>
      )}

      {!hasData && !isTransitional && !isUsable && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          Book unavailable — reconnecting
        </div>
      )}

      {/* Show data if available */}
      {hasData && bookValid && (
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
            <span>Spread: {fmtPrice(spread)} ({spreadPct.toFixed(3)}%)</span>
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
