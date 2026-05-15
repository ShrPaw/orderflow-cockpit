import { useMarketStore } from '../stores/marketStore'
import { fmtPrice, fmtNum } from '../utils/formatters'
import type { FlowEvent } from '../utils/flowEvents'

export default function FlowEventsPanel() {
  const flowEvents = useMarketStore(s => s.flowEvents)

  if (flowEvents.length === 0) {
    return (
      <div className="panel-section">
        <div className="panel-title">Flow Events</div>
        <div className="empty">Monitoring for flow events...</div>
      </div>
    )
  }

  return (
    <div className="panel-section">
      <div className="panel-title">Flow Events</div>
      <div className="flow-events-list">
        {flowEvents.map(evt => (
          <FlowEventRow key={evt.id} event={evt} />
        ))}
      </div>
    </div>
  )
}

function FlowEventRow({ event }: { event: FlowEvent }) {
  const sevColor = event.severity === 'critical' ? '#ef6461'
    : event.severity === 'watch' ? '#e4a73b'
    : '#6b7d96'

  return (
    <div className="flow-event-row">
      <div className="flow-event-time" style={{ color: sevColor }}>
        {fmtEventTime(event.timestamp)}
      </div>
      <div className="flow-event-body">
        <div className="flow-event-title" style={{ color: sevColor }}>
          {event.title}
        </div>
        <div className="flow-event-desc">{event.description}</div>
      </div>
    </div>
  )
}

function fmtEventTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
