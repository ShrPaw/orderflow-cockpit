# Orderflow Cockpit

A real-time BTC order-flow visualization dashboard built with React, TypeScript, Vite, Canvas2D, and public Binance Futures market data.

## What it does

This dashboard visualizes live BTCUSDT trade flow from Binance Futures in real time:

- **Live trade stream** — Connects to the Binance Futures public aggTrade WebSocket and processes every trade as it happens.
- **Order book / depth** — Connects to the Binance Futures public depth stream (top 20 levels, 100ms updates) to display live bid/ask data.
- **Footprint-style candles** — Aggregates trades into time-based candles (10s, 20s, 40s, 1m, 3m, 5m) with price-level buy/sell volume breakdown rendered directly on the chart.
- **Delta and CVD** — Tracks per-candle delta (buy volume − sell volume) and cumulative volume delta across the session.
- **Large trade bubbles** — Detects and classifies aggressive large prints as bubbles with a state machine: PENDING → ACCEPTED / REJECTED / ABSORBED / EXHAUSTED. Rendered as scaled circles on the chart.
- **Volume profile** — Computes session volume profile showing volume distribution across price levels, with POC, VAH, VAL, and delta POC.
- **Liquidity heatmap** — Renders L2 depth data as a color-intensity heatmap showing where liquidity is sitting.
- **DOM-lite panel** — Displays top 10 bid/ask levels with horizontal bar visualization, spread, mid-price, and bid/ask imbalance.
- **Time & Sales** — Scrolling trade feed with size-based visual emphasis for large and whale trades.
- **Demo mode** — Generates realistic simulated BTC trades and depth data for offline development and demonstration.

## What it does not do

This is strictly a visualization and research dashboard:

- **It does not place orders.**
- **It does not execute trades.**
- **It does not connect to any broker or exchange account.**
- **It does not require API keys.** All data comes from Binance Futures public WebSocket streams.
- **It does not provide financial advice.**
- **It does not generate automated trading signals.**

## Features

| Feature | Status |
|---|---|
| Binance Futures aggTrade live connector | ✅ Working |
| Binance Futures depth (L2) connector | ✅ Working |
| Footprint-style candles on Canvas2D | ✅ Working |
| Delta / CVD tracking | ✅ Working |
| Large trade bubble detection & classification | ✅ Working |
| Session volume profile | ✅ Working |
| Liquidity heatmap (L2 depth) | ✅ Working |
| DOM-lite (order book top 10) | ✅ Working |
| Time & Sales trade feed | ✅ Working |
| Demo mode (simulated data) | ✅ Working |
| Multiple candle intervals (10s–5m) | ✅ Working |
| Zoom / pan on chart | ✅ Working |
| Follow-live auto-scroll | ✅ Working |

## Architecture

```
src/
├── main.tsx                     # Entry point
├── App.tsx                      # Root component, connector lifecycle
├── App.css / index.css          # Styling (dark theme)
├── connectors/
│   ├── binanceAggTrade.ts       # Binance Futures aggTrade WebSocket
│   ├── binanceDepth.ts          # Binance Futures depth20 WebSocket
│   └── demoData.ts              # Simulated trade/depth generator
├── stores/
│   └── marketStore.ts           # Zustand state store
├── components/
│   ├── ChartCanvas.tsx          # Canvas2D chart (candles, footprint, bubbles)
│   ├── Toolbar.tsx              # Symbol input, interval, mode toggle
│   ├── SidePanel.tsx            # Delta/CVD, volume, bubbles, large trades
│   ├── DOMLite.tsx              # Order book depth panel
│   ├── Heatmap.tsx              # Liquidity heatmap canvas
│   ├── TradeFlow.tsx            # Time & Sales feed
│   └── DemoBanner.tsx           # Demo mode indicator
├── utils/
│   ├── chartRenderer.ts         # Canvas2D rendering engine
│   ├── aggregation.ts           # Trade → candle aggregation, bubble FSM
│   └── formatters.ts            # Price/number formatters
└── types/
    └── market.ts                # TypeScript interfaces
```

## Data sources

| Source | Protocol | Auth required |
|---|---|---|
| Binance Futures aggTrade | `wss://fstream.binance.com/ws/btcusdt@aggTrade` | No |
| Binance Futures depth | `wss://fstream.binance.com/ws/btcusdt@depth20@100ms` | No |
| Demo generator | In-process random walk | N/A |

No API keys, no accounts, no authentication. All data is public market data.

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite, typically:

```
http://localhost:3000
```

If Vite chooses another port (e.g. 3001), use the terminal URL.

### Windows (full path)

```powershell
cd C:\Users\Nicolas\Desktop\orderflow-cockpit
npm install
npm run dev
```

## Build for production

```bash
npm run build
npm run preview
```

The build output goes to `dist/`.

## Known limitations

- **aggTrade is not full tick data.** Binance aggTrade stream aggregates trades into single messages. It is not a complete tick-by-tick order book execution feed.
- **Footprint cells are approximations.** They are built from public trade aggregation and price bucketing, not from confirmed order book executions.
- **Depth heatmap quality depends on sync.** The L2 depth snapshot is top-20 only and updates at 100ms intervals. Rapid price movements may cause stale levels.
- **No historical depth replay.** The heatmap only shows current and recent depth snapshots. There is no historical order book reconstruction.
- **Browser rendering limits.** Under extreme update rates (very volatile markets), canvas rendering may drop frames. The architecture is optimized for typical BTC activity levels.
- **No Hyperliquid connector in the Vite version.** The previous Node/Vanilla version had Hyperliquid support. It is archived but not ported to the React version.

## Archived legacy code

The previous Node.js + vanilla JavaScript implementation is preserved in:

```
archive/old-node-version/
```

See [`archive/old-node-version/README.md`](archive/old-node-version/README.md) for details. Useful logic (bubble state machine, profile engine, scanner) may be ported into the React version in the future.

## License

Private project — not for redistribution.
