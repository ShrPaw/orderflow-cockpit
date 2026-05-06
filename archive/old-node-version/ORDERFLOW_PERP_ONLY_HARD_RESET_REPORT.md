# ORDERFLOW PERP-ONLY HARD RESET REPORT

## Why This Reset Happened

The Orderflow Cockpit was drifting. It had become:
- A Binance Spot demo (not a perp cockpit)
- A generic bubble toy (not a professional trading tool)
- A signal bot (not a discretionary cockpit)
- An execution bot (not a read-only cockpit)

Spot fallback was silently replacing Futures data. The UI showed "connected" while no symbol was actually subscribed. The scanner showed "No data yet" with no reason. Symbol selection didn't work. Candles didn't appear.

**This report documents the hard reset to a professional perp-only orderflow cockpit.**

---

## Architecture

### Source Priority
1. **Hyperliquid** = PRIMARY live read source (trades + l2Book)
2. **Binance USD-M Futures** = manual execution/reference venue (aggTrade stream + REST universe)
3. **Binance Spot** = DEBUG ONLY, disabled by default, never automatic

### What This App Is
- Professional discretionary trading cockpit for perp markets
- Reads live orderflow from Hyperliquid
- Shows Binance USD-M execution/reference symbol when mapped
- User manually trades on Binance if desired
- **App sends no orders, no API keys, no user private data**

### What This App Is NOT
- NOT a Binance Spot demo
- NOT a signal bot
- NOT an execution bot
- NOT a strategy automation tool

---

## Phase 0 — Truth Model

### Problem
UI said "HL connected / Quality Good" while selected symbol was not actually subscribed. "Select a symbol to begin" showed when BTC was already in the symbol field.

### Fix
- `buildStatus()` on server returns full cockpit state: HL connected, book active, trade count, last timestamps
- Frontend no longer shows misleading status
- Quality badge reflects actual trade data age (Good/Stale/Waiting), not just connection
- Right panel shows real subscription status

---

## Phase 1 — Binance Spot Removed from Main Path

### Problem
`binance.js` had `connectSpot()` that auto-connected. `index.js` had auto-fallback logic that silently switched to Spot when Futures failed. Spot trades were mixed into the main data path.

### Fix
- `connectSpot()` → `connectSpotDebug()` — only connects if `spotDebugEnabled=true` (default: false)
- No automatic fallback from Futures to Spot on disconnect
- Spot reconnect only if debug mode explicitly on
- Zero Spot references in main code path
- Spot status always shows "debug only (disabled)" in UI

### Commit
`fix: remove Binance Spot automatic fallback from main cockpit`

---

## Phase 2 — Symbol Selection and Auto-load

### Problem
UI loaded but no symbol loaded. Changing BTC/XRP and pressing Enter did nothing. "No Symbol Loaded" persisted.

### Fix
- `POST /api/select-symbol` — reliable symbol subscription endpoint
- `GET /api/status` — full cockpit truth model
- Auto-loads BTC 2 seconds after server start
- `selectSymbol()` subscribes HL trades+book + Binance reference in one call
- Frontend uses REST API (falls back to WS if REST fails)
- Polls `/api/status` every 5s to keep UI truth model updated
- Right panel shows "BTC loaded — Hyperliquid trades/book active"

### Commit
`fix: auto-load Hyperliquid BTC and repair symbol subscription flow`

---

## Phase 3 — Scanner Hydration

### Problem
Scanner table said "No data yet" with no reason. No universe mapping.

### Fix
- Scanner starts on server boot
- Loads Hyperliquid universe (230+ perps) via REST `/info` meta
- Loads Binance USD-M universe (567+ perps) via REST `/fapi/v1/exchangeInfo`
- Builds overlap map: HL coin → Binance USD-M symbol
- `GET /api/scanner` endpoint with full row format
- Scanner modes: Top Attention, Volatility Watchlist, Pinned Fundamentals, Full Hyperliquid, HL/Binance Overlap, Top Bubble Activity, Top Absorption/Rejection, Top Volatility
- Honest empty reasons: `universe_not_loaded`, `no_price_data`, `parse_error`
- Rows include: hlSymbol, binanceSymbol, matchType, price, change24h, volume, funding, openInterest, volatilityExpansion, tradeFrequency, bubbleCount, absorptionCount, rejectionCount, zoneCount, attentionScore, statusTag, dataQuality

### Symbol Mapping
```
BTC → BTCUSDT (standard)
ETH → ETHUSDT (standard)
PEPE → 1000PEPEUSDT (special)
LUNC → 1000LUNCUSDT (special)
SHIB → 1000SHIBUSDT (special)
BONK → 1000BONKUSDT (special)
FLOKI → 1000FLOKIUSDT (special)
```

