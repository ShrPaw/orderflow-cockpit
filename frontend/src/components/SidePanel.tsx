import React from 'react';
import { useMarketStore } from '../stores/marketStore';

const SidePanel: React.FC = () => {
  const {
    sessionStats, bigTrades, currentPrice, cvdHistory,
    dataSource, exchangeName, connectionStatus, tradesPerSecond, lastTradeTimestamp,
    tickSize,
  } = useMarketStore();
  const lastCvd = cvdHistory.length > 0 ? cvdHistory[cvdHistory.length - 1].value : 0;
  const recentBigTrades = bigTrades.slice(-8).reverse();

  const statusColor = connectionStatus === 'connected' ? '#26a69a' :
    connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? '#ffab00' : '#6a6a7a';

  return (
    <div style={styles.container}>
      {/* Connection Info */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>CONNECTION</div>
        <Row label="Source" value={exchangeName} color="#7c4dff" />
        <Row label="Status" value={connectionStatus.toUpperCase()} color={statusColor} />
        <Row label="Price" value={currentPrice > 0 ? currentPrice.toFixed(1) : '---'} color="#2196f3" />
        <Row label="Trades/s" value={tradesPerSecond.toFixed(1)} />
        <Row label="Tick Size" value={`$${tickSize}`} />
        {lastTradeTimestamp > 0 && (
          <Row label="Last Trade" value={new Date(lastTradeTimestamp).toLocaleTimeString()} />
        )}
      </div>

      {/* Session Stats */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>SESSION STATS</div>
        <Row label="Trades" value={sessionStats.tradeCount.toLocaleString()} />
        <Row label="Volume" value={sessionStats.totalVolume.toFixed(4)} />
        <Row label="Buy Vol" value={sessionStats.totalBuyVolume.toFixed(4)} color="#26a69a" />
        <Row label="Sell Vol" value={sessionStats.totalSellVolume.toFixed(4)} color="#ef5350" />
        <Row label="Net Δ" value={`${sessionStats.netDelta >= 0 ? '+' : ''}${sessionStats.netDelta.toFixed(4)}`} color={sessionStats.netDelta >= 0 ? '#26a69a' : '#ef5350'} />
        <Row label="VWAP" value={sessionStats.vwap.toFixed(1)} />
        <Row label="Range" value={`${sessionStats.lowPrice.toFixed(1)} - ${sessionStats.highPrice.toFixed(1)}`} />
        <Row label="Big Trades" value={sessionStats.bigTradeCount.toString()} />
        <Row label="CVD" value={`${lastCvd >= 0 ? '+' : ''}${lastCvd.toFixed(0)}`} color={lastCvd >= 0 ? '#26a69a' : '#ef5350'} />
      </div>

      {/* Large Trades */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>LARGE TRADES</div>
        {recentBigTrades.length === 0 && <div style={styles.empty}>Waiting for trades...</div>}
        {recentBigTrades.map((bt) => (
          <div key={bt.trade.id} style={styles.tradeRow}>
            <span style={{ color: bt.trade.aggressor === 'buy' ? '#26a69a' : '#ef5350', fontWeight: 700, width: '12px' }}>
              {bt.trade.aggressor === 'buy' ? 'B' : 'S'}
            </span>
            <span style={styles.tradeSize}>{bt.trade.quantity.toFixed(4)}</span>
            <span style={styles.tradePrice}>@{bt.trade.price.toFixed(1)}</span>
            <span style={styles.tradeNotional}>${(bt.notional / 1000).toFixed(0)}K</span>
            <span style={{
              ...styles.badge,
              background: bt.sizeCategory === 'extreme' ? '#ff6d0040' : bt.sizeCategory === 'large' ? '#ffab0040' : '#2196f340',
              color: bt.sizeCategory === 'extreme' ? '#ff6d00' : bt.sizeCategory === 'large' ? '#ffab00' : '#2196f3',
            }}>
              {bt.sizeCategory === 'extreme' ? 'XL' : bt.sizeCategory === 'large' ? 'L' : 'M'}
            </span>
          </div>
        ))}
      </div>

      {/* Key Levels */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>KEY LEVELS</div>
        {sessionStats.vwap > 0 && <Row label="VWAP" value={sessionStats.vwap.toFixed(1)} color="#2196f3" />}
        {sessionStats.highPrice > 0 && <Row label="High" value={sessionStats.highPrice.toFixed(1)} color="#26a69a" />}
        {sessionStats.lowPrice > 0 && <Row label="Low" value={sessionStats.lowPrice.toFixed(1)} color="#ef5350" />}
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
    width: '200px', background: '#0d0d14', borderLeft: '1px solid #1a1a25',
    display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'auto',
    flexShrink: 0,
  },
  section: { padding: '6px 8px', borderBottom: '1px solid #1a1a25' },
  sectionTitle: { fontSize: '9px', fontWeight: 700, color: '#6a6a7a', marginBottom: '4px', letterSpacing: '1px' },
  empty: { fontSize: '9px', color: '#4a4a5a', fontStyle: 'italic' },
  tradeRow: { display: 'flex', alignItems: 'center', gap: '4px', padding: '1px 0', fontSize: '9px', fontFamily: 'monospace' },
  tradeSize: { color: '#e0e0e0', fontWeight: 600, minWidth: '36px' },
  tradePrice: { color: '#8a8a9a', flex: 1, minWidth: '50px' },
  tradeNotional: { color: '#6a6a7a', fontSize: '8px', minWidth: '32px' },
  badge: { padding: '1px 3px', borderRadius: '2px', fontSize: '7px', fontWeight: 700 },
};

const rowStyles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: '9px', fontFamily: 'monospace' },
  label: { color: '#6a6a7a' },
  value: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
};

export default SidePanel;
