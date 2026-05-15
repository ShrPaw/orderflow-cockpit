import { useMarketStore } from '../stores/marketStore'
import type { AlertRule } from '../utils/alerts'

export default function AlertRulesPanel() {
  const alertRules = useMarketStore(s => s.alertRules)
  const toggleAlertRule = useMarketStore(s => s.toggleAlertRule)
  const updateAlertRule = useMarketStore(s => s.updateAlertRule)
  const resetAlertRules = useMarketStore(s => s.resetAlertRules)

  return (
    <div className="panel-section">
      <div className="panel-title">
        Watch Conditions
        <button className="alert-reset-btn" onClick={resetAlertRules} title="Reset to defaults">
          ↺
        </button>
      </div>
      <div className="alert-rules-list">
        {alertRules.map(rule => (
          <AlertRuleRow
            key={rule.id}
            rule={rule}
            onToggle={() => toggleAlertRule(rule.id)}
            onThresholdChange={(val) => updateAlertRule(rule.id, { threshold: val })}
          />
        ))}
      </div>
    </div>
  )
}

function AlertRuleRow({
  rule,
  onToggle,
  onThresholdChange,
}: {
  rule: AlertRule
  onToggle: () => void
  onThresholdChange: (val: number) => void
}) {
  return (
    <div className={`alert-rule-row ${rule.enabled ? 'enabled' : 'disabled'}`}>
      <div className="alert-rule-header">
        <button
          className={`alert-toggle ${rule.enabled ? 'on' : 'off'}`}
          onClick={onToggle}
          title={rule.enabled ? 'Disable' : 'Enable'}
        >
          {rule.enabled ? '●' : '○'}
        </button>
        <span className="alert-rule-label">{rule.label}</span>
      </div>
      {rule.enabled && (
        <div className="alert-rule-controls">
          <span className="alert-threshold-label">Threshold:</span>
          <input
            type="number"
            className="alert-threshold-input"
            value={rule.threshold}
            onChange={e => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val) && val > 0) onThresholdChange(val)
            }}
            step={getStep(rule.type)}
          />
          <span className="alert-threshold-unit">{getUnit(rule.type)}</span>
        </div>
      )}
    </div>
  )
}

function getStep(type: AlertRule['type']): number {
  switch (type) {
    case 'LARGE_TRADE': return 10_000
    case 'SPREAD': return 0.01
    case 'IMBALANCE': return 5
    case 'LIQUIDITY_PROXIMITY': return 0.05
  }
}

function getUnit(type: AlertRule['type']): string {
  switch (type) {
    case 'LARGE_TRADE': return '$'
    case 'SPREAD': return '%'
    case 'IMBALANCE': return '%'
    case 'LIQUIDITY_PROXIMITY': return '%'
  }
}