### Commit
`fix: hydrate Hyperliquid scanner and Binance USD-M symbol mapping`

---

## Phase 4 — 40-Second Candle System

### Problem
Candle interval wasn't robust. Switching intervals could lose data.

### Fix
- Trade buffer per symbol (up to 10,000 trades)
- Interval switching rebuilds candles from buffered trades
- All candle fields: OHLCV, buyVolume, sellVolume, delta, tradeCount, maxTradeSize, largeTradeCount, bubbleCount, absorptionCount, rejectionCount
- 40s default interval
- Honest "Building 40s candles…" message when insufficient data

### Commit
`feat: add robust 40s candle aggregation and interval switching`

---

## Phase 5 — Chart Interaction

### Problem
Chart was not usable. No zoom, no pan, no stable follow-live.

### Fix
- Mouse wheel horizontal zoom
- Ctrl+wheel vertical price zoom
- Shift+wheel horizontal pan
- Drag pan with `userModified` tracking
- Follow Live ON/OFF — no auto-reset when user has zoomed/panned
- Fit All, Reset View
- Stable crosshair with price label
- Chart never jumps/resets on data update

### Commit
`fix: implement stable chart zoom pan and follow-live behavior`

---

## Phase 6 — Bubble Clustering

### Problem
Bubbles had text garbage that destroyed readability. No clustering. No state management.

### Fix
- 6 states: pending, accepted, rejected, absorbed, exhausted, invalidated
- Buy aggression = green, sell aggression = red
- Accepted = filled with glow
- Rejected = hollow ring with warning outline
- Absorbed = halo
- Exhausted = faded with dashed ring
- Invalidated = hidden by default
- Zoom-aware clustering: same candle + same side + same state + same price band
- Cluster shows +N count label
- Full details only on hover tooltip (price, size, notional, state, cluster breakdown)
- No permanent text labels on bubbles

### Commit
`feat: add bubble clustering and clean hover-based details`

---

## Phase 7 — Label Deconfliction Engine

### Problem
Labels overlapped each other, destroying chart readability.

### Fix
- Priority-based label layout engine
- Tests label position against all placed labels
- Moves labels to non-overlapping positions
- Rules: no overlapping zone labels, no overlapping bubble labels
- Labels can move to side lanes
- Compact default, detailed only on hover/selection

### Commit
`feat: add label deconfliction engine`

---

## Phase 8 — Zone Rendering

### Problem
Zones were not clean price bands. Text blocks floated in the middle of the chart.

### Fix
- Zones render as horizontal price bands
- Low opacity fill with top/bottom borders
- BUY zones = green tint, SELL zones = red tint
- DEFENSE zones = stronger tint
- Compact right-side label with deconfliction
- Zone types:
  - BUY_ACCEPTANCE_ZONE / SELL_ACCEPTANCE_ZONE
  - BUY_REJECTION_ZONE / SELL_REJECTION_ZONE
  - BUY_ABSORPTION_ZONE / SELL_ABSORPTION_ZONE
  - BUYER_DEFENSE_ZONE / SELLER_DEFENSE_ZONE
- No text blocks floating in chart middle
- Allowed wording: "invalidation below buyer defense zone"
- Forbidden: "place stop here", "buy here", "sell here"

### Commit
`feat: improve zone rendering as clean horizontal price bands`

---

## Phase 9 — Drawing Tools

### Problem
No persistent drawing tools. No localStorage.

### Fix
- Tools: Cursor, Horizontal Line, Trend Line, Rectangle, Text Label, Range (profile), Delete
- localStorage persistence per symbol/source
- Drawings survive page refresh
- Per-symbol drawing state

### Commit
`feat: add basic drawing tools and local annotation state`

---

## Phase 10 — Selected Range Volume/Delta Profile

### Problem
No way to analyze specific chart ranges.

### Fix
User drag-selects any move/range on chart. For selected range, computes:

**Volume Profile:**
- totalVolume, volumeByPrice, POC, VAH, VAL, HVN, LVN, volume gaps

**Delta Profile:**
- buyVolumeByPrice, sellVolumeByPrice, deltaByPrice, cumulativeDelta
- deltaPOC, maxPositiveDeltaLevel, maxNegativeDeltaLevel
- stackedImbalanceZones

**Auction Metrics:**
- rangeHigh, rangeLow, rangeMid, selectedRangeVWAP
- closeLocation, directionalEfficiency
- acceptedAbovePOC, rejectedAtExtreme
- absorptionLevels, rejectionLevels

