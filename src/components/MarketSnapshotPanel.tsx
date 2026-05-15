import { useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { computeMarketSnapshot } from '../utils/marketSnapshot'
import { fmtPrice, fmtNum, fmtPct } from '../utils/formatters'

export default function MarketSnapshotPanel() {
  const livePrice = useMarketStore(s => s.livePrice)
  const ticker = useMarketStore(s => s.ticker)
  const recentTrades = useMarketStore(s => s.recentTrades)
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const symbol = useMarketStore(s => s.symbol)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)
  const connected = useMarketStore(s => s.connected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const depthConnected = useMarketStore(s => s.depthConnected)
  const lastTradeTime = useMarketStore(s => s.lastTradeTime)
  const depthStale = useMarketStore(s => s.depthStale)

  const snap = useMemo(() => computeMarketSnapshot({
    livePrice,
    ticker,
    recentTrades,
    bids,
    asks,
    symbol,
    orderBookHealth,
    orderBookSource,
    connected,
    tickerConnected,
    depthConnected,
    lastTradeTime,
    depthStale,
  }), [livePrice, ticker, recentTrades, bids, asks, symbol, orderBookHealth, orderBookSource,
       connected, tickerConnected, depthConnected, lastTradeTime, depthStale])

  const priceColor = snap.change24h >= 0 ? 'green' : 'red'
  const book = snap.bookDisplay

  return (
    <div className="panel-section">
      <div className="panel-title">Market Snapshot</div>

      {/* Price context */}
      <div className="stat-row">
        <span className="label">Price</span>
        <span className={`value ${priceColor}`}>{fmtPrice(snap.price)}</span>
      </div>
      <div className="stat-row">
        <span className="label">24h Change</span>
        <span className={`value ${priceColor}`}>{fmtPct(snap.changePct24h)}</span>
      </div>
      <div className="stat-row">
        <span className="label">Session H/L</span>
        <span className="value" style={{ fontSize: 10 }}>
          {fmtPrice(snap.sessionHigh)} / {fmtPrice(snap.sessionLow)}
        </span>
      </div>
      {snap.rangePosition !== null && (
        <div className="stat-row">
          <span className="label">Range Position</span>
          <span className="value">{snap.rangePosition.toFixed(0)}%</span>
        </div>
      )}

      {/* Book context — uses shared BookDisplayState */}
      <div className="snapshot-divider" />
      <div className="stat-row">
        <span className="label">Book Source</span>
        <span className="value" style={{
          color: book.status === 'STRICT_DEPTH' ? '#2dd4a0'
            : book.status === 'LIVE_TOP20' ? '#4fc3f7'
            : book.status === 'INVALID' ? '#ef6461'
            : '#6b7d96',
          fontSize: 10,
          fontFamily: 'monospace',
        }}>
          {book.sourceLabel}
        </span>
      </div>

      {book.canShowBookMetrics ? (
        <>
          <div className="stat-row">
            <span className="label">Spread</span>
            <span className="value">{fmtPrice(book.spread)} ({book.spreadPct.toFixed(4)}%)</span>
          </div>
          <div className="stat-row">
            <span className="label">Book Imbalance</span>
            <span className={`value ${book.spread > 0 ? (bids.reduce((s,b)=>s+b.qty,0) > asks.reduce((s,a)=>s+a.qty,0) ? 'green' : 'red') : ''}`}>
              {(() => {
                const bidTotal = bids.reduce((s, b) => s + b.qty, 0)
                const askTotal = asks.reduce((s, a) => s + a.qty, 0)
                if (bidTotal + askTotal === 0) return '—'
                const imb = ((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
                return `${imb > 0 ? '+' : ''}${imb.toFixed(1)}% ${imb > 15 ? 'Bid heavy' : imb < -15 ? 'Ask heavy' : 'Balanced'}`
              })()}
            </span>
          </div>
          <div className="stat-row">
            <span className="label">Top Bid / Ask</span>
            <span className="value" style={{ fontSize: 10 }}>
              {(bids[0]?.qty ?? 0) > 0 ? bids[0]!.qty.toFixed(4) : '—'} / {(asks[0]?.qty ?? 0) > 0 ? asks[0]!.qty.toFixed(4) : '—'}
            </span>
          </div>
        </>
      ) : (
        <div className="stat-row">
          <span className="label" style={{ color: book.status === 'INVALID' ? '#ef6461' : '#6b7d96', fontSize: 10, fontStyle: 'italic' }}>
            {book.invalidReason ?? 'Book data pending'}
          </span>
        </div>
      )}

      {/* Flow context */}
      <div className="snapshot-divider" />
      <div className="stat-row">
        <span className="label">Buy Pressure (60s)</span>
        <span className="value green">${fmtNum(snap.buyPressure)}</span>
      </div>
      <div className="stat-row">
        <span className="label">Sell Pressure (60s)</span>
        <span className="value red">${fmtNum(snap.sellPressure)}</span>
      </div>
      <div className="stat-row">
        <span className="label">Net Flow</span>
        <span className={`value ${snap.netFlow >= 0 ? 'green' : 'red'}`}>
          {snap.netFlow >= 0 ? '+' : ''}${fmtNum(snap.netFlow)}
        </span>
      </div>
      {snap.lastLargePrint && (
        <div className="stat-row">
          <span className="label">Last Large Print</span>
          <span className={`value ${snap.lastLargePrint.side === 'buy' ? 'green' : 'red'}`} style={{ fontSize: 10 }}>
            ${fmtNum(snap.lastLargePrint.notional)} {snap.lastLargePrint.side}
            {' @ '}{fmtPrice(snap.lastLargePrint.price)}
            {' '}({fmtTimeAgo(snap.lastLargePrint.timeAgo)})
          </span>
        </div>
      )}

      {/* Health context */}
      <div className="snapshot-divider" />
      <div className="snapshot-health">
        <span className={`health-dot ${snap.tickerOk ? 'ok' : 'fail'}`} title="Ticker" />
        <span className={`health-dot ${snap.tradesOk ? 'ok' : 'fail'}`} title="Trades" />
        <span className={`health-dot ${book.valid ? 'ok' : 'fail'}`} title="Order Book" />
        {snap.staleWarning && (
          <span className="health-warning">{snap.staleWarning}</span>
        )}
      </div>
    </div>
  )
}

function fmtTimeAgo(ms: number): string {
  if (ms < 1_000) return 'just now'
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`
  return `${Math.floor(ms / 60_000)}m ago`
}
