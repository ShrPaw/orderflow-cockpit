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
  const depthConnected = useMarketStore(s => s.depthConnected)
  const tickerConnected = useMarketStore(s => s.tickerConnected)
  const tradeError = useMarketStore(s => s.tradeError)
  const tickerError = useMarketStore(s => s.tickerError)
  const orderBookHealth = useMarketStore(s => s.orderBookHealth)
  const orderBookSource = useMarketStore(s => s.orderBookSource)

  if (mode === 'demo') return null

  const allConnected = connected && depthConnected && tickerConnected
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
        {/* Stream-level status indicators */}
        <div className="mh-stream-status">
          <span className={`mh-stream-dot ${tickerConnected ? 'ok' : 'fail'}`}
            title={tickerError || (tickerConnected ? 'Ticker connected' : 'Ticker disconnected')} />
          <span className={`mh-stream-dot ${connected ? 'ok' : 'fail'}`}
            title={tradeError || (connected ? 'Trades connected' : 'Trades disconnected')} />
          <span className={`mh-stream-dot ${orderBookHealth === 'HEALTHY' || orderBookHealth === 'TOP20' || orderBookHealth === 'DEGRADED' ? 'ok' : orderBookHealth === 'STALE' || orderBookHealth === 'ERROR' ? 'fail' : 'warn'}`}
            title={`Book: ${orderBookHealth} (${orderBookSource})`} />
        </div>
        {!allConnected && mode === 'live' && (
          <div className="mh-conn-badge disconnected">
            <span className="mh-conn-dot" />
            Connecting...
          </div>
        )}
        {allConnected && mode === 'live' && (
          <div className="mh-conn-badge connected">
            <span className="mh-conn-dot" />
            Connected
          </div>
        )}
      </div>
    </div>
  )
}
