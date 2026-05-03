# ORDERFLOW 40S RANGE PROFILE — MAX TIER UPGRADE REPORT

## Overview

Professional discretionary orderflow cockpit built from scratch.
Backend: Node.js + WebSocket. Frontend: Vanilla JS + Canvas2D.
No external charting libraries. Pure rendering engine.

---

## Architecture

```
orderflow-cockpit/
├── server/
│   ├── index.js           — Main server (HTTP API + WebSocket)
│   ├── hyperliquid.js     — Hyperliquid WebSocket source
│   ├── binance.js         — Binance USD-M + Spot fallback
│   ├── candle-engine.js   — Trade aggregation into custom candles
│   ├── profile-engine.js  — Volume/delta profile computation
│   ├── symbol-map.js      — Cross-venue symbol mapping
│   └── scanner.js         — Symbol discovery + volatility scanning
├── public/
│   ├── index.html         — Layout
│   ├── css/style.css      — Dark professional theme
│   └── js/app.js          — Chart + bubbles + zones + tools + scanner
├── docs/
│   └── ORDERFLOW_40S_RANGE_PROFILE_MAX_TIER_REPORT.md
└── package.json
```

---

## 40-Second Candle System

- **Intervals supported:** 10s, 20s, 40s (default), 1m, 3m, 5m
- **Aggregation:** Raw trades → OHLCV + orderflow metadata
- **Per candle:**
  - open, high, low, close
  - volume, buyVolume, sellVolume, delta
  - tradeCount, maxTradeSize, largeTradeCount
  - bubbleCount, absorptionCount, rejectionCount
  - Full price-level footprint (priceMap)
  - Classified bubbles with states

---

## Source Architecture

### Read Sources (priority order)
1. **Hyperliquid** — Primary. Real-time trades via WebSocket.
2. **Binance USD-M Futures** — Secondary. Full aggTrade stream.
3. **Binance Spot** — Debug fallback only. Clearly labeled.

### Execution Reference
- Binance USD-M (mapped from Hyperliquid symbols)

### Status
- Source truth visible in UI at all times
- Spot fallback shows red warning banner
- Futures-only fields disabled when on spot fallback

---

## Symbol Mapping (HL → Binance)

### Standard
- SOL → SOLUSDT
- ETH → ETHUSDT
- BTC → BTCUSDT

### Special Cases
- PEPE → 1000PEPEUSDT
- LUNC → 1000LUNCUSDT
- SHIB → 1000SHIBUSDT
- BONK → 1000BONKUSDT
- FLOKI → 1000FLOKIUSDT

Validated against actual Binance universe (567 perps found).

---

## Chart Features

### Interactions
1. ✅ Mouse wheel zoom (horizontal)
2. ✅ Ctrl+wheel vertical zoom
3. ✅ Horizontal pan/drag
4. ✅ Follow Live ON/OFF (auto-off on manual pan)
5. ✅ Fit All button
6. ✅ Reset View
7. ✅ Candle interval selector (10s–5m)
8. ✅ Drawing mode selector
9. ✅ Object deletion
10. ✅ Hover tooltips (candle OHLCV + orderflow stats)

### Rendering
- Candle bodies with wicks
- Volume bars at bottom
- Grid with time/price labels
- Price scale on right
- Crosshair with price label
- Real-time current price marker

---

## Drawing Tools

1. **Horizontal Line** — Mark price levels
2. **Trend Line** — Diagonal structure
3. **Rectangle** — Balance/consolidation zones
4. **Text Label** — Annotate (absorption, rejection, etc.)
5. **Selected Range Volume/Delta Tool** — The signature feature

### Keyboard Shortcuts
- `R` — Range tool
- `Esc` — Cursor mode / cancel
- `Delete` — Remove last drawing
- `F` — Fit all

---

## Selected Range Volume/Delta Profile

### How It Works
1. User selects Range tool (R key or toolbar button)
2. Drag from price A to price B
3. System identifies candles in that range
4. Computes full profile
5. Renders overlay on chart

### Computed Metrics
- **Volume Profile:** POC, VAH, VAL, HVN, LVN, volume gaps
- **Delta Profile:** Delta POC, max positive/negative delta levels, stacked imbalances
- **Auction Metrics:** VWAP, directional efficiency, close location, acceptance zone
- **Bubble Metrics:** Accepted/rejected/absorbed/exhausted counts, dominant side
- **Interpretation:** Human-readable text (no signals)

### Visual Rendering
- Horizontal volume bars in selected range
- Delta overlay (green/red)
- POC line (gold dashed)
- VAH/VAL lines (blue dashed)
- Delta POC line (purple dashed)
- HVN/LVN highlights
- Absorption/rejection markers

---

## Bubble System

### States
| State | Visual | Meaning |
|-------|--------|---------|
| Accepted | Filled, glowing | Aggression moved price |
| Rejected | Hollow ring + warning outline | Aggression failed |
| Absorbed | Secondary halo | Passive defense held |
| Exhausted | Faded | Large trade, no follow-through |
| Invalidated | Hidden | No longer relevant |

### Features
- Multiple bubbles per candle
- Placed at actual trade price
- Size proportional to notional
- Clustered when overlapping (+N label)
- Hover for full details

