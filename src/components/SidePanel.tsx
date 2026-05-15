import { useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { fmtNum, fmtPrice } from '../utils/formatters'
import type { LevelRecord } from '../utils/levelMemory'
import type { AuctionCluster } from '../utils/auctionClusters'
import MarketSnapshotPanel from './MarketSnapshotPanel'
import LiquidityLevelsPanel from './LiquidityLevelsPanel'
import FlowEventsPanel from './FlowEventsPanel'
import AlertRulesPanel from './AlertRulesPanel'

export default function SidePanel() {
  const delta = useMarketStore(s => s.delta)
  const cvd = useMarketStore(s => s.cvd)
  const totalVolume = useMarketStore(s => s.totalVolume)
  const buyVolume = useMarketStore(s => s.buyVolume)
  const sellVolume = useMarketStore(s => s.sellVolume)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const largeTrades = useMarketStore(s => s.largeTrades)
  const bubbles = useMarketStore(s => s.bubbles)
  const levelMemory = useMarketStore(s => s.levelMemory)
  const clusters = useMarketStore(s => s.clusters)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)
  const orderBookError = useMarketStore(s => s.orderBookError)
  const orderBookLastUpdateId = useMarketStore(s => s.orderBookLastUpdateId)
  const orderBookReconnectAttempts = useMarketStore(s => s.orderBookReconnectAttempts)

  const buyPct = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50

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
    let num = 0, den = 0
    for (const [p, l] of Object.entries(candle.priceMap)) {
      const price = parseFloat(p)
      num += price * l.total
      den += l.total
    }
    return den > 0 ? num / den : null
  }, [candle])

  // Show debug section only when there's a real issue or strict is active
  const showDebug = orderBookHealth === 'ERROR'
    || orderBookHealth === 'STALE'
    || orderBookHealth === 'DISCONNECTED'
    || orderBookSource === 'strict'

  return (
    <div className="side-panel">
      {/* 1. Market Snapshot — primary context */}
      <MarketSnapshotPanel />

      {/* 2. Delta & CVD — core flow metrics */}
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

      {/* 3. Liquidity Levels — where liquidity concentrates */}
      <LiquidityLevelsPanel />

      {/* 4. Flow Events — readable activity observations */}
      <FlowEventsPanel />

      {/* 5. Alert Builder — watch conditions */}
      <AlertRulesPanel />

      {/* 6. Volume & Activity */}
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

      {/* 7. Bubble State Machine */}
      <BubbleStates bubbles={bubbles} />

      {/* 8. Auction Clusters */}
      {clusters.length > 0 && <AuctionClusters clusters={clusters} />}

      {/* 9. Large Trades */}
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

      {/* 10. Top Footprint Levels */}
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

      {/* 11. Level Memory */}
      {levelMemory.length > 0 && <LevelMemory levels={levelMemory} />}

      {/* 12. Debug / Health — subtle, only shown when relevant */}
      {showDebug && (
        <div className="panel-section debug-section">
          <div className="panel-title" style={{ color: '#4a5e78', fontSize: 8 }}>Diagnostics</div>
          <div className="stat-row">
            <span className="label">Source</span>
            <span className="value" style={{
              color: orderBookSource === 'strict' ? '#2dd4a0'
                : orderBookSource === 'depth20' ? '#4fc3f7'
                : '#6b7d96',
              fontSize: 10,
              fontFamily: 'monospace'
            }}>
              {orderBookSource === 'strict' ? 'STRICT DEPTH' : orderBookSource === 'depth20' ? 'LIVE TOP-20' : orderBookSource === 'last_known' ? 'LAST KNOWN' : 'NONE'}
            </span>
          </div>
          <div className="stat-row">
            <span className="label">Health</span>
            <span className="value" style={{
              color: orderBookHealth === 'HEALTHY' ? '#2dd4a0'
                : orderBookHealth === 'TOP20' ? '#4fc3f7'
                : orderBookHealth === 'ERROR' || orderBookHealth === 'STALE' ? '#ef6461'
                : '#e4a73b',
              fontSize: 10,
            }}>
              {orderBookHealth === 'HEALTHY' ? 'STRICT'
                : orderBookHealth === 'TOP20' ? 'LIVE TOP-20'
                : orderBookHealth === 'DEGRADED' ? 'TOP-20 ACTIVE'
                : orderBookHealth}
            </span>
          </div>
          {orderBookLastUpdateId > 0 && (
            <div className="stat-row">
              <span className="label">Last Update ID</span>
              <span className="value" style={{ fontSize: 10 }}>{orderBookLastUpdateId}</span>
            </div>
          )}
          {orderBookReconnectAttempts > 0 && (
            <div className="stat-row">
              <span className="label">Reconnects</span>
              <span className="value">{orderBookReconnectAttempts}</span>
            </div>
          )}
          {orderBookError && (
            <div className="empty" style={{ color: '#6b7d96', fontSize: 10 }}>
              {orderBookError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───

function BubbleStates({ bubbles }: { bubbles: any[] }) {
  const accepted = bubbles.filter(b => b.state === 'ACCEPTED').length
  const rejected = bubbles.filter(b => b.state === 'REJECTED').length
  const absorbed = bubbles.filter(b => b.state === 'ABSORBED').length
  const pending = bubbles.filter(b => b.state === 'PENDING').length
  const exhausted = bubbles.filter(b => b.state === 'EXHAUSTED').length
  const invalidated = bubbles.filter(b => b.state === 'INVALIDATED').length
  const resistance = bubbles.filter(b => b.state === 'RESISTANCE').length

  return (
    <div className="panel-section">
      <div className="panel-title">Bubble States</div>
      <div className="bubble-legend">
        <span className="legend-item"><span className="dot yellow" /> Pending — waiting for response</span>
        <span className="legend-item"><span className="dot green" /> Accepted — price followed aggression</span>
        <span className="legend-item"><span className="dot red" /> Rejected — price moved against it</span>
        <span className="legend-item"><span className="dot cyan" /> Absorbed — liquidity neutralized it</span>
        <span className="legend-item"><span className="dot gray" /> Exhausted — no meaningful response</span>
        <span className="legend-item"><span className="dot" style={{ background: '#e06040' }} /> Invalidated — accepted then reversed</span>
        <span className="legend-item"><span className="dot purple" /> Resistance — structural resistance context</span>
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
      <div className="stat-row">
        <span className="label">Invalidated</span>
        <span className="value" style={{ color: '#e06040' }}>{invalidated}</span>
      </div>
      <div className="stat-row">
        <span className="label">Resistance</span>
        <span className="value purple">{resistance}</span>
      </div>
    </div>
  )
}

function AuctionClusters({ clusters }: { clusters: AuctionCluster[] }) {
  return (
    <div className="panel-section">
      <div className="panel-title">Auction Clusters</div>
      <div className="stat-row">
        <span className="label">Active</span>
        <span className="value">{clusters.filter(c => c.agePhase !== 'EXPIRED').length}</span>
      </div>
      <div className="stat-row">
        <span className="label">Total</span>
        <span className="value">{clusters.length}</span>
      </div>
      <div className="bubble-legend">
        <span className="legend-item"><span className="dot green" /> Accepted auction</span>
        <span className="legend-item"><span className="dot red" /> Rejected / failed auction</span>
        <span className="legend-item"><span className="dot cyan" /> Absorbed at level</span>
        <span className="legend-item"><span className="dot purple" /> Structural resistance</span>
      </div>
      {clusters
        .filter(c => c.agePhase !== 'EXPIRED')
        .sort((a, b) => b.cumulativeNotional - a.cumulativeNotional)
        .slice(0, 6)
        .map(cl => (
          <div key={cl.id} className="stat-row">
            <span className="label" style={{ fontSize: 10 }}>
              {cl.side === 'buy' ? '▲' : '▼'} {fmtPrice(cl.vwapPrice)}
            </span>
            <span className="value" style={{
              color: cl.state === 'ACCEPTED' ? '#2dd4a0'
                : cl.state === 'REJECTED' ? '#ef6461'
                : cl.state === 'ABSORBED' ? '#4fc3f7'
                : cl.state === 'RESISTANCE' ? '#a855f7'
                : cl.state === 'EXHAUSTED' ? '#4a5e78'
                : '#e4a73b'
            }}>
              {cl.auctionContext !== 'NONE'
                ? cl.auctionContext.replace(/_/g, ' ')
                : cl.state}
              {' '}(${fmtNum(cl.cumulativeNotional)})
            </span>
          </div>
        ))}
    </div>
  )
}

function LevelMemory({ levels }: { levels: LevelRecord[] }) {
  return (
    <div className="panel-section">
      <div className="panel-title">Level Memory</div>
      <div className="bubble-legend">
        <span className="legend-item"><span className="dot red" /> REJ — repeated rejection</span>
        <span className="legend-item"><span className="dot cyan" /> ABSORB — large print absorbed</span>
        <span className="legend-item"><span className="dot green" /> FLIP S — resistance→support</span>
        <span className="legend-item"><span className="dot yellow" /> FLIP R — support→resistance</span>
      </div>
      {levels
        .filter(l => l.touches >= 2)
        .sort((a, b) => b.touches - a.touches)
        .slice(0, 5)
        .map(l => (
          <div key={l.price} className="stat-row">
            <span className="label">{fmtPrice(l.price)}</span>
            <span className="value" style={{
              color: l.lastState === 'REJECTED_LEVEL' ? '#ef6461'
                : l.lastState === 'ABSORBED_LEVEL' ? '#4fc3f7'
                : l.lastState === 'FLIPPED_SUPPORT' ? '#2dd4a0'
                : l.lastState === 'FLIPPED_RESISTANCE' ? '#e4a73b'
                : '#4a5e78'
            }}>
              {l.lastState === 'REJECTED_LEVEL' ? 'REJ'
                : l.lastState === 'ABSORBED_LEVEL' ? 'ABSORB'
                : l.lastState === 'FLIPPED_SUPPORT' ? 'FLIP S'
                : l.lastState === 'FLIPPED_RESISTANCE' ? 'FLIP R'
                : l.lastState === 'ACCEPTED_LEVEL' ? 'ACC'
                : '—'}
              {' '}({l.touches})
            </span>
          </div>
        ))}
      {levels.filter(l => l.touches >= 2).length === 0 && (
        <div className="empty">No meaningful levels yet</div>
      )}
    </div>
  )
}
