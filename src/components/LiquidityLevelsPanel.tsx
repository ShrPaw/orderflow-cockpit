import { useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { deriveLiquidityLevels, formatDistance } from '../utils/liquidityLevels'
import { fmtPrice, fmtQty, fmtNum } from '../utils/formatters'

export default function LiquidityLevelsPanel() {
  const bids = useMarketStore(s => s.bids)
  const asks = useMarketStore(s => s.asks)
  const livePrice = useMarketStore(s => s.livePrice)
  const depthStale = useMarketStore(s => s.depthStale)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)

  const isUsable = (orderBookHealth === 'HEALTHY' || orderBookHealth === 'TOP20' || orderBookHealth === 'DEGRADED')
    && !depthStale

  const { bidLevels, askLevels } = useMemo(() => {
    if (!isUsable) return { bidLevels: [], askLevels: [] }
    return deriveLiquidityLevels({ bids, asks, livePrice })
  }, [bids, asks, livePrice, isUsable])

  if (!isUsable || (bidLevels.length === 0 && askLevels.length === 0)) {
    return (
      <div className="panel-section">
        <div className="panel-title">Liquidity Levels</div>
        <div className="empty">No validated book data</div>
      </div>
    )
  }

  return (
    <div className="panel-section">
      <div className="panel-title">Liquidity Levels</div>

      {/* Ask levels (reversed so closest to price is at bottom) */}
      <div className="liq-levels-section">
        <div className="liq-side-label ask">ASKS</div>
        {askLevels.map((l, i) => (
          <div key={`ask-${i}`} className="liq-row ask">
            <span className="liq-price">{fmtPrice(l.price)}</span>
            <div className="liq-bar-wrap">
              <div className="liq-bar ask" style={{ width: `${l.relativeStrength}%` }} />
            </div>
            <span className="liq-qty">{fmtQty(l.qty)}</span>
            <span className="liq-distance">{formatDistance(l)}</span>
            {l.status === 'near_price' && <span className="liq-badge near">NEAR</span>}
            {l.status === 'large_visible' && <span className="liq-badge large">LARGE</span>}
          </div>
        ))}
      </div>

      {/* Bid levels */}
      <div className="liq-levels-section">
        <div className="liq-side-label bid">BIDS</div>
        {bidLevels.map((l, i) => (
          <div key={`bid-${i}`} className="liq-row bid">
            <span className="liq-price">{fmtPrice(l.price)}</span>
            <div className="liq-bar-wrap">
              <div className="liq-bar bid" style={{ width: `${l.relativeStrength}%` }} />
            </div>
            <span className="liq-qty">{fmtQty(l.qty)}</span>
            <span className="liq-distance">{formatDistance(l)}</span>
            {l.status === 'near_price' && <span className="liq-badge near">NEAR</span>}
            {l.status === 'large_visible' && <span className="liq-badge large">LARGE</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
