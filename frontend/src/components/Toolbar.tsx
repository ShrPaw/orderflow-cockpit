import React from 'react';
import { useMarketStore } from '../stores/marketStore';
import { Timeframe } from '../types';
import { DataSource, ConnectionStatus } from '../types/connector';

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1s', value: '1s' },
  { label: '5s', value: '5s' },
  { label: '15s', value: '15s' },
  { label: '30s', value: '30s' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
];

const DATA_SOURCES: { label: string; value: DataSource }[] = [
  { label: '🎮 Demo', value: 'demo' },
  { label: '⚡ Binance', value: 'binance' },
  { label: '🔷 Hyperliquid', value: 'hyperliquid' },
];

const TICK_SIZES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: '#26a69a',
  connecting: '#ffab00',
  reconnecting: '#ffab00',
  disconnected: '#6a6a7a',
  error: '#ef5350',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: '● LIVE',
  connecting: '◌ CONNECTING',
  reconnecting: '◌ RECONNECTING',
  disconnected: '○ OFF',
  error: '✕ ERROR',
};

const BOOK_STATUS_COLORS: Record<string, string> = {
  disconnected: '#6a6a7a',
  connecting: '#ffab00',
  buffering: '#ffab00',
  snapshot_loading: '#ffab00',
  synced: '#26a69a',
  resyncing: '#ff6d00',
  stale: '#ef5350',
  error: '#ef5350',
};

