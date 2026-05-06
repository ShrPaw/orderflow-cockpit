import React from 'react';
import { useMarketStore } from '../stores/marketStore';

const SidePanel: React.FC = () => {
  const {
    sessionStats, bigTrades, currentPrice, cvdHistory,
    dataSource, exchangeName, connectionStatus, tradesPerSecond, lastTradeTimestamp,
    tickSize, orderBook, showHeatmap,
  } = useMarketStore();
  const lastCvd = cvdHistory.length > 0 ? cvdHistory[cvdHistory.length - 1].value : 0;
  const recentBigTrades = bigTrades.slice(-8).reverse();

  const statusColor = connectionStatus === 'connected' ? '#26a69a' :
    connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? '#ffab00' : '#6a6a7a';

  const hasDepth = dataSource === 'binance' && orderBook.bestBid > 0;

  // Build top 10 bid/ask levels from order book
  const topBids = hasDepth
    ? Array.from(orderBook.bids.entries())
        .sort((a, b) => b[0] - a[0])
        .slice(0, 10)
    : [];
  const topAsks = hasDepth
    ? Array.from(orderBook.asks.entries())
        .sort((a, b) => a[0] - b[0])
        .slice(0, 10)
    : [];

  const imbalance = hasDepth && orderBook.totalAskSize > 0
    ? orderBook.totalBidSize / orderBook.totalAskSize
    : 0;

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

      {/* DOM-lite: Order Book */}
      {hasDepth && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>ORDER BOOK</div>
          <Row label="Best Bid" value={orderBook.bestBid.toFixed(1)} color="#26a69a" />
          <Row label="Best Ask" value={orderBook.bestAsk.toFixed(1)} color="#ef5350" />
          <Row label="Spread" value={orderBook.spread.toFixed(1)} />
          <Row label="Bid Liq" value={orderBook.totalBidSize.toFixed(4)} color="#26a69a" />
          <Row label="Ask Liq" value={orderBook.totalAskSize.toFixed(4)} color="#ef5350" />
          <Row
            label="Imbalance"
            value={`${imbalance.toFixed(2)}x`}
            color={imbalance > 1.5 ? '#26a69a' : imbalance < 0.67 ? '#ef5350' : '#8a8a9a'}
          />

          {/* Ask levels (reversed so best ask is at bottom) */}
          <div style={styles.bookSection}>
            {topAsks.reverse().map(([price, size]) => (
              <div key={`ask-${price}`} style={styles.bookRow}>
                <span style={styles.bookPriceAsk}>{price.toFixed(1)}</span>
                <div style={styles.bookBarContainer}>
                  <div style={{
                    ...styles.bookBarAsk,
                    width: `${Math.min(100, (size / (orderBook.totalAskSize / 10)) * 100)}%`,
                  }} />
                </div>
                <span style={styles.bookSize}>{size.toFixed(4)}</span>
              </div>
            ))}
          </div>

          {/* Spread indicator */}
          <div style={styles.spreadRow}>
            <span style={styles.spreadText}>─── {orderBook.spread.toFixed(1)} ───</span>
          </div>

          {/* Bid levels */}
          <div style={styles.bookSection}>
            {topBids.map(([price, size]) => (
              <div key={`bid-${price}`} style={styles.bookRow}>
                <span style={styles.bookPriceBid}>{price.toFixed(1)}</span>
                <div style={styles.bookBarContainer}>
                  <div style={{
                    ...styles.bookBarBid,
                    width: `${Math.min(100, (size / (orderBook.totalBidSize / 10)) * 100)}%`,
                  }} />
                </div>
                <span style={styles.bookSize}>{size.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
  bookSection: { display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' },
  bookRow: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '8px', fontFamily: 'monospace' },
  bookPriceBid: { color: '#26a69a', width: '50px', textAlign: 'right' },
  bookPriceAsk: { color: '#ef5350', width: '50px', textAlign: 'right' },
  bookBarContainer: { flex: 1, height: '6px', background: '#1a1a25', borderRadius: '1px', overflow: 'hidden' },
  bookBarBid: { height: '100%', background: 'rgba(38, 166, 154, 0.4)', borderRadius: '1px' },
  bookBarAsk: { height: '100%', background: 'rgba(239, 83, 80, 0.4)', borderRadius: '1px' },
  bookSize: { color: '#8a8a9a', width: '40px', textAlign: 'right' },
  spreadRow: { display: 'flex', justifyContent: 'center', padding: '2px 0' },
  spreadText: { fontSize: '8px', color: '#4a4a5a', fontFamily: 'monospace' },
};

const rowStyles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: '9px', fontFamily: 'monospace' },
  label: { color: '#6a6a7a' },
  value: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
};

export default SidePanel;
