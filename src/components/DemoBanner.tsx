import { useMarketStore } from '../stores/marketStore'

export default function DemoBanner() {
  const mode = useMarketStore(s => s.mode)
  const setMode = useMarketStore(s => s.setMode)

  if (mode !== 'demo') return null

  return (
    <div className="demo-banner">
      <span>DEMO MODE — Simulated data</span>
      <button onClick={() => setMode('live')}>Switch to Live</button>
    </div>
  )
}
