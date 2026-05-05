import React from 'react';
import { useMarketStore } from '../stores/marketStore';
import { Timeframe } from '../types';

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1s', value: '1s' },
  { label: '5s', value: '5s' },
  { label: '15s', value: '15s' },
  { label: '30s', value: '30s' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
];

const Toolbar: React.FC = () => {
  const {
    timeframe, setTimeframe, isPaused, setPaused, isConnected, currentPrice,
    showBigTrades, setShowBigTrades, showVolumeProfile, setShowVolumeProfile,
    showCVD, setShowCVD, showDelta, setShowDelta,
    bigTradeFilter, setBigTradeFilter, zoomIn, zoomOut, resetView, panLeft, panRight,
  } = useMarketStore();

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <span style={styles.symbol}>BTC/USDT</span>
        <span style={styles.price}>{currentPrice.toFixed(1)}</span>
        <span style={{ ...styles.status, color: isConnected ? '#26a69a' : '#ef5350' }}>
          {isConnected ? '● LIVE' : '○ DISCONNECTED'}
        </span>
      </div>

      <div style={styles.section}>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            style={{
              ...styles.tfButton,
              background: timeframe === tf.value ? '#2196f3' : 'transparent',
              color: timeframe === tf.value ? '#fff' : '#8a8a9a',
            }}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div style={styles.section}>
        <button onClick={zoomIn} style={styles.toolButton} title="Zoom In">🔍+</button>
        <button onClick={zoomOut} style={styles.toolButton} title="Zoom Out">🔍−</button>
        <button onClick={resetView} style={styles.toolButton} title="Reset View">⊡</button>
        <button onClick={panLeft} style={styles.toolButton} title="Pan Left">◀</button>
        <button onClick={panRight} style={styles.toolButton} title="Pan Right">▶</button>
        <button onClick={() => setPaused(!isPaused)} style={{ ...styles.toolButton, background: isPaused ? '#ef5350' : 'transparent' }}>
          {isPaused ? '▶' : '⏸'}
        </button>
      </div>

      <div style={styles.section}>
        <label style={styles.toggle}>
          <input type="checkbox" checked={showBigTrades} onChange={(e) => setShowBigTrades(e.target.checked)} />
          <span>Bubbles</span>
        </label>
        <label style={styles.toggle}>
          <input type="checkbox" checked={showVolumeProfile} onChange={(e) => setShowVolumeProfile(e.target.checked)} />
          <span>VP</span>
        </label>
        <label style={styles.toggle}>
          <input type="checkbox" checked={showDelta} onChange={(e) => setShowDelta(e.target.checked)} />
          <span>Delta</span>
        </label>
        <label style={styles.toggle}>
          <input type="checkbox" checked={showCVD} onChange={(e) => setShowCVD(e.target.checked)} />
          <span>CVD</span>
        </label>
        <select value={bigTradeFilter} onChange={(e) => setBigTradeFilter(e.target.value as any)} style={styles.select}>
          <option value="all">All Trades</option>
          <option value="medium">Medium+</option>
          <option value="large">Large+</option>
          <option value="extreme">Extreme</option>
        </select>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', alignItems: 'center', gap: '16px',
    padding: '6px 12px', background: '#0d0d14', borderBottom: '1px solid #1a1a25',
    height: '40px', flexShrink: 0,
  },
  section: { display: 'flex', alignItems: 'center', gap: '6px' },
  symbol: { fontWeight: 700, fontSize: '14px', color: '#ffffff', marginRight: '8px' },
  price: { fontWeight: 600, fontSize: '14px', color: '#2196f3', fontVariantNumeric: 'tabular-nums' },
  status: { fontSize: '10px', marginLeft: '8px' },
  tfButton: {
    padding: '3px 8px', border: '1px solid #2a2a3a', borderRadius: '3px',
    fontSize: '11px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600,
  },
  toolButton: {
    padding: '3px 8px', border: '1px solid #2a2a3a', borderRadius: '3px',
    fontSize: '12px', cursor: 'pointer', background: 'transparent', color: '#e0e0e0',
  },
  toggle: {
    display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#8a8a9a', cursor: 'pointer',
  },
  select: {
    background: '#1a1a25', color: '#e0e0e0', border: '1px solid #2a2a3a',
    borderRadius: '3px', padding: '2px 4px', fontSize: '10px',
  },
};

export default Toolbar;
