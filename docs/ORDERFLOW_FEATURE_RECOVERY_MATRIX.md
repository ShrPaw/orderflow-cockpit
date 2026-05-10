# Orderflow Feature Recovery Matrix

## Feature Status After Order Book Supremacy Update

| Feature | Status | Book Health Dependency | Notes |
|---------|--------|----------------------|-------|
| Candles | ✅ Always active | None | Draws from candle data regardless of book state |
| Bubbles | ✅ Always active | None | Trade-based, draws whenever trade data exists |
| Time & Sales | ✅ Always active | None | Trade stream only |
| Large Trades | ✅ Always active | None | Trade data only |
| Footprint | ✅ Always active | None | Trade/cluster data, not book-dependent |
| Heatmap/Liquidity | ✅ Active with dimming | Best available book | HEALTHY: full, DEGRADED: 70%, RESYNCING: 40%, STALE: 25% |
| DOM (Order Book) | ✅ Active with dimming | Best available book | Same dimming as heatmap |
| Spread Line | ✅ Active with dimming | Best available book | Same dimming as heatmap |
| Level Memory | ✅ Always active | None | Bubble-derived, not book-dependent |
| State Badges | ✅ Compact display | Book health | Shows DEGRADED/RESYNCING/STALE/SYNCING badges |
| GO LIVE | ✅ Always active | None | Chart navigation, never disabled |
| Crosshair | ✅ Always active | None | Lightweight Charts built-in |
| Symbol Switch | ✅ Always active | None | Triggers full reconnect |
| Ticker | ✅ Always active | None | Independent REST + WebSocket stream |

## Order Book Health States

| State | Description | Heatmap | DOM | Badge |
|-------|-------------|---------|-----|-------|
| HEALTHY | Strict diff-depth sync active | Full brightness | Full | None |
| DEGRADED | depth20 top-20 fallback | 70% dim | 70% dim + label | 📉 DEGRADED TOP-20 BOOK |
| RESYNCING | Last known good book | 40% dim | 40% dim | 🔄 RESYNCING |
| STALE | No recent updates | 25% dim | 25% dim | ⚠ STALE BOOK |
| SYNCING | Waiting for overlap | 30% dim | 30% dim | ⏳ SYNCING… |
| SNAPSHOT_LOADING | Fetching REST snapshot | 30% dim | 30% dim | ⏳ LOADING SNAPSHOT… |
| BUFFERING | Stream open, waiting for snapshot | 30% dim | 30% dim | ⏳ BUFFERING… |
| CONNECTING | WebSocket connecting | 30% dim | 30% dim | ⏳ CONNECTING… |
| ERROR | Fatal error | 30% dim | 30% dim | ❌ BOOK ERROR |
| DISCONNECTED | Not connected | Hidden | Hidden | None |

## Smart Flow Bubbles

**Previous:** RAW / CLUSTERED / HYBRID mode selector in toolbar
**Current:** Smart Flow — automatic, always renders

- Raw bubbles always render when trade data exists
- Cluster outlines provide enrichment context (subtle dashed rings)
- Cluster trade count badges shown for 3+ trade clusters
- No mode switch, no blank output, no user-facing complexity

## Timeout Protection

| Timeout | Value | Triggers |
|---------|-------|----------|
| Snapshot request | 10s | Abort fetch, record failure |
| SNAPSHOT_LOADING max | 20s | Force recovery |
| SYNCING max (overlap wait) | 15s | Force recovery |
| Strict sync attempt total | 40s | Force recovery |
| Max consecutive failures | 3 | Enter DEGRADED |
| DEGRADED recovery interval | 30s | Attempt strict resync |