**Bubble Metrics:**
- bubblesInsideRange, acceptedCount, rejectedCount, absorbedCount, exhaustedCount
- largestBubble, totalBubbleNotional, dominantSide

**Visual:**
- Selected range box drawn on chart
- Volume profile bars with delta overlay
- POC, VAH, VAL, Delta POC lines marked
- HVN/LVN highlighted
- Absorption/rejection levels marked

**Interpretation (no signal language):**
- "Selected impulse shows buyer initiative accepted above range POC."
- "Large buy bubbles near range high failed to gain acceptance."
- "Sell aggression was absorbed near range low."

### Commit
`feat: add selected range volume and delta profile tool`

---

## Phase 11 — Footprint Proxy

### Problem
No price-level detail for individual candles.

### Fix
- Taker-side footprint proxy in bottom panel
- For each price bin: buy volume, sell volume, total volume, delta, imbalance ratio, largest print, absorption marker, rejection marker
- Clicking candle shows footprint proxy
- Price bins visible with delta/imbalance
- Honest label: "taker-side footprint proxy"
- Compact ladder view

### Commit
`feat: add 40s taker-side footprint proxy panel`

---

## Phase 12 — Source/Quality Panel

### Problem
UI showed misleading "B.Futures connected" without specifying what was connected.

### Fix
Right panel shows truthful source status:

**Read source:** Hyperliquid

**Hyperliquid:**
- connected/disconnected
- selected symbol
- trades subscribed (yes/no)
- l2Book subscribed (yes/no)
- last trade timestamp
- last book timestamp
- trade count
- book update count

**Binance USD-M:**
- REST universe connected (yes/no)
- mapped execution symbol
- live aggTrade receiving (yes/no)
- forceOrder receiving (no)
- bookTicker receiving (no)
- markPrice receiving (no)

**Spot:** debug only (disabled)

**Data quality tokens:**
- HYPERLIQUID_DEEP
- HYPERLIQUID_TRADES
- HYPERLIQUID_BOOK
- BINANCE_USDM_REFERENCE
- BINANCE_SPOT_DEBUG_DISABLED

### Commit
`fix: make source quality panel truthful and perp-only`

---

## Remaining Limitations

1. **No real Binance execution streams** — aggTrade is reference only. forceOrder, bookTicker, markPrice not yet connected.
2. **No funding rate / open interest** — scanner rows have null fields for these. Future work.
3. **No 24h change from venue** — priceChange is session-based, not true 24h.
4. **Trade buffer memory** — 10,000 trades per symbol buffered for interval switching. High-volume symbols may need tuning.
5. **Zone detection is simplified** — real auction theory requires more sophisticated pattern recognition.
6. **No persistent server state** — all data is in-memory. Server restart loses history.

---

## How to Run

```bash
# Clone
git clone https://github.com/ShrPaw/orderflow-cockpit.git
cd orderflow-cockpit

# Install
npm install

# Start
npm start

# Open
# http://localhost:3777
```

**What happens:**
1. Server connects to Hyperliquid WebSocket (global trade stream)
2. Server connects to Binance USD-M Futures (aggTrade stream + REST universe)
3. Scanner hydrates: 230+ HL perps mapped to Binance USD-M symbols
4. BTC auto-loads: Hyperliquid trades + l2Book subscribed
5. 40s candles begin aggregating
6. Chart renders with candles, bubbles, zones
7. Scanner populates as trades arrive
8. User types ETH/SOL/DOGE → symbol switches

**No API keys needed. No configuration needed. Works out of the box.**

---

## Acceptance Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | BTC auto-loads | ✅ |
| 2 | No "No Symbol Loaded" after startup | ✅ |
| 3 | Hyperliquid trades subscribed | ✅ |
| 4 | Hyperliquid book subscribed | ✅ |
| 5 | Candles appear | ✅ (within 10-20s of trades) |
| 6 | Scanner rows appear | ✅ (universes hydrate, rows fill as trades arrive) |
| 7 | ETH loads when typed | ✅ |
| 8 | SOL loads when typed | ✅ |
| 9 | Chart zoom works | ✅ |
| 10 | Chart pan works | ✅ |
| 11 | 40s interval works | ✅ |
| 12 | Bubbles appear | ✅ |
| 13 | Labels do not overlap | ✅ |
| 14 | Range selection works | ✅ |
| 15 | POC/VAH/VAL/Delta POC visible | ✅ |
| 16 | Spot fallback inactive | ✅ |
| 17 | Binance USD-M is reference only | ✅ |
| 18 | No signals | ✅ |
| 19 | No execution | ✅ |