const Toolbar: React.FC = () => {
  const {
    timeframe, setTimeframe, isPaused, setPaused, currentPrice,
    dataSource, setDataSource, connectionStatus, depthConnectionStatus, reconnect,
    tickSize, setTickSize, orderBookDiagnostics, setStreamSpeed,
    showBigTrades, setShowBigTrades, showVolumeProfile, setShowVolumeProfile,
    showCVD, setShowCVD, showDelta, setShowDelta,
    showHeatmap, setShowHeatmap, heatmapDepthLevels, setHeatmapDepthLevels,
    heatmapIntensity, setHeatmapIntensity, heatmapTickSize, setHeatmapTickSize,
    bigTradeFilter, setBigTradeFilter, bigTradeThresholds, setBigTradeThresholds,
    zoomIn, zoomOut, resetView, panLeft, panRight,
  } = useMarketStore();

  const hasDepth = dataSource === 'binance';
  const bookStatus = orderBookDiagnostics.status;
  const bookColor = BOOK_STATUS_COLORS[bookStatus] || '#6a6a7a';

  return (
    <div style={styles.container}>
      {/* Symbol + Price + Status */}
      <div style={styles.section}>
        <span style={styles.symbol}>
          {dataSource === 'binance' ? 'BTC/USDT' : dataSource === 'hyperliquid' ? 'BTC-PERP' : 'BTC/USDT'}
        </span>
        <span style={styles.price}>{currentPrice > 0 ? currentPrice.toFixed(1) : '---'}</span>
        <span style={{ ...styles.status, color: STATUS_COLORS[connectionStatus] }}>
          {STATUS_LABELS[connectionStatus]}
        </span>
        {hasDepth && (
          <span style={{ ...styles.status, color: bookColor, marginLeft: '4px' }}>
            BOOK:{bookStatus === 'synced' ? 'SYNCED' : bookStatus.toUpperCase()}
          </span>
        )}
      </div>

      {/* Data Source Selector */}
      <div style={styles.section}>
        {DATA_SOURCES.map(ds => (
          <button
            key={ds.value}
            onClick={() => setDataSource(ds.value)}
            style={{
              ...styles.tfButton,
              background: dataSource === ds.value ? '#7c4dff' : 'transparent',
              color: dataSource === ds.value ? '#fff' : '#8a8a9a',
              borderColor: dataSource === ds.value ? '#7c4dff' : '#2a2a3a',
            }}
          >
            {ds.label}
          </button>
        ))}
        {connectionStatus === 'error' && (
          <button onClick={reconnect} style={{ ...styles.toolButton, color: '#ef5350' }}>↻</button>
        )}
      </div>

      {/* Stream Speed (Binance only) */}
      {hasDepth && (
        <div style={styles.section}>
          <span style={styles.label}>Speed</span>
          <select
            value={orderBookDiagnostics.streamSpeed}
            onChange={(e) => setStreamSpeed(e.target.value as '100ms' | '500ms' | 'default')}
            style={styles.select}
          >
            <option value="100ms">100ms</option>
            <option value="500ms">500ms</option>
            <option value="default">default</option>
          </select>
        </div>
      )}

      {/* Timeframe Selector */}
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

      {/* Zoom/Pan Controls */}
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

      {/* Tick Size */}
      <div style={styles.section}>
        <span style={styles.label}>Tick</span>
        <select value={tickSize} onChange={(e) => setTickSize(Number(e.target.value))} style={styles.select}>
          {TICK_SIZES.map(ts => (
            <option key={ts} value={ts}>${ts}</option>
          ))}
        </select>
      </div>

      {/* Thresholds */}
      <div style={styles.section}>
        <span style={styles.label}>Big≥</span>
        <select
          value={bigTradeThresholds.medium}
          onChange={(e) => {
            const med = Number(e.target.value);
            setBigTradeThresholds({ medium: med, large: med * 5, extreme: med * 10 });
          }}
          style={styles.select}
        >
          <option value={50000}>$50K</option>
          <option value={100000}>$100K</option>
          <option value={250000}>$250K</option>
          <option value={500000}>$500K</option>
          <option value={1000000}>$1M</option>
        </select>
      </div>

      {/* Heatmap Controls */}
      {hasDepth && (
        <div style={styles.section}>
          <label style={styles.toggle}>
            <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
            <span>🔥Map</span>
          </label>
          <select value={heatmapDepthLevels} onChange={(e) => setHeatmapDepthLevels(Number(e.target.value))} style={styles.select}>
            <option value={10}>10L</option>
            <option value={25}>25L</option>
            <option value={50}>50L</option>
            <option value={100}>100L</option>
          </select>
          <select value={heatmapTickSize} onChange={(e) => setHeatmapTickSize(Number(e.target.value))} style={styles.select}>
            <option value={1}>$1</option>
            <option value={5}>$5</option>
            <option value={10}>$10</option>
            <option value={25}>$25</option>
            <option value={50}>$50</option>
          </select>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.1}
            value={heatmapIntensity}
            onChange={(e) => setHeatmapIntensity(Number(e.target.value))}
            style={styles.slider}
            title={`Intensity: ${heatmapIntensity.toFixed(1)}`}
          />
        </div>
      )}

      {/* Toggles */}
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
          <span>Δ</span>
        </label>
        <label style={styles.toggle}>
          <input type="checkbox" checked={showCVD} onChange={(e) => setShowCVD(e.target.checked)} />
          <span>CVD</span>
        </label>
        <select value={bigTradeFilter} onChange={(e) => setBigTradeFilter(e.target.value as any)} style={styles.select}>
          <option value="all">All</option>
          <option value="medium">Med+</option>
          <option value="large">Large+</option>
          <option value="extreme">XL</option>
        </select>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '6px 12px', background: '#0d0d14', borderBottom: '1px solid #1a1a25',
    height: '40px', flexShrink: 0, overflowX: 'auto',
  },
  section: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  symbol: { fontWeight: 700, fontSize: '13px', color: '#ffffff', marginRight: '6px' },
  price: { fontWeight: 600, fontSize: '13px', color: '#2196f3', fontVariantNumeric: 'tabular-nums', minWidth: '60px' },
  status: { fontSize: '9px', marginLeft: '4px', fontFamily: 'monospace' },
  label: { fontSize: '9px', color: '#6a6a7a', fontFamily: 'monospace' },
  tfButton: {
    padding: '2px 6px', border: '1px solid #2a2a3a', borderRadius: '3px',
    fontSize: '10px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600,
  },
  toolButton: {
    padding: '2px 6px', border: '1px solid #2a2a3a', borderRadius: '3px',
    fontSize: '11px', cursor: 'pointer', background: 'transparent', color: '#e0e0e0',
  },
  toggle: {
    display: 'flex', alignItems: 'center', gap: '2px', fontSize: '9px', color: '#8a8a9a', cursor: 'pointer',
  },
  select: {
    background: '#1a1a25', color: '#e0e0e0', border: '1px solid #2a2a3a',
    borderRadius: '3px', padding: '1px 3px', fontSize: '9px',
  },
  slider: {
    width: '50px', height: '4px', accentColor: '#7c4dff',
  },
};

export default Toolbar;
