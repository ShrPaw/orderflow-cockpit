# Orderflow Cockpit — v0.1

Crypto-native order-flow visualization platform.

## Quick Start (Frontend Only)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## What's Included

### Chart Features
- **Footprint Candles** — Bid/ask volume at each price level, zoom-dependent detail
- **Large Trade Bubbles** — Proportional circles showing institutional activity, sized by notional volume
- **Volume Profile** — Session volume profile with POC line
- **Delta Histogram** — Per-candle delta panel below main chart
- **CVD Line** — Cumulative Volume Delta with area fill
- **Current Price Line** — Dashed line with price label

### Interaction
- **Scroll** — Zoom in/out (time axis)
- **Ctrl+Scroll** — Zoom price axis
- **Drag** — Pan both axes
- **Toolbar** — Timeframe selection, zoom controls, toggle panels

### Panels
- **Right Side Panel** — Session statistics, large trade feed, key levels
- **Bottom Panels** — Delta histogram + CVD chart

### Toolbar
- Symbol + live price
- Timeframe buttons (1s to 15m)
- Zoom/pan controls
- Play/pause
- Toggle: Bubbles, VP, Delta, CVD
- Big trade filter: All / Medium+ / Large+ / Extreme

## Architecture

```
frontend/
├── src/
│   ├── types/index.ts          — TypeScript interfaces
│   ├── utils/
│   │   ├── dataGenerator.ts    — Simulated market data engine
│   │   └── chartRenderer.ts    — Canvas 2D chart rendering
│   ├── stores/
│   │   └── marketStore.ts      — Zustand state management
│   ├── components/
│   │   ├── ChartCanvas.tsx     — Main chart canvas with zoom/pan
│   │   ├── Toolbar.tsx         — Top toolbar
│   │   └── SidePanel.tsx       — Right side stats/trades panel
│   ├── App.tsx                 — Root component
│   └── main.tsx                — Entry point
```

## Data

Currently using **simulated BTC/USDT data** with realistic:
- Gaussian price walk with volatility
- Volume distribution (small trades common, rare large trades)
- Buy/sell aggressor classification
- Liquidation events on extreme trades

To connect real exchange data, replace `MarketDataGenerator` with WebSocket connectors to Hyperliquid/Binance.

## Technical Details

- **Rendering**: Canvas 2D with DPR-aware scaling
- **State**: Zustand with tick-based updates (200ms interval)
- **Performance**: Virtual rendering (only visible candles drawn), ring buffer data structures
- **Zoom**: Stable visible range calculation, smooth animation via requestAnimationFrame

## Next Steps (Phase 3+)

- [ ] Real Hyperliquid WebSocket connector
- [ ] Real Binance Futures WebSocket connector
- [ ] Absorption detection algorithm
- [ ] Imbalance cluster zones
- [ ] Liquidity heatmap (order book depth over time)
- [ ] DOM-style ladder panel
- [ ] Alert engine
- [ ] Replay trading simulator
- [ ] Workspace save/load