---

## Label Deconfliction

- Priority-based rendering
- Compact by default
- Detail on hover only
- Visual objects preferred over text
- Labels hide when zoomed out

---

## Zone Rendering

### Zone Types
- BUY/SELL_ACCEPTANCE_ZONE
- BUY/SELL_REJECTION_ZONE
- BUY/SELL_ABSORPTION_ZONE

### Visual
- Low opacity horizontal bands
- Right-side compact labels
- Dashed borders
- Tooltip on hover
- Invalidated zones hidden (debug mode shows)

---

## Volume Profile Modes

1. **Session Profile** — All loaded data
2. **Visible Range** — What's on screen
3. **Selected Range** — User-drawn selection (highest priority)
4. **Current Impulse** — Auto-detected recent impulse

---

## Footprint Proxy

- Per 40s candle, per price bin
- Buy/sell volume, delta, imbalance ratio
- Largest print, absorption/rejection markers
- Labeled as "taker-side footprint proxy"
- Toggle on/off, compact mode

---

## Scanner

### Modes
- Pinned Fundamentals (BTC, ETH, SOL, BNB, XRP, SUI, DOGE)
- Volatility Watchlist (LAB, PLAY, CHIP, FHE, SKYAI, etc.)
- Full Market
- Top Movers / Volatility / Bubbles / Absorption

### Status Tags
| Tag | Meaning |
|-----|---------|
| WAKING_UP | Activity increasing |
| EXPANDING | Volatility expanding |
| HIGH_ATTENTION | Heavy trading |
| AGGRESSIVE_BUY_FLOW | Strong buy delta |
| AGGRESSIVE_SELL_FLOW | Strong sell delta |
| ABSORPTION_ACTIVE | Passive defense detected |
| REJECTION_CLUSTER | Multiple rejections |
| CHAOTIC | High vol + many bubbles |
| THIN | Low volume |
| GOOD_FLOW | Normal |

**Not signals.** Only indicate where to inspect.

---

## API Endpoints (all read-only)

| Endpoint | Description |
|----------|-------------|
| `GET /sources/status` | Source connection status |
| `GET /scanner/overview?mode=...` | Scanner data |
| `GET /symbols/overlap` | HL↔Binance mapping |
| `GET /orderflow/candles?symbol=X&interval=40s` | Candle data |
| `GET /orderflow/bubbles?symbol=X` | Bubble data |
| `GET /orderflow/zones?symbol=X` | Zone data |
| `GET /orderflow/profile/selected?...` | Selected range profile |
| `GET /orderflow/profile/visible?...` | Visible range profile |
| `GET /orderflow/footprint?symbol=X` | Footprint proxy |
| `GET /orderflow/asset-context?symbol=X` | Symbol context |

---

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│ [Source][Symbol][Interval][Status][Exec][Quality] [Live] │
├────┬────────────────────────────────────┬────────────────┤
│    │                                    │ Auction State  │
│ T  │                                    │                │
│ O  │         MAIN CHART                 │ Selected Range │
│ O  │      (40s candles)                 │ Analysis       │
│ L  │                                    │                │
│ S  │     bubbles + zones + drawings     │ Bubble Details │
│    │     + range profile overlay        │                │
│    │                                    │ Active Zones   │
│    │                                    │                │
│    │                                    │ Source/Quality │
├────┴────────────────────────────────────┴────────────────┤
│ [Scanner] [Time&Sales] [Footprint]                       │
│  symbol table with status tags                           │
└──────────────────────────────────────────────────────────┘
```

---

## Local State

User drawings stored in localStorage:
- Horizontal lines
- Rectangles
- Text annotations
- Selected ranges

No backend persistence yet.

---

## Remaining Limitations

1. **Canvas rendering only** — no WebGL (sufficient for <2000 candles)
2. **No order book depth** — l2Book subscribed but not rendered
3. **No execution** — by design
4. **No backtesting** — by design
5. **No alerts** — not requested
6. **Single timeframe** — no multi-chart layout yet
7. **No saved layouts** — future enhancement

---

## How to Run

```bash
cd orderflow-cockpit
npm install
npm start
```

Open `http://localhost:3777`

The server connects to Hyperliquid and Binance automatically.
Select a symbol from the scanner or type one in the search box.
Default: BTC on 40-second candles.

---

## Acceptance Criteria ✅

| # | Criteria | Status |
|---|----------|--------|
| 1 | 40-second candles | ✅ |
| 2 | Zoom and pan | ✅ |
| 3 | Custom range selection | ✅ |
| 4 | Selected range volume profile | ✅ |
| 5 | Selected range delta profile | ✅ |
| 6 | POC, VAH, VAL, Delta POC | ✅ |
| 7 | Bubble labels don't overlap | ✅ |
| 8 | Bubble clustering | ✅ |
| 9 | Zone horizontal bands | ✅ |
| 10 | Volatile symbol scanner | ✅ |
| 11 | HL/Binance symbol mapping | ✅ |
| 12 | Source truth visible | ✅ |
| 13 | Spot fallback labeled | ✅ |
| 14 | No signals | ✅ |
| 15 | No execution | ✅ |
