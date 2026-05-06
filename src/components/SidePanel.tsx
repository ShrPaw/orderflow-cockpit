import { useMarketStore } from '../stores/marketStore'
import { fmtNum, fmtPrice, fmtPct } from '../utils/formatters'

export default function SidePanel() {
  const delta = useMarketStore(s => s.delta)
  const cvd = useMarketStore(s => s.cvd)
  const totalVolume = useMarketStore(s => s.totalVolume)
  const buyVolume = useMarketStore(s => s.buyVolume)
  const sellVolume = useMarketStore(s => s.sellVolume)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const largeTrades = useMarketStore(s => s.largeTrades)
  const bubbles = useMarketStore(s => s.bubbles)

  const buyPct = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50
  const sellPct = 100 - buyPct

  const accepted = bubbles.filter(b => b.state === 'ACCEPTED').length
  const rejected = bubbles.filter(b => b.state === 'REJECTED').length
  const absorbed = bubbles.filter(b => b.state === 'ABSORBED').length
  const pending = bubbles.filter(b => b.state === 'PENDING').length

  const candle = currentCandle
  const footprintEntries = candle
    ? Object.entries(candle.priceMap)
        .map(([p, l]) => ({ price: parseFloat(p), ...l }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8)
    : []

  return (
    <div className="side-panel">
      <div className="panel-section">
        <div className="panel-title">Delta / CVD</div>
        <div className="stat-row">
          <span className="label">Delta</span>
          <span className={`value ${delta >= 0 ? 'green' : 'red'}`}>{fmtNum(delta)}</span>
        </div>
        <div className="stat-row">
          <span className="label">CVD</span>
          <span className={`value ${cvd >= 0 ? 'green' : 'red'}`}>{fmtNum(cvd)}</span>
        </div>
        <div className="volume-bar">
          <div className="buy-bar" style={{ width: `${buyPct}%` }} />
          <div className="sell-bar" style={{ width: `${sellPct}%` }} />
        </div>
        <div className="stat-row small">
          <span>Buy {fmtNum(buyVolume)}</span>
          <span>Sell {fmtNum(sellVolume)}</span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Volume</div>
        <div className="stat-row">
          <span className="label">Total</span>
          <span className="value">{fmtNum(totalVolume)}</span>
        </div>
        {candle && (
          <>
            <div className="stat-row">
              <span className="label">Candle Vol</span>
              <span className="value">{fmtNum(candle.volume)}</span>
            </div>
            <div className="stat-row">
              <span className="label">Trades</span>
              <span className="value">{candle.tradeCount}</span>
            </div>
          </>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-title">Bubbles</div>
        <div className="stat-row">
          <span className="label">Pending</span>
          <span className="value yellow">{pending}</span>
        </div>
        <div className="stat-row">
          <span className="label">Accepted</span>
          <span className="value green">{accepted}</span>
        </div>
        <div className="stat-row">
          <span className="label">Rejected</span>
          <span className="value red">{rejected}</span>
        </div>
        <div className="stat-row">
          <span className="label">Absorbed</span>
          <span className="value cyan">{absorbed}</span>
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Large Trades</div>
        <div className="trade-list">
          {largeTrades.slice(0, 10).map(t => (
            <div key={t.id} className={`trade-row ${t.side}`}>
              <span className="trade-price">{fmtPrice(t.price)}</span>
              <span className="trade-qty">{t.qty.toFixed(4)}</span>
              <span className="trade-notional">${fmtNum(t.notional)}</span>
            </div>
          ))}
          {largeTrades.length === 0 && <div className="empty">No large trades yet</div>}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-title">Top Footprint Levels</div>
        {footprintEntries.map(l => (
          <div key={l.price} className="fp-row">
            <span className="fp-price">{fmtPrice(l.price)}</span>
            <div className="fp-bar-wrap">
              <div className="fp-buy" style={{ width: `${l.total > 0 ? (l.buy / l.total) * 100 : 50}%` }} />
              <div className="fp-sell" style={{ width: `${l.total > 0 ? (l.sell / l.total) * 100 : 50}%` }} />
            </div>
            <span className="fp-total">{fmtNum(l.total)}</span>
          </div>
        ))}
        {footprintEntries.length === 0 && <div className="empty">No footprint data</div>}
      </div>
    </div>
  )
}
