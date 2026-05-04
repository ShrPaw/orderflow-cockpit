# ORDERFLOW DEEPCHART-STYLE MAX REBUILD REPORT

## What Was Broken

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | "Select a symbol to begin" persists | REST response never set `state.symbol`; WS message could be delayed | Set `state.symbol` immediately in REST callback |
| 2 | Chart goes blank after interaction | Reconnect cleared all data; empty snapshot race condition | Historical backfill on every symbol select; retry logic |
| 3 | Candles stop loading | Candle engine not receiving trades for new symbol; no confirmation | Parallel REST+WS subscription; historical injection |
| 4 | Zoom feels wrong (vertical-only) | Wheel zoom only changed time axis (scaleX), never price axis | Default wheel now zooms BOTH axes proportionally |
| 5 | Scanner shows "No data yet" | Required BOTH HL and Binance hydration | Now works with HL-only; Binance hydration shown as bonus |
| 6 | Bubbles look generic | Flat circles with 0.45 alpha, no depth | Concentric ring rendering with radial gradients, glow, cores |
| 7 | "B×3" cluster labels unclear | Didn't show side or state | Now shows ▲3 (buy) or ▼2R (sell rejected) |
| 8 | 1m historical mixed with 40s live | No visual distinction | Historical candles rendered dimmer, marked with _historical flag |
| 9 | Binance Spot in UI dropdown | Source-select showed Spot as option | Removed source-select entirely; HL is the only read source |
| 10 | Vague "B.Futures connected" | Single boolean for all Binance status | Split into: reference connected, aggTrade receiving, forceOrder, bookTicker, markPrice |
| 11 | profile-engine priceRange bug | `priceRange: { low: rangeHigh, high: rangeHigh }` | Fixed to `{ low: pLow, high: pHigh }` |
| 12 | Symbol check endpoint missing | No way to verify symbol availability | Added `/api/symbols/check` with HL+BN validation |

---

## Source Architecture

### Hyperliquid — Primary Read Source
- Live trades via WebSocket (all 230+ perps)
- l2Book for order book depth
- Historical candles via REST `/info` endpoint
- Bubble generation from trade data
- Zone detection from candle patterns
- Selected range volume/delta profile

### Binance USD-M — Manual Execution/Reference
- Symbol universe (567 perps) via REST `/fapi/v1/exchangeInfo`
- Symbol mapping: HL coin → Binance USD-M symbol
- aggTrade stream for reference price
- Special mappings: PEPE→1000PEPEUSDT, LUNC→1000LUNCUSDT, etc.

### Binance Spot — Debug Only
- Disabled by default
- Never automatic fallback
- Not shown in UI
- `spotDebugEnabled` flag on server only

### Source Truth in UI
```
Read source: Hyperliquid
HL connected: yes
HL trades sub: yes
HL book sub: active
Exec ref: Binance USD-M BTCUSDT
BN reference: connected
BN aggTrade: receiving
BN forceOrder: not active
BN bookTicker: not active
BN markPrice: not active
Spot debug: disabled
```

---

## Why Spot Fallback Was Removed

Binance Spot is not useful for perp orderflow analysis:
- Different liquidity profile
- Different participant mix
- No funding rate
- No liquidation data
- Would mislead the user about execution venue

---

## Symbol Loading — Bulletproof Flow

### Startup
1. Server connects to Hyperliquid WebSocket
2. Server fetches HL universe (230 perps)
3. Server fetches Binance USD-M universe (567 perps)
4. BTC auto-loaded after 2 seconds
5. Historical candles fetched from HL REST

### Symbol Switch
1. Frontend sets `state.symbol` immediately (no WS delay)
2. REST call to `/api/select-symbol` (primary)
3. WS `subscribe_symbol` (parallel)
4. Historical candles fetched from `/api/history`
5. If REST fails, WS fallback
6. If history unavailable, "Building live history" message

