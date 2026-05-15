import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtQty } from '../utils/formatters'
import { getSpreadInfo } from '../utils/bookValidation'

export default function DOMLite() {
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const symbol = useMarketStore(s => s.symbol)
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

  // Symbol-aware spread validation
  const spreadInfo = getSpreadInfo(bids, asks, symbol)
  const { spread, spreadPct, midPrice, sane: spreadSane, warning: spreadWarning, thresholds } = spreadInfo

  // Full book integrity check — must be sane AND not in warning range for normal display
  const bookValid = hasData && spreadSane && !spreadWarning

  // Book exists but has warning-level spread — show degraded state
  const bookWarning = hasData && spreadSane && spreadWarning

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
    ''

  return (
    <div className="dom-lite" style={showDimmed ? { opacity: 0.6 } : undefined}>
      <div className="dom-header">
        <span className="dom-title">Order Book{healthBadge}</span>
        <span className="dom-mid">{fmtPrice(midPrice)}</span>
      </div>

      {/* Source label — subtle, not alarming */}
      {sourceLabel && hasData && !spreadWarning && (
        <div style={{ padding: '2px 8px', fontSize: 9, color: orderBookSource === 'strict' ? '#2dd4a0' : '#4fc3f7', textAlign: 'center', fontFamily: 'monospace' }}>
          {sourceLabel}
        </div>
      )}

      {/* Spread warning — symbol-aware */}
      {hasData && !spreadSane && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#ef6461', textAlign: 'center', fontFamily: 'monospace' }}>
          Book integrity failed — spread {spreadPct.toFixed(4)}% (limit: {thresholds.invalid}%)
        </div>
      )}

      {/* Spread abnormal but not invalid — show degraded state */}
      {bookWarning && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          Spread {spreadPct.toFixed(4)}% — abnormal for {symbol} (warn: {thresholds.warn}%)
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

      {/* Show data if available and valid */}
      {hasData && (bookValid || bookWarning) && (
        <>
          <div className="dom-asks">
            {asks.slice(0, 10).reverse().map((a, i) => (
              <div key={i} className="dom-row ask">
                <span className="dom-qty">{fmtQty(a.qty)}</span>
                <div className="dom-bar ask" style={{ width: `${(a.qty / maxQty) * 100}%`, opacity: bookWarning ? 0.5 : 1 }} />
                <span className="dom-price">{fmtPrice(a.price)}</span>
              </div>
            ))}
          </div>

          <div className="dom-spread">
            <span style={spreadWarning ? { color: '#e4a73b' } : undefined}>
              Spread: {fmtPrice(spread)} ({spreadPct.toFixed(4)}%)
            </span>
          </div>

          <div className="dom-bids">
            {bids.slice(0, 10).map((b, i) => (
              <div key={i} className="dom-row bid">
                <span className="dom-price">{fmtPrice(b.price)}</span>
                <div className="dom-bar bid" style={{ width: `${(b.qty / maxQty) * 100}%`, opacity: bookWarning ? 0.5 : 1 }} />
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
