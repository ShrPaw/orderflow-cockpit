import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtNum } from '../utils/formatters'

export default function DOMLite() {
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)

  const isHealthy = orderBookHealth === 'HEALTHY'
  const isDegraded = orderBookHealth === 'DEGRADED'
  const isUsable = isHealthy || isDegraded
  const showWarning = !isUsable || depthStale

  const bestBid = bids[0]?.price ?? 0
  const bestAsk = asks[0]?.price ?? 0
  const spread = bestAsk - bestBid
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0
  const midPrice = (bestBid + bestAsk) / 2

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

  const healthLabel =
    orderBookHealth === 'HEALTHY' ? '' :
    orderBookHealth === 'DEGRADED' ? ' 📉DEGRADED' :
    orderBookHealth === 'CONNECTING' ? ' ⏳CONNECTING' :
    orderBookHealth === 'BUFFERING' ? ' ⏳BUFFERING' :
    orderBookHealth === 'SNAPSHOT_LOADING' ? ' ⏳SNAPSHOT' :
    orderBookHealth === 'SYNCING' ? ' ⏳SYNCING' :
    orderBookHealth === 'RESYNCING' ? ' 🔄RESYNCING' :
    orderBookHealth === 'STALE' ? ' ⚠STALE' :
    orderBookHealth === 'ERROR' ? ' ❌ERROR' :
    ' ⚠DISCONNECTED'

  return (
    <div className="dom-lite" style={showWarning ? { opacity: 0.6 } : undefined}>
      <div className="dom-header">
        <span className="dom-title">Order Book{healthLabel}</span>
        <span className="dom-mid">{fmtPrice(midPrice)}</span>
      </div>

      {showWarning && (
        <div style={{ padding: '4px 8px', fontSize: 9, color: isDegraded ? '#ef6461' : '#e4a73b', textAlign: 'center', fontFamily: 'monospace' }}>
          {isDegraded
            ? 'DEGRADED TOP-20 BOOK — strict sync unavailable'
            : !isUsable
              ? 'Liquidity overlays paused — book not synchronized'
              : 'Depth data stale — resyncing…'}
        </div>
      )}

      <div className="dom-asks">
        {asks.slice(0, 10).reverse().map((a, i) => (
          <div key={i} className="dom-row ask">
            <span className="dom-qty">{fmtNum(a.qty)}</span>
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
            <span className="dom-qty">{fmtNum(b.qty)}</span>
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
    </div>
  )
}
