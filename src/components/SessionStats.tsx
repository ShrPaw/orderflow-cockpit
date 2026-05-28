import { useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { fmtNum, fmtPrice } from '../utils/formatters'

export default function SessionStats() {
  const delta = useMarketStore(s => s.delta)
  const cvd = useMarketStore(s => s.cvd)
  const totalVolume = useMarketStore(s => s.totalVolume)
  const buyVolume = useMarketStore(s => s.buyVolume)
  const sellVolume = useMarketStore(s => s.sellVolume)
  const recentTrades = useMarketStore(s => s.recentTrades)
  const largeTrades = useMarketStore(s => s.largeTrades)
  const bubbles = useMarketStore(s => s.bubbles)
  const candles = useMarketStore(s => s.candles)
  const currentCandle = useMarketStore(s => s.currentCandle)
  const livePrice = useMarketStore(s => s.livePrice)

  const stats = useMemo(() => {
    const allCandles = currentCandle ? [...candles, currentCandle] : candles

    // Session POC tracking
    let pocPrice = 0
    let pocVolume = 0
    const allLevels = new Map<number, number>()

    // Highest high / lowest low
    let sessionHigh = 0
    let sessionLow = Infinity

    // Net delta per candle for momentum
    let positiveDeltaCandles = 0
    let negativeDeltaCandles = 0

    for (const c of allCandles) {
      if (c.high > sessionHigh) sessionHigh = c.high
      if (c.low < sessionLow) sessionLow = c.low
      if (c.delta > 0) positiveDeltaCandles++
      else if (c.delta < 0) negativeDeltaCandles++

      for (const [priceStr, level] of Object.entries(c.priceMap)) {
        const price = parseFloat(priceStr)
        const existing = allLevels.get(price) ?? 0
        const total = existing + level.total
        allLevels.set(price, total)
        if (total > pocVolume) {
          pocVolume = total
          pocPrice = price
        }
      }
    }

    // Largest single print
    const largestPrint = largeTrades.length > 0
      ? largeTrades.reduce((max, t) => t.notional > max.notional ? t : max, largeTrades[0])
      : null

    // Absorption count
    const absorptionCount = bubbles.filter(b => b.state === 'ABSORBED').length

    // Average trade size (from recent)
    const avgTradeSize = recentTrades.length > 0
      ? recentTrades.reduce((s, t) => s + t.qty, 0) / recentTrades.length
      : 0

    // Session duration estimate
    const firstCandleTime = allCandles.length > 0 ? allCandles[0].openTime : 0
    const lastCandleTime = allCandles.length > 0 ? allCandles[allCandles.length - 1].openTime : 0
    const durationMin = firstCandleTime > 0 ? Math.round((lastCandleTime - firstCandleTime) / 60_000) : 0

    // Value area (70% of volume centered on POC)
    const sortedLevels = Array.from(allLevels.entries())
      .sort((a, b) => b[1] - a[1])
    let vaHigh = pocPrice
    let vaLow = pocPrice
    let volAccum = 0
    const threshold = pocVolume * allCandles.length * 0.7
    for (const [price, vol] of sortedLevels) {
      volAccum += vol
      if (price > vaHigh) vaHigh = price
      if (price < vaLow) vaLow = price
      if (volAccum >= threshold) break
    }

    // Momentum strength: ratio of consecutive same-direction candles
    let streakCount = 0
    let streakDirection = 0
    for (let i = allCandles.length - 1; i >= 0; i--) {
      const dir = allCandles[i].delta > 0 ? 1 : -1
      if (dir === streakDirection || streakDirection === 0) {
        streakDirection = dir
        streakCount++
      } else break
    }

    return {
      sessionHigh: sessionHigh || livePrice,
      sessionLow: sessionLow === Infinity ? livePrice : sessionLow,
      pocPrice,
      pocVolume,
      vaHigh,
      vaLow,
      absorptionCount,
      largestPrint,
      avgTradeSize,
      durationMin,
      positiveDeltaCandles,
      negativeDeltaCandles,
      streakDirection,
      streakCount,
      candleCount: allCandles.length,
    }
  }, [candles, currentCandle, largeTrades, bubbles, recentTrades, livePrice])

  const isUp = delta >= 0
  const sessionRange = stats.sessionHigh - stats.sessionLow
  const sessionRangePct = stats.sessionLow > 0 ? (sessionRange / stats.sessionLow) * 100 : 0

  return (
    <div className="panel-section session-stats">
      <div className="panel-title">Session Stats</div>

      <div className="stat-row">
        <span className="label">Direction</span>
        <span className={`value ${isUp ? 'green' : 'red'}`}>
          {isUp ? '▲ BUYER-LED' : '▼ SELLER-LED'}
        </span>
      </div>

      <div className="stat-row">
        <span className="label">Range</span>
        <span className="value">
          {fmtPrice(stats.sessionLow)} — {fmtPrice(stats.sessionHigh)}
        </span>
      </div>
      <div className="stat-row small">
        <span>{sessionRangePct.toFixed(2)}% ({fmtPrice(sessionRange)})</span>
      </div>

      <div className="stat-row">
        <span className="label">POC</span>
        <span className="value yellow">{stats.pocPrice > 0 ? fmtPrice(stats.pocPrice) : '—'}</span>
      </div>

      <div className="stat-row">
        <span className="label">Value Area</span>
        <span className="value" style={{ color: '#6b7d96', fontSize: '10px' }}>
          {stats.vaLow > 0 ? `${fmtPrice(stats.vaLow)} — ${fmtPrice(stats.vaHigh)}` : '—'}
        </span>
      </div>

      <div className="session-divider" />

      <div className="stat-row">
        <span className="label">Candles</span>
        <span className="value">{stats.candleCount}</span>
      </div>
      <div className="stat-row small">
        <span>+Δ {stats.positiveDeltaCandles}</span>
        <span>-Δ {stats.negativeDeltaCandles}</span>
      </div>

      <div className="stat-row">
        <span className="label">Absorptions</span>
        <span className="value cyan">{stats.absorptionCount}</span>
      </div>

      <div className="stat-row">
        <span className="label">Largest Print</span>
        <span className="value yellow">
          {stats.largestPrint ? `$${fmtNum(stats.largestPrint.notional)}` : '—'}
        </span>
      </div>

      <div className="stat-row">
        <span className="label">Avg Size</span>
        <span className="value">{stats.avgTradeSize > 0 ? fmtNum(stats.avgTradeSize) : '—'}</span>
      </div>

      {stats.streakCount >= 3 && (
        <div className="stat-row">
          <span className="label">Momentum</span>
          <span className={`value ${stats.streakDirection > 0 ? 'green' : 'red'}`}>
            {stats.streakDirection > 0 ? '▲' : '▼'} {stats.streakCount} consecutive
          </span>
        </div>
      )}

      {stats.durationMin > 0 && (
        <div className="stat-row small">
          <span>~{stats.durationMin}min active</span>
          <span>{fmtNum(totalVolume)} total vol</span>
        </div>
      )}
    </div>
  )
}
