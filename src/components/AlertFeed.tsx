import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtNum } from '../utils/formatters'
import type { Alert, AlertCategory } from '../types/market'

const CATEGORY_META: Record<AlertCategory, { icon: string; label: string }> = {
  LARGE_TRADE: { icon: '⚡', label: 'LARGE TRADE' },
  BUBBLE_CLASSIFIED: { icon: '◉', label: 'BUBBLE' },
  PRESSURE_SHIFT: { icon: '⇄', label: 'PRESSURE' },
  LEVEL_HIT: { icon: '◈', label: 'LEVEL' },
  IMBALANCE: { icon: '⚖', label: 'IMBALANCE' },
  DELTA_DIVERGENCE: { icon: '⇅', label: 'DIVERGENCE' },
}

export default function AlertFeed() {
  const alerts = useMarketStore(s => s.alerts)
  const dismissAlert = useMarketStore(s => s.dismissAlert)
  const clearAlerts = useMarketStore(s => s.clearAlerts)

  const active = alerts.filter(a => !a.dismissed)
  const count = active.length

  return (
    <div className="alert-feed">
      <div className="alert-feed-header">
        <span className="alert-feed-title">Alerts</span>
        {count > 0 && (
          <>
            <span className="alert-count">{count}</span>
            <button className="alert-clear-btn" onClick={clearAlerts} title="Clear all">✕</button>
          </>
        )}
      </div>
      <div className="alert-feed-list">
        {active.length === 0 && (
          <div className="alert-empty">No active alerts</div>
        )}
        {active.map(a => (
          <AlertRow key={a.id} alert={a} onDismiss={() => dismissAlert(a.id)} />
        ))}
      </div>
    </div>
  )
}

function AlertRow({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const meta = CATEGORY_META[alert.category]
  const catClass = `alert-cat-${alert.category.toLowerCase().replace(/_/g, '-')}`
  const sideClass = `alert-side-${alert.side}`
  const timeStr = new Date(alert.time).toLocaleTimeString('en-US', { hour12: false })

  return (
    <div className={`alert-row ${catClass} ${sideClass}`}>
      <div className="alert-row-top">
        <span className="alert-icon">{meta.icon}</span>
        <span className="alert-category">{meta.label}</span>
        <span className="alert-side">{alert.side === 'buy' ? '▲' : alert.side === 'sell' ? '▼' : '●'}</span>
        <span className="alert-time">{timeStr}</span>
        <button className="alert-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
      </div>
      <div className="alert-title">{alert.title}</div>
      <div className="alert-detail">{alert.detail}</div>
      <div className="alert-price">{fmtPrice(alert.price)}</div>
    </div>
  )
}
