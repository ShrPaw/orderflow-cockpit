# Orderflow Cockpit

A local live crypto orderflow visualization cockpit using Binance Futures public WebSocket data.

**Decision-support visualization only. No trading signals. No AI predictions. No automated trading. No financial advice.**

---

## Features

- **Unified execution chart** — TradingView Lightweight Charts for professional candlestick rendering + Canvas2D overlay for orderflow methodology (heatmap, bubbles, footprint, state badges)
- **Live candles** — Real-time candlestick chart with footprint-style buy/sell volume at each price level
- **Live trades & bubbles** — Aggressive large-print detection with state classification (PENDING → ACCEPTED/REJECTED/ABSORBED/EXHAUSTED/RESISTANCE)
- **Local order book & heatmap** — L2 depth visualization with quantity labels, spread indicator, and stale-data indication
- **Footprint/orderflow** — Per-candle price-level delta visualization
- **Strict order book sync** — Binance diff-depth methodology with DEGRADED depth20 fallback, timeout protection, DEBUG_BOOK diagnostics
- **Smart Flow bubbles** — Automatic large-trade bubble rendering with cluster enrichment, no mode switching needed
- **Symbol switching** — Switch between BTCUSDT, ETHUSDT, SOLUSDT, and 20+ Binance Futures perpetuals
- **Connection health** — Per-stream status (trade, depth, ticker) with honest stale/error indication
- **Chart interaction** — Deep zoom, smooth pan, price-axis scaling, time-axis compression, LIVE/GO LIVE pill
- **Bubble hover tooltip** — Inspect aggressive flow events by hovering over bubbles
- **Demo mode** — Simulated market data for offline testing

## Debug Flags

- `localStorage.setItem('DEBUG_OVERLAY', '1')` — Show overlay diagnostics on chart
- `localStorage.setItem('DEBUG_BOOK', '1')` — Log order book sync state transitions and critical events

## Tech Stack

- React 18 + TypeScript
- Vite
- Zustand (state management)
- TradingView Lightweight Charts (candlestick chart engine)
- Canvas2D (orderflow overlay rendering)
- Binance Futures public WebSockets (no API keys required)

## Local Setup

```bash
git clone https://github.com/ShrPaw/orderflow-cockpit.git
cd orderflow-cockpit
npm install
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`).

### Production Build

```bash
npm run build
npm run preview
```

## No API Keys Required

The app connects to Binance Futures public WebSocket streams. No exchange account, API key, or authentication is needed. All data is public market data.

## Manual QA Checklist

- [ ] `npm install` succeeds
- [ ] `npm run build` passes with 0 errors
- [ ] `npm run dev` starts the app
- [ ] BTCUSDT loads with live trades, depth, and ticker
- [ ] No reconnect spam in browser console
- [ ] Chart zooms in deeply enough to inspect individual candles
- [ ] Pan away from live edge — GO LIVE pill appears
- [ ] Click GO LIVE or press Home — returns to live edge
- [ ] Hover over a bubble — tooltip shows side/state/notional/price/age
- [ ] Heatmap shows liquidity bands with quantity labels
- [ ] Switch BTCUSDT → ETHUSDT — old data clears, new data streams
- [ ] Stale order book is honestly indicated (dimmed + warning)
- [ ] No duplicate WebSocket connections
- [ ] Browser refresh starts clean

## Known Limitations

- Depends on Binance public stream availability — if Binance blocks or rate-limits the IP, streams will reconnect with backoff
- Browser/network/firewall may affect WebSocket connectivity
- Not financial advice — this is a visualization tool only
- Not a trading bot — no orders are placed, no trades are executed
- Local visualization only — no server-side persistence or historical database
- aggTrade is aggregated trade data, not full tick-by-tick execution data
- Depth stream is top-20 levels at 100ms intervals, not full order book

## What This Demonstrates (Portfolio)

- Real-time WebSocket lifecycle management with generation tokens, backoff, and stale-socket protection
- Canvas2D rendering under high-frequency streaming data
- React state management optimized for market microstructure data (Zustand + refs + subscriptions)
- Order book sequence validation and local resync engine
- Bubble state machine for aggressive flow classification
- Professional dark-theme terminal UI for financial data

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## Post-Fusion Regression Recovery

The project migrated from a dual-chart architecture (custom Canvas2D chart + Lightweight Charts experimental) to a single fused chart: TradingView Lightweight Charts as the base engine with a Canvas2D overlay for all orderflow layers.

During this migration, several orderflow features regressed or were lost. These have been restored:

- **Bubble percentile sizing** — per-candle notional percentile scaling for proper visual differentiation of trade sizes
- **Heatmap range filtering** — proximity-based level selection (2% range threshold) instead of global top-N
- **Heatmap quantity labels** — actual quantities displayed (e.g., "BID 1.2k") instead of generic labels
- **Heatmap state dimming** — visual degradation for non-HEALTHY order book states (DEGRADED, RESYNCING, STALE)
- **Cluster tooltips** — hover over auction clusters to see trade count, VWAP, flow type, absorption score
- **Spread line** — mid-price reference line with spread percentage label
- **State badges** — honest order book health indicators (DEGRADED TOP-20, RESYNCING, STALE)

The single-chart architecture is preserved: Lightweight Charts handles candles, time/price scales, zoom/pan, and crosshair. The Canvas2D overlay handles bubbles, heatmap, footprint, tooltips, level memory, and state badges.

See [docs/ORDERFLOW_FEATURE_RECOVERY_MATRIX.md](docs/ORDERFLOW_FEATURE_RECOVERY_MATRIX.md) for the full feature recovery matrix.

## License

Private project — not for redistribution.
