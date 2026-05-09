import { useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { fmtNum, fmtPrice } from '../utils/formatters'

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

  const accepted = bubbles.filter(b => b.state === 'ACCEPTED').length
  const rejected = bubbles.filter(b => b.state === 'REJECTED').length
  const absorbed = bubbles.filter(b => b.state === 'ABSORBED').length
  const pending = bubbles.filter(b => b.state === 'PENDING').length
  const exhausted = bubbles.filter(b => b.state === 'EXHAUSTED').length

  const candle = currentCandle

  const footprintEntries = useMemo(() => {
    if (!candle) return []
    return Object.entries(candle.priceMap)
      .map(([p, l]) => ({ price: parseFloat(p), ...l }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [candle])

  const vwap = useMemo(() => {
    if (!candle || candle.volume === 0) return null
    // Simple VWAP approximation from priceMap
    let num = 0, den = 0
    for (const [p, l] of Object.entries(candle.priceMap)) {
      const price = parseFloat(p)
      num += price * l.total
      den += l.total
    }
    return den > 0 ? num / den : null
  }, [candle])

  return (
    <div className="side-panel">
      {/* Delta / CVD */}
      <div className="panel-section">
        <div className="panel-title">Delta & CVD</div>
        <div className="stat-row">
          <span className="label">Delta</span>
          <span className={`value ${delta >= 0 ? 'green' : 'red'}`}>
            {delta >= 0 ? '+' : ''}{fmtNum(delta)}
          </span>
        </div>
        <div className="stat-row">
          <span className="label">CVD</span>
          <span className={`value ${cvd >= 0 ? 'green' : 'red'}`}>
            {cvd >= 0 ? '+' : ''}{fmtNum(cvd)}
          </span>
        </div>
        <div className="volume-bar">
          <div className="buy-bar" style={{ width: `${buyPct}%` }} />
          <div className="sell-bar" style={{ width: `${100 - buyPct}%` }} />
        </div>
        <div className="stat-row small">
          <span>Buy {fmtNum(buyVolume)}</span>
          <span>Sell {fmtNum(sellVolume)}</span>
        </div>
      </div>

      {/* Volume & Activity */}
      <div className="panel-section">
        <div className="panel-title">Volume & Activity</div>
        <div className="stat-row">
          <span className="label">Total Volume</span>
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
            <div className="stat-row">
              <span className="label">Large Prints</span>
              <span className="value yellow">{candle.largeTradeCount}</span>
            </div>
          </>
        )}
        {vwap !== null && (
          <div className="stat-row">
            <span className="label">VWAP</span>
            <span className="value purple">{fmtPrice(vwap)}</span>
          </div>
        )}
      </div>

      {/* Bubble State Machine */}
      <div className="panel-section">
        <div className="panel-title">Bubble States</div>
        <div className="bubble-legend">
          <span className="legend-item"><span className="dot yellow" /> Pending — large trade, waiting for response</span>
          <span className="legend-item"><span className="dot green" /> Accepted — price followed the trade</span>
          <span className="legend-item"><span className="dot red" /> Rejected — price moved against it</span>
          <span className="legend-item"><span className="dot cyan" /> Absorbed — price barely moved</span>
          <span className="legend-item"><span className="dot gray" /> Exhausted — no meaningful response</span>
        </div>
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
        <div className="stat-row">
          <span className="label">Exhausted</span>
          <span className="value" style={{ color: '#4a5e78' }}>{exhausted}</span>
        </div>
      </div>

      {/* Large Trades */}
      <div className="panel-section">
        <div className="panel-title">Large Trades</div>
        <div className="trade-list">
          {largeTrades.slice(0, 8).map(t => (
            <div key={t.id} className={`trade-row ${t.side}`}>
              <span className="trade-price">{fmtPrice(t.price)}</span>
              <span className="trade-qty">{t.qty.toFixed(4)}</span>
              <span className="trade-notional">${fmtNum(t.notional)}</span>
            </div>
          ))}
          {largeTrades.length === 0 && <div className="empty">No large trades yet</div>}
        </div>
      </div>

      {/* Top Footprint Levels */}
      <div className="panel-section">
        <div className="panel-title">Top Footprint</div>
        {footprintEntries.map(l => (
          <div key={l.price} className="fp-row">
            <span className="fp-price">{fmtPrice(l.price)}</span>
            <div className="fp-bar-wrap">
              <div
                className="fp-buy"
                style={{ width: `${l.total > 0 ? (l.buy / l.total) * 100 : 50}%` }}
              />
              <div
                className="fp-sell"
                style={{ width: `${l.total > 0 ? (l.sell / l.total) * 100 : 50}%` }}
              />
            </div>
            <span className="fp-total">{fmtNum(l.total)}</span>
          </div>
        ))}
        {footprintEntries.length === 0 && <div className="empty">No footprint data</div>}
      </div>
    </div>
  )
}