### Error Handling
- Unknown symbol: "Symbol BTC not found on Hyperliquid"
- Source disconnected: "Hyperliquid WebSocket not connected — retrying..."
- No trades: "Building 40s candles — waiting for trades..."
- Network error: "REST error: ... Using WS fallback."

---

## 40-Second Candle System

### Supported Intervals
- 10s, 20s, 40s (default), 1m, 3m, 5m

### Each Candle Contains
- open, high, low, close
- volume, buyVolume, sellVolume, delta
- tradeCount, maxTradeSize, largeTradeCount
- bubbleCount, absorptionCount, rejectionCount
- priceMap (per-level footprint)
- bubbles (classified aggression prints)

### Interval Switching
- Trade buffer (10,000 trades per symbol)
- Rebuilds candles from buffer on switch
- No data loss

### Historical Context
- 1m candles from Hyperliquid REST API
- Injected into candle engine per symbol
- Marked with `_historical` flag
- Preserved across symbol switches

---

## Chart Interaction — Professional Zoom

### Controls
- **Wheel**: Zooms BOTH time and price axes around cursor
- **Ctrl+wheel**: Price-only zoom around cursor
- **Shift+wheel**: Horizontal pan
- **Drag**: Pan both axes
- **Fit All**: Reset to show all data
- **Reset View**: Default zoom/pan
- **Follow Live**: Auto-scroll with latest candle

### Behavior
- Manual zoom/pan → Follow Live turns OFF
- Follow Live ON → chart scrolls with latest candle
- No chart blanking after interaction
- No JS errors from tool switching
- Zoom buttons now affect both axes

---

## Deepchart/dxFeed-Style Bubble Circles

### Visual Design

| State | Visual | Meaning |
|-------|--------|---------|
| Accepted | Concentric rings: outer halo (gradient fade) → main fill → inner bright core → solid border | Aggression moved price |
| Rejected | Hollow circle + sharp outer ring + faint warning outline | Aggression failed — liquidity held |
| Absorbed | Large halo/aura + inner circle + ring | Passive defense held — reversal zone |
| Exhausted | Low opacity fill + dashed ring | Momentum fading |
| Invalidated | Hidden (debug: ghost) | No longer relevant |

### Placement
- X = exact candle position
- Y = exact traded price
- Multiple bubbles per candle allowed
- Stacks along candle body/wick by price

### Size
- `radius = min(18, max(4, sqrt(notional / 500)))`
- $50K trade → radius ~10px
- $500K trade → radius ~18px (capped)
- Minimum 4px for visibility

### Clustering
- Groups by: same candle + same price band + same side + same state
- Aggregate circle with combined notional
- Label: direction icon + count + state
  - `▲3` = 3 buy accepted
  - `▼2R` = 2 sell rejected
  - `▲1Ab` = 1 buy absorbed
- Hover tooltip shows full breakdown

---

## Label Deconfliction

### Priority
1. Selected object
2. Hovered object
3. Selected range profile labels (POC, VAH, VAL, ΔPOC)
4. Active zones
5. Recent absorbed/rejected bubbles
6. Recent accepted bubbles
7. Old/exhausted bubbles

### Modes
- **compact** (default): Cluster badges + zone labels
- **detailed**: Individual bubble notional values
- **minimal**: Price scale and crosshair only

### Algorithm
- Tests label position against all placed labels
- Shifts vertically to non-overlapping position
- Max 15 attempts before hiding

---

## Selected Range Volume/Delta Profile

### How to Use
1. Press `R` or select Range tool from toolbar
2. Drag from price A to price B
3. Profile computed immediately
4. Chart shows overlay with histogram + POC/VAH/VAL/ΔPOC

### Computed Metrics
- Volume profile: POC, VAH, VAL, HVN, LVN, volume gaps
- Delta profile: delta POC, max positive/negative delta, stacked imbalances
- Range metrics: VWAP, directional efficiency, close location
- Bubble metrics: accepted/rejected/absorbed/exhausted counts
- Interpretation: human-readable (no signals)

### Visual
- Horizontal volume bars in selected range
- Delta overlay (green/red)
- POC line (gold dashed)
- VAH/VAL lines (blue dashed)
- Delta POC line (purple dashed)
- HVN/LVN highlights

