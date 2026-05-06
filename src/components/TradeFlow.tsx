import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtNum } from '../utils/formatters'

export default function TradeFlow() {
  const recentTrades = useMarketStore(s => s.recentTrades)

  return (
    <div className="trade-flow">
      <div className="trade-flow-header">Time & Sales</div>
      <div className="trade-flow-list">
        {recentTrades.slice(0, 50).map(t => {
          const isLarge = t.notional > 5000
          const isWhale = t.notional > 50000
          const fontSize = isWhale ? 13 : isLarge ? 12 : 11
          return (
            <div
              key={t.id}
              className={`tf-row ${t.side} ${isLarge ? 'large' : ''} ${isWhale ? 'whale' : ''}`}
              style={{ fontSize }}
            >
              <span className="tf-time">
                {new Date(t.time).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <span className="tf-price">{fmtPrice(t.price)}</span>
              <span className="tf-qty">{t.qty.toFixed(4)}</span>
              <span className="tf-notional">${fmtNum(t.notional)}</span>
            </div>
          )
        })}
        {recentTrades.length === 0 && (
          <div className="tf-empty">Waiting for trades...</div>
        )}
      </div>
    </div>
  )
}
