import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtNum } from '../utils/formatters'

export default function MarketHeader() {
  const symbol = useMarketStore(s => s.symbol)
  const livePrice = useMarketStore(s => s.livePrice)
  const liveChange = useMarketStore(s => s.liveChange)
  const liveChangePct = useMarketStore(s => s.liveChangePct)
  const ticker = useMarketStore(s => s.ticker)
  const mode = useMarketStore(s => s.mode)
  const connected = useMarketStore(s => s.connected)
  const connectionError = useMarketStore(s => s.connectionError)

  if (mode === 'demo') return null

  const isUp = liveChange >= 0

  return (
    <div className="market-header">
      <div className="mh-left">
        <div className="mh-symbol">{symbol}</div>
        {livePrice > 0 && (
          <div className={`mh-price ${isUp ? 'green' : 'red'}`}>
            {fmtPrice(livePrice)}
          </div>
        )}
        <div className={`mh-change ${isUp ? 'green' : 'red'}`}>
          {isUp ? '+' : ''}{liveChange.toFixed(2)} ({isUp ? '+' : ''}{liveChangePct.toFixed(2)}%)
        </div>
      </div>

      <div className="mh-stats">
        {ticker && (
          <>
            <div className="mh-stat">
              <span className="mh-stat-label">24h High</span>
              <span className="mh-stat-value">{fmtPrice(ticker.high)}</span>
            </div>
            <div className="mh-stat">
              <span className="mh-stat-label">24h Low</span>
              <span className="mh-stat-value">{fmtPrice(ticker.low)}</span>
            </div>
            <div className="mh-stat">
              <span className="mh-stat-label">24h Vol</span>
              <span className="mh-stat-value">{fmtNum(ticker.volume)} {symbol.replace('USDT', '')}</span>
            </div>
            <div className="mh-stat">
              <span className="mh-stat-label">24h Trades</span>
              <span className="mh-stat-value">{fmtNum(ticker.trades)}</span>
            </div>
          </>
        )}
      </div>

      <div className="mh-status">
        {!connected && mode === 'live' && (
          <div className="mh-conn-badge disconnected">
            <span className="mh-conn-dot" />
            {connectionError || 'Connecting...'}
          </div>
        )}
        {connected && mode === 'live' && (
          <div className="mh-conn-badge connected">
            <span className="mh-conn-dot" />
            Connected
          </div>
        )}
      </div>
    </div>
  )
}