---

## Scanner Improvements

### Modes
- Pinned Fundamentals (BTC, ETH, SOL, BNB, XRP, SUI, DOGE, HYPE)
- Volatility Watchlist (LAB, ORCA, PLAY, CHIP, FHE, SKYAI, NAORIS, BIO, TAG, XNY, ZEREBRO, AIXBT, KNC, UBSB, BSB, 1000LUNC)
- Full Hyperliquid universe
- HL/Binance Overlap
- Top Attention
- Top Volatility
- Top Bubble Activity
- Top Absorption/Rejection

### Status Tags
- QUIET, WAKING_UP, EXPANDING, HIGH_ATTENTION
- AGGRESSIVE_BUY_FLOW, AGGRESSIVE_SELL_FLOW
- ABSORPTION_ACTIVE, REJECTION_CLUSTER
- CHAOTIC, THIN, GOOD_FLOW, SOURCE_LIMITED

### Symbol Check Endpoint
```
GET /api/symbols/check?symbol=LAB

{
  "ok": true,
  "symbol": "LAB",
  "existsOnHyperliquid": false,
  "existsOnBinanceUsdm": true,
  "mappedSymbol": "LABUSDT",
  "matchType": "standard",
  "confidence": "bn_only"
}
```

---

## Limitations

1. **40s candles not available from Hyperliquid REST** — historical data comes as 1m. Live 40s candles build from real-time trades.
2. **LAB and ORCA not on Hyperliquid** — they exist on Binance USD-M but not on HL. Scanner shows them with "bn_only" confidence.
3. **No persistent server state** — all data is in-memory. Server restart loses candle history.
4. **No WebGL** — Canvas2D rendering. Sufficient for <2000 candles.
5. **No execution** — by design. App is read-only cockpit.
6. **No funding rate / OI** — not yet implemented. Scanner fields show null.
7. **No order book visualization** — l2Book subscribed but not rendered on chart.
8. **Binance aggTrade may not deliver data for all symbols** — some HL-only symbols won't have Binance reference.

---

## Run Instructions (Windows)

### Window 1 — Server
```
cd C:\Users\Nicolas\Desktop\orderflow-cockpit
git checkout main
git pull origin main
npm install
npm start
```

### Window 2 — API Test
```
curl http://localhost:3777/api/status
curl http://localhost:3777/api/scanner
curl http://localhost:3777/api/symbols/overlap
curl http://localhost:3777/api/symbols/check?symbol=BTC
curl http://localhost:3777/api/symbols/check?symbol=LAB
```

### Browser
```
http://localhost:3777
```

No Python server. No Flask. No localhost:3000. No demo/live.html.

---

## Validation Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | npm start works | ✅ |
| 2 | http://localhost:3777 opens | ✅ |
| 3 | BTC auto-loads | ✅ |
| 4 | No "No Symbol Loaded" after startup | ✅ |
| 5 | Candles visible within 10-20s | ✅ |
| 6 | Default interval is 40s | ✅ |
| 7 | Wheel zooms both time and price | ✅ |
| 8 | Follow live works | ✅ |
| 9 | Bubbles render as concentric circles | ✅ |
| 10 | Bubble clusters show direction + count | ✅ |
| 11 | No label overlap (deconfliction) | ✅ |
| 12 | Zones render as horizontal bands | ✅ |
| 13 | Selected range profile tool works | ✅ |
| 14 | POC/VAH/VAL visible for selected range | ✅ |
| 15 | Delta profile visible for selected range | ✅ |
| 16 | Scanner rows populate | ✅ |
| 17 | Clicking scanner row loads symbol | ✅ |
| 18 | LAB/ORCA availability checkable via API | ✅ |
| 19 | Spot fallback not active | ✅ |
| 20 | Source truth visible (detailed) | ✅ |
| 21 | No signals | ✅ |
| 22 | No execution | ✅ |
| 23 | No fake precision | ✅ |
