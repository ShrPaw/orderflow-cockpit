import React from 'react';
import { useMarketStore } from '../stores/marketStore';

const SidePanel: React.FC = () => {
  const { sessionStats, bigTrades, currentPrice, cvdHistory } = useMarketStore();
  const lastCvd = cvdHistory.length > 0 ? cvdHistory[cvdHistory.length - 1].value : 0;
  const recentBigTrades = bigTrades.slice(-8).reverse();

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>SESSION STATS</div>
        <Row label="Trades" value={sessionStats.tradeCount.toLocaleString()} />
        <Row label="Volume" value={sessionStats.totalVolume.toFixed(2)} />
        <Row label="Buy Vol" value={sessionStats.totalBuyVolume.toFixed(2)} color="#26a69a" />
        <Row label="Sell Vol" value={sessionStats.totalSellVolume.toFixed(2)} color="#ef5350" />
        <Row label="Net Delta" value={`${sessionStats.netDelta >= 0 ? '+' : ''}${sessionStats.netDelta.toFixed(2)}`} color={sessionStats.netDelta >= 0 ? '#26a69a' : '#ef5350'} />
        <Row label="VWAP" value={sessionStats.vwap.toFixed(1)} />
        <Row label="Range" value={`${sessionStats.lowPrice.toFixed(1)} - ${sessionStats.highPrice.toFixed(1)}`} />
        <Row label="Big Trades" value={sessionStats.bigTradeCount.toString()} />
        <Row label="CVD" value={`${lastCvd >= 0 ? '+' : ''}${lastCvd.toFixed(0)}`} color={lastCvd >= 0 ? '#26a69a' : '#ef5350'} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>LARGE TRADES</div>
        {recentBigTrades.length === 0 && <div style={styles.empty}>No large trades yet</div>}
        {recentBigTrades.map((bt, i) => (
          <div key={bt.trade.id} style={styles.tradeRow}>
            <span style={{ color: bt.trade.aggressor === 'buy' ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
              {bt.trade.aggressor === 'buy' ? 'B' : 'S'}
            </span>
            <span style={styles.tradeSize}>{bt.trade.quantity.toFixed(2)}</span>
            <span style={styles.tradePrice}>@{bt.trade.price.toFixed(1)}</span>
            <span style={{
              ...styles.badge,
              background: bt.sizeCategory === 'extreme' ? '#ff6d0040' : bt.sizeCategory === 'large' ? '#ffab0040' : '#2196f340',
              color: bt.sizeCategory === 'extreme' ? '#ff6d00' : bt.sizeCategory === 'large' ? '#ffab00' : '#2196f3',
            }}>
              {bt.sizeCategory[0].toUpperCase()}
            </span>
            {bt.trade.isLiquidation && <span style={styles.liqBadge}>LIQ</span>}
          </div>
        ))}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>KEY LEVELS</div>
        {sessionStats.vwap > 0 && <Row label="VWAP" value={sessionStats.vwap.toFixed(1)} color="#2196f3" />}
        <Row label="Session High" value={sessionStats.highPrice.toFixed(1)} color="#26a69a" />
        <Row label="Session Low" value={sessionStats.lowPrice.toFixed(1)} color="#ef5350" />
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={rowStyles.row}>
    <span style={rowStyles.label}>{label}</span>
    <span style={{ ...rowStyles.value, color: color || '#e0e0e0' }}>{value}</span>
  </div>
);

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '220px', background: '#0d0d14', borderLeft: '1px solid #1a1a25',
    display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'auto',
    flexShrink: 0,
  },
  section: { padding: '8px 10px', borderBottom: '1px solid #1a1a25' },
  sectionTitle: { fontSize: '10px', fontWeight: 700, color: '#6a6a7a', marginBottom: '6px', letterSpacing: '1px' },
  empty: { fontSize: '10px', color: '#4a4a5a', fontStyle: 'italic' },
  tradeRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', fontSize: '10px', fontFamily: 'monospace' },
  tradeSize: { color: '#e0e0e0', fontWeight: 600, minWidth: '40px' },
  tradePrice: { color: '#8a8a9a', flex: 1 },
  badge: { padding: '1px 4px', borderRadius: '2px', fontSize: '8px', fontWeight: 700 },
  liqBadge: { background: '#ff6d0040', color: '#ff6d00', padding: '1px 3px', borderRadius: '2px', fontSize: '7px', fontWeight: 700 },
};

const rowStyles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '10px', fontFamily: 'monospace' },
  label: { color: '#6a6a7a' },
  value: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
};

export default SidePanel;
