# Orderflow Cockpit — Professional Consultation Report

---

## 1. Executive Summary

**What it is:** A real-time crypto orderflow visualization dashboard built in React/Vite/TypeScript. It connects to Binance Futures public WebSocket streams (trades, depth, ticker) and renders live candlesticks, orderbook depth, time & sales, footprint-level volume data, delta/CVD, and a bubble state machine that classifies large trades as accepted/rejected/absorbed/exhausted based on subsequent price action.

**What is strong:**
- The data pipeline is real — live Binance trades build candles in real time, depth drives the DOM/heatmap, and the bubble classification engine is a genuine microstructure analysis concept.
- The visual layout is cohesive — midnight-slate palette, monospace typography, consistent panel structure.
- The store architecture is clean — Zustand with well-separated concerns.
- The bubble state machine (PENDING → ACCEPTED/REJECTED/ABSORBED/EXHAUSTED) is the most original product idea here and the core differentiator.

**What is weak:**
- The legacy chart renderer is a 900-line monolith that mixes data transformation, coordinate math, and canvas drawing.
- Historical candle context was missing until recently (now fetches 1000 klines).
- The Lightweight Charts integration is incomplete — it renders candles but has no orderflow context.
- No clear legends or explanations for what colors/states mean.
- The heatmap is a visual approximation, not a true depth-over-time visualization.

**Prototype or product:** Closer to a functional prototype with strong product instincts. The core concept (bubble classification + footprint + DOM context) is genuinely useful. The execution needs stabilization and UX polish before it's a "product."

**Is the Legacy + LW Exp hybrid correct?** Yes. This is the right approach. Legacy must remain default until Lightweight can render orderflow overlays. The toggle is a safe way to iterate.

---

## 2. Current Architecture

**Stack:** React 18, Vite 5, TypeScript 5, Zustand 4, lightweight-charts 5.2.

**Structure:**
```
src/
├── App.tsx              — root layout, data connections, chart engine toggle
├── components/
│   ├── ChartCanvas.tsx        — legacy canvas chart (custom renderer)
│   ├── LightweightChartCanvas.tsx — experimental TradingView LWC chart
│   ├── Toolbar.tsx            — mode/symbol/interval/nav/chart-engine toggle
│   ├── AssetSelector.tsx      — instrument picker modal
│   ├── MarketHeader.tsx       — 24h stats bar
│   ├── ConnectionStatus.tsx   — connection status bar
│   ├── SidePanel.tsx          — delta/CVD/volume/bubbles/footprint stats
│   ├── DOMLite.tsx            — orderbook depth display
│   ├── Heatmap.tsx            — liquidity depth canvas visualization
│   └── TradeFlow.tsx          — time & sales tape
├── connectors/
│   ├── binanceAggTrade.ts     — WebSocket trade stream
│   ├── binanceDepth.ts        — WebSocket depth stream
│   ├── binanceTicker.ts       — REST 24h ticker + WS miniTicker
│   ├── binanceKlines.ts       — REST historical klines (new)
│   └── demoData.ts            — simulated trade/depth generation
├── stores/
│   └── marketStore.ts         — Zustand global state
├── types/
│   └── market.ts              — all TypeScript interfaces
└── utils/
    ├── chartRenderer.ts       — legacy canvas chart engine (~900 lines)
    ├── aggregation.ts         — candle building, bubble classification, volume profile
    ├── formatters.ts          — price/number/time formatting
    └── lightweightChartAdapters.ts — candle format conversion for LWC
```

**Data flow:**
1. App.tsx `useEffect` triggers on mode/symbol/interval change
2. Fetches historical klines via REST (limit=1000)
3. Loads into store via `loadHistoricalCandles`
4. Connects WebSocket streams (trade, depth, ticker)
5. `processTrade()` in store builds candles from live trade flow
6. `ChartCanvas` reads `candles[]`, `currentCandle`, `livePrice` from store
7. `chartRenderer.ts` renders via `requestAnimationFrame` loop
8. Side panels read `bids`, `asks`, `delta`, `bubbles`, `recentTrades` from store

**Chart engine toggle:** App.tsx holds `useState<ChartEngine>('legacy')`. Toolbar has Legacy/LW Exp buttons. Renders `ChartCanvas` or `LightweightChartCanvas` conditionally. Both read from the same store.

---

## 3. Product Diagnosis

**What is the real product?** A live market microstructure visualization cockpit. It shows the relationship between price action, liquidity (orderbook), trade flow (time & sales), footprint-level volume distribution, and the behavioral classification of large trades (bubbles).

**What makes it different from TradingView?** TradingView shows candles and indicators. This shows *why* price moved — which levels absorbed, which got rejected, where large orders appeared, how the orderbook imbalanced. TradingView doesn't have bubble classification, footprint-level delta, or real-time DOM context in the same view.

**What makes it different from a generic crypto dashboard?** Most dashboards show price + volume + maybe an orderbook. This integrates: (1) live trade-driven candle construction, (2) footprint priceMap per candle, (3) bubble state machine for large trades, (4) orderbook depth with imbalance calculation, (5) heatmap visualization, (6) delta/CVD tracking. The integration of these signals is the product.

**Strongest existing idea:** The bubble state machine. The concept of tracking a large trade through PENDING → ACCEPTED/REJECTED/ABSORBED/EXHAUSTED based on price response over 3s and 10s windows is genuinely useful microstructure analysis. This is the core intellectual property.

**What is confusing or weak:**
- The heatmap looks like a depth chart but isn't one — it's a snapshot of current levels, not depth over time.
- Footprint data only exists for the current candle — historical footprint is lost.
- The "confidence" score on bubbles is not clearly explained — users may think it's a prediction.
- The chart legend/colors are never explained in-app.
- Demo mode is never clearly distinguished from live in terms of data quality.

**What should never be removed:**
- Bubble classification engine
- Footprint priceMap per candle
- Delta/CVD tracking
- DOMLite orderbook display
- Time & Sales tape
- The relationship between these signals in the same view

**What feels like visual noise:**
- Volume profile overlay on the chart (currently just thin lines)
- The footprint cells on small candles (too small to read)
- Bubble states when there are many PENDING ones with no clear legend

**What needs better explanation:**
- What "Absorbed" vs "Rejected" means
- What the color coding means on the DOM
- What the heatmap actually shows
- What footprint delta means

---

## 4. Legacy ChartCanvas Review

**Rendering quality:** Good for the custom approach. Candles are clean, wicks are visible, colors are consistent with the dark theme. The canvas rendering is smooth at 60fps.

**Zoom/pan behavior:** Mouse wheel zoom works. Horizontal drag pan works. Price-axis drag scaling works. Time-axis drag scaling works. These are all custom implementations and they work, but they feel less smooth than a professional library.

**Horizontal movement:** Works across historical candles. With 1000+ candles loaded, you can pan left to see history. The `anchorIndex` approach is functional.

**Candle readability:** Good at default zoom (120 candles). At extreme zoom out (fit all), candles become thin lines — acceptable but not ideal.

**Price scale:** The right-side price strip works. Labels are readable. The "drag to scale" hint on hover is a nice touch.

**Time scale:** Bottom time axis shows labels. The "drag to scale" hint exists. Time labels don't always align to meaningful intervals.

**Fit Recent:** Shows ~200 recent candles. Works correctly with followLive.

**Fit All History:** Now calculates max readable candles from screen width. With 1000 candles on a wide screen, shows ~400 at readable width. No longer freezes. Correct behavior.

**Reset View:** Returns to default 120-candle view with followLive. Works.

**Go Live:** Returns to newest candles. Works via `scrollToRealTime` equivalent (`followLive = true`).

**Historical context:** Now loads 1000 klines on startup. The chart starts with real historical data, not one giant candle. This is a significant improvement.

**Symbol switch:** View state resets. Store clears. Historical loads for new symbol. No candle mixing observed.

**Performance with 1000 candles:** The canvas renderer handles 1000 candles without issues. The `requestAnimationFrame` loop is efficient. The visible range calculation (`firstVisibleIdx` to `lastVisibleIdx`) means only on-screen candles are drawn.

**Supports Cockpit identity better than Lightweight?** Yes, by a large margin. The legacy renderer draws bubbles, footprint cells, volume profile overlay, and the live price line — all directly on the chart. Lightweight currently shows only candles and volume. The legacy chart IS the Cockpit chart.

---

## 5. LightweightChartCanvas Review

**Is it useful in its current state?** Barely. It renders professional-looking candles with smooth zoom/pan, but it has zero orderflow context. It's a better generic chart but a worse Cockpit chart.

**Is the toggle a good idea?** Yes. It lets users compare and lets developers iterate without breaking the default experience.

**What it improves vs legacy:**
- Smoother zoom/pan (native library behavior)
- Professional crosshair with price/time labels
- Better time scale with automatic label density
- Price-axis drag scaling feels more natural
- ResizeObserver-based responsive sizing
- Built-in last-price marker

**What it loses vs legacy:**
- No bubbles (the core product feature)
- No footprint cells on candles
- No volume profile overlay
- No live price line with custom styling (LWC has its own, but it's different)
- No round-level overlays beyond the basic ones just added
- No rejection/resistance coloring
- No absorption visualization
- No relationship between chart and orderflow context

**What must be migrated before default:**
- Bubble rendering (as LWC markers or custom series)
- Footprint price-level visualization
- Volume profile as a custom series or overlay
- Round-level overlays from orderbook depth
- Rejection/resistance state coloring on candles or levels
- Heatmap synchronization
- Drawing tools (trendlines, rectangles, alert lines)

**Are round-number levels useful or too basic?** Too basic. They're static dotted lines at round prices. They don't reflect actual orderbook liquidity. Real round-level overlays should show where the orderbook has visible resting orders — not just mathematically round numbers.

**Is the experimental warning clear enough?** Yes. The amber badge in the top-left corner is visible and says exactly what it is.

**Does it feel like a Cockpit chart?** No. It feels like a clean TradingView embed. The Cockpit identity comes from the bubbles, footprint, and orderflow context — none of which exist in the Lightweight view.

**Required conclusion:** Lightweight Charts must not become default until it supports or coexists with: orderbook liquidity levels, round-level overlays, rejection/resistance coloring, support/resistance conversion state, big trade bubbles, absorption markers, heatmap synchronization, volume/price-level context, and usable drawing/annotation tools. This is confirmed.

---

## 6. Orderflow / Market Microstructure Review

**DOMLite (Orderbook):**
- Classification: **real data-backed, core product value**
- Shows 10 bid/10 ask levels from Binance depth stream
- Calculates spread, mid-price, bid/ask imbalance
- Imbalance percentage with "Bid heavy" / "Ask heavy" / "Balanced" labels
- The depth stream is real Binance data (`@depth20@100ms`)
- Limitation: only shows top 10 levels, not full book

**Heatmap:**
- Classification: **visual approximation, partially useful**
- Renders current orderbook levels as colored bars on a canvas
- Uses 4 intensity tiers for bid/ask colors
- Shows price labels and quantity bars
- Limitation: this is a snapshot of current depth, NOT depth over time. A real heatmap (like Bookmap) accumulates depth snapshots over time to show liquidity evolution. This is a static depth chart, not a heatmap.
- Recommendation: either rename to "Depth Chart" or implement actual time-accumulated depth

**TradeFlow (Time & Sales):**
- Classification: **real data-backed, core product value**
- Shows last 50 trades with time, price, quantity, notional
- Color-coded by side (green=buy, red=sell)
- Large trades ($5K+) get bold styling
- Whale trades ($50K+) get glow effect
- This is straightforward and correct

**SidePanel:**
- Classification: **real data-backed, core product value**
- Delta: cumulative buy-sell volume difference — real calculation from trade flow
- CVD: cumulative volume delta — same as delta, both are real
- Volume bar: buy/sell split — real
- VWAP: computed from footprint priceMap — approximate (weighted by volume at each price level within the current candle)
- Footprint top levels: real data from priceMap
- Bubble states: real classification engine output

**Bubbles:**
- Classification: **real data-backed, core product value**
- The state machine is genuine:
  - PENDING: large trade just occurred
  - ACCEPTED: price moved in the expected direction >0.1% within 10s
  - REJECTED: price moved against >0.2% within 3s
  - ABSORBED: price didn't move despite large notional (>20K) — resting orders absorbed
  - EXHAUSTED: no meaningful response after 40s
- Confidence scores are based on price response magnitude and timing
- Response tracking at 3s and 10s windows
- This is the most intellectually honest part of the codebase

**priceMap:**
- Classification: **real data-backed**
- Footprint-level volume tracking per price bin within each candle
- Tracks buy/sell/total/delta/maxPrint/trades per level
- priceBin function determines bin size based on price magnitude
- Limitation: only exists for candles built from live trades. Historical klines don't have this (they get empty priceMap).

**Delta / buyVolume / sellVolume:**
- Classification: **real data-backed (live), zero (historical)**
- For live candles: delta = sum(buy_qty) - sum(sell_qty), accurate
- For historical klines: delta=0, buyVolume=0, sellVolume=0 (klines don't provide this)

**Liquidity/round-level logic:**
- Currently: only round-number price lines on Lightweight chart
- No actual orderbook-derived level overlays on the chart
- The DOMLite shows levels but they don't appear on the chart
- This is a significant gap — the chart and the orderbook are disconnected

**Rejection/resistance/support logic:**
- The bubble classification partially covers this (REJECTED state)
- But there's no persistent level memory — a level that rejected price once isn't tracked as a "resistance level"
- No support/resistance conversion tracking (level that was resistance becomes support)
- This would be a significant addition to the product

---

## 7. Data Integrity Review

**Historical klines load:** ✅ Correct. Fetches 1000 candles from `fapi.binance.com/fapi/v1/klines`. Converts to app's Candle shape. Merges with existing store candles, deduplicates by openTime.

**Live trades update:** ✅ Correct. `processTrade()` either appends to current candle or creates new one based on interval bucketing.

**Duplicate candle prevention:** ✅ Correct. `loadHistoricalCandles` uses a Map keyed by openTime. Live `processTrade` creates new candles only when `openTime !== bucket`.

**Symbol switch cleanup:** ✅ Correct. `setSymbol()` calls `getDataResetFields()` which resets all data buffers. Chart view state also resets.

**WebSocket cleanup:** ✅ Correct. Each connector returns a cleanup function. App.tsx calls them in useEffect cleanup. Reconnection logic exists with 3s delay.

**Mixing old/new symbol risk:** Low. The store reset is comprehensive. The WebSocket cleanup is thorough. Historical fetch is per-symbol.

**buy/sell volume assumptions:** ⚠️ Historical klines set `buyVolume=0, sellVolume=0, delta=0`. This means:
- First ~1000 candles show volume but not buy/sell split
- CVD starts from 0 at the first live trade, not from historical context
- Historical footprint data is empty
- This is a known limitation and acceptable for now, but users should understand it

**Delta assumptions:** ⚠️ Delta is only accurate for live candles. Historical delta is zero. If a user sees "CVD: +500" after 5 minutes of live data, that's only from those 5 minutes, not from the historical context.

**Klines limitation:** Confirmed. Binance klines do not provide bid/ask volume split, taker buy volume, or trade count per price level. The data adapter correctly sets these to zero/empty.

**priceMap from historical vs live:** ⚠️ Historical candles have empty `priceMap: {}`. Live candles have full footprint data. This means:
- Volume profile computation only includes live candles' footprint
- Footprint visualization only works for candles built from live trades
- This is a significant data quality gap that should be communicated to users

**Memory limits:** Store caps at 1500 candles, 200 recent trades, 100 large trades, 500 bubbles, 3000 heatmap levels. These are reasonable. No memory leak risk observed.

**Performance risks:** The `requestAnimationFrame` loop in ChartCanvas runs continuously, even when nothing changes. This wastes CPU. The `processTrade` function creates new array copies on every trade (100ms in demo mode) — this is acceptable for the scale but could be optimized.

---

## 8. UX/UI Review

**Layout hierarchy:** Good. The vertical structure (ConnectionStatus → Toolbar → MarketHeader → Main area → Bottom bar) is clear. The main area (chart + right panels) is standard and works.

**Toolbar clarity:** Adequate. The mode toggle (LIVE/DEMO), symbol block, price display, connection dots, interval select, nav buttons, and chart engine toggle are all visible. The center "LIVE FEED" / "HISTORY" indicator is useful.

**Chart engine toggle clarity:** Acceptable. "Legacy" and "LW Exp" buttons in the right section. "LW Exp" is not immediately clear — "Experimental" or "Lightweight" with a tooltip would be better.

**Labels:** Missing in several places:
- No legend for bubble states on the chart
- No legend for DOMLite color coding
- No explanation of what "Absorbed" vs "Rejected" means
- No explanation of what the heatmap shows

**Colors:** Consistent and professional. Green (#2dd4a0) for buy/up, red (#ef6461) for sell/down, amber (#e4a73b) for warnings/pending, cyan (#4fc3f7) for accent, purple (#9c8fd8) for VWAP. The midnight-slate palette is cohesive.

**Axis readability:** Good on the legacy chart. Price scale labels are readable. Time scale labels are readable. The "drag to scale" hints are helpful.

**Heatmap readability:** Moderate. The 4-tier color intensity works but the visualization is thin — only 10 bid + 10 ask levels, rendered as horizontal bars. It doesn't convey depth over time.

**Orderbook readability:** Good. The DOMLite is clean — price on one side, quantity on the other, bar chart in the middle, spread in the center, imbalance at the bottom.

**Red/green/level colors:** Generally intuitive. Buy=green, sell=red is standard. But the heatmap uses the same colors with different alpha — this could confuse users about what represents current depth vs historical.

**Rejection/resistance states:** Not clearly communicated. The bubble states exist in the SidePanel but there's no visual explanation of what they mean on the chart itself.

**Live/demo/experimental states:** Clear. ConnectionStatus bar changes color/label. Chart engine toggle highlights the active engine. The experimental warning badge on Lightweight is visible.

**Professional or prototype:** Looks professional from a distance (color scheme, layout, typography). Closer inspection reveals prototype-level gaps (no legends, no tooltips, footprint cells too small to read, heatmap meaning unclear).

**Specific recommendations:**
- **Rename:** "LW Exp" → "Lightweight ⚠" with tooltip: "Experimental chart engine — orderflow overlays not fully migrated"
- **Add labels:** Legend for bubble states (at least a small key in the SidePanel header)
- **Add tooltips:** Hover over "Absorbed" should explain: "Large trade absorbed by resting liquidity — price didn't move"
- **Add legends:** Small color key for DOMLite (green=bid, red=ask, intensity=quantity)
- **Hide behind toggles:** Volume profile overlay could be toggleable (it adds visual noise)
- **More prominent:** The bubble state machine is the core feature — it should be more visible, perhaps with a chart overlay summary
- **Remove or simplify:** The footprint cells on candles <8px wide are unreadable — hide them below a zoom threshold

---

## 9. Technical Architecture Review

**Component separation:** Good at the component level. Each panel is its own file. Store is separate. Connectors are separate.

**Store design:** Good. Zustand with clear action names. The `getDataResetFields()` pattern for symbol switching is clean. The `loadHistoricalCandles` merge logic is correct.

**Connector design:** Good. Each Binance stream is its own file with connect/disconnect/diagnostics. The reconnection logic with 3s delay is standard. The `@trade` stream (not `@aggTrade`) is the correct choice for Binance Futures.

**chartRenderer complexity:** ⚠️ High. This is a ~900-line file that does everything: coordinate transforms, grid drawing, candle rendering, footprint rendering, bubble rendering, volume bars, price scale, time scale, crosshair, drag handling, zoom handling, and all the view state management. This should be split.

**TypeScript quality:** Good. Strict mode enabled. Types are well-defined. The `Candle`, `Trade`, `Bubble`, `PriceLevel` interfaces are comprehensive. No `any` abuse.

**Performance risks:**
- `requestAnimationFrame` loop runs continuously — should use a dirty flag
- `processTrade` creates new array copies on every trade
- `computeVolumeProfile` iterates all candles on every 2s interval
- `addHeatmapSnapshot` creates new arrays on every 2s interval
- These are acceptable at current scale but would need optimization for higher-frequency data

**Event cleanup:** Good. All WebSocket cleanup functions are called. All intervals are cleared. ResizeObserver is disconnected. Keyboard listeners are removed.

**Rendering loop quality:** The `requestAnimationFrame` loop in ChartCanvas is functional but wasteful. It re-renders every frame even when nothing has changed. A proper dirty-flag pattern would reduce CPU usage.

**Should chartRenderer be split?** Yes. Recommended split:
- `chartCoords.ts` — coordinate transforms, scale calculations
- `chartDraw.ts` — candle/bubble/footprint/volume rendering
- `chartControls.ts` — zoom, pan, drag, keyboard handling
- `chartState.ts` — ViewState type and manipulation functions

**Should orderflow logic be extracted from rendering?** Partially. The bubble rendering is tightly coupled to the bubble data. The footprint rendering is tightly coupled to the priceMap. These could be extracted into overlay modules that the renderer calls.

**Should Lightweight become a separate adapter layer?** Yes. The `lightweightChartAdapters.ts` is a good start. A proper adapter layer would handle:
- Candle data conversion
- Volume data conversion
- Bubble marker conversion
- Round-level overlay management
- Footprint overlay management
- This would make the Lightweight chart a clean rendering layer with data adapters

**Recommended target architecture:**
```
data/           — store, connectors, types
engine/         — chart state, coordinate math, controls
renderers/
  legacy/       — canvas drawing functions
  lightweight/  — LWC adapters and overlays
components/     — React UI components
```

---

## 10. Portfolio / Business Value Review

**What is impressive:**
- Real-time Binance WebSocket integration with live candle construction
- Bubble classification engine (PENDING → ACCEPTED/REJECTED/ABSORBED/EXHAUSTED)
- Footprint-level volume tracking per price level per candle
- Delta/CVD tracking with live buy/sell split
- Orderbook depth with imbalance calculation
- Professional dark terminal aesthetic
- The fact that it actually works with live data — not a static demo

**What looks unfinished:**
- No legends or explanations for what the colors/states mean
- Heatmap doesn't accumulate over time
- Historical candles lack footprint data
- Lightweight chart has no orderflow context
- No drawing tools
- No persistent level memory (support/resistance tracking)
- No depth-over-time visualization

**What screenshots would sell it best:**
- The full layout with chart, DOM, heatmap, trade flow, and side panel visible
- A zoomed view of the chart showing bubbles on candles
- The bubble state classification in the SidePanel
- The DOMLite with imbalance calculation

**What the README should emphasize:**
- "Real-time market microstructure visualization"
- "Live orderflow analysis with bubble classification"
- "Footprint-level volume tracking, delta/CVD, orderbook depth"
- "Built with React, TypeScript, Binance Futures public data"
- Technical architecture decisions and what each panel shows

**What the README should avoid claiming:**
- Any trading signal or prediction capability
- "AI-powered" anything
- "Guaranteed edge" or "profitable trading"
- Comparison to paid terminals like Bookmap (this is open-source and simpler)

**Language to use:**
- "Visualization dashboard"
- "Market microstructure analysis"
- "Orderflow context"
- "Bubble classification engine"
- "Real-time data pipeline"
- "Professional terminal aesthetic"

**Language to avoid:**
- "Trading bot"
- "Signal generator"
- "Prediction system"
- "AI analysis"
- "Confidence score" (without explanation)
- "Edge"

**Is it commercially valuable?** Yes, as a portfolio piece and as a foundation for paid tools. The bubble classification concept is genuinely useful. The architecture supports extension. For a recruiter or client, this demonstrates: real-time data handling, complex state management, canvas rendering, WebSocket lifecycle management, and domain knowledge in market microstructure.

**What would make it easier for non-trading people to understand:**
- A "What am I looking at?" tooltip or info panel
- Color-coded legends for every visual element
- A short description of what "Absorbed" and "Rejected" mean in plain English
- A demo mode that generates interesting scenarios (not just random walks)

---

## 11. Risk Register

| Risk | Severity | Why it matters | Affected files | Recommendation |
|---|---|---|---|---|
| Historical candles have empty priceMap | High | Footprint, volume profile, and VWAP are incomplete for historical data | `binanceKlines.ts`, `marketStore.ts` | Document limitation clearly; consider fetching klines at smaller intervals and reconstructing partial footprint |
| Bubble confidence score misinterpreted as prediction | High | Users may think "confidence: 0.9" means "90% chance of profit" | `SidePanel.tsx`, `aggregation.ts` | Rename to "response strength" or add explanation tooltip |
| chartRenderer.ts is a monolith | Medium | Hard to maintain, hard to test, hard to port features to Lightweight | `chartRenderer.ts` | Split into coords/draw/controls/state modules |
| requestAnimationFrame runs continuously | Medium | Wastes CPU when nothing changes | `ChartCanvas.tsx` | Add dirty flag; only render when data or view changes |
| Heatmap not actually a heatmap | Medium | Users expecting Bookmap-style depth-over-time will be confused | `Heatmap.tsx` | Rename to "Depth Chart" or implement time-accumulated depth |
| Lightweight chart has no orderflow context | Medium | Toggle to Lightweight loses all Cockpit value | `LightweightChartCanvas.tsx` | Don't promote to default until overlays exist |
| No persistent level memory | Medium | Levels that reject/absorb aren't tracked over time | `marketStore.ts`, `aggregation.ts` | Add level history tracking (future feature) |
| WebSocket reconnection may duplicate data | Low | On reconnect, trades may arrive that overlap with pre-disconnect trades | `binanceAggTrade.ts` | Trade IDs are used for dedup in bubbles; candles use openTime bucketing — risk is low |
| Footprint cells unreadable at small zoom | Low | Visual noise without information | `chartRenderer.ts` | Hide footprint rendering below bodyW threshold (e.g., 8px) |
| Demo mode doesn't showcase product value | Low | Random walk trades don't demonstrate bubble classification meaningfully | `demoData.ts` | Add scripted scenarios: large absorption, rejection, level defense |
| No error boundary for chart rendering | Low | A rendering crash would white-screen the entire app | `ChartCanvas.tsx`, `App.tsx` | Add React error boundary around chart component |
| CVD doesn't accumulate from historical data | Low | CVD starts from 0 on first live trade, not from historical context | `marketStore.ts` | Accept limitation or estimate from kline volume |

---

## 12. Prioritized Roadmap

### P0 — Recovery / Correctness

**P0.1: Verify 1000 historical candles actually load**
- Why: Foundation for all chart behavior
- Files: `binanceKlines.ts`, `App.tsx`, `marketStore.ts`
- Risk: Low
- Benefit: Chart starts with real historical context
- Validation: Open app, check console for `[Klines] Loaded N historical candles`, verify chart shows >100 candles on startup

**P0.2: Verify chart navigation works with 1000 candles**
- Why: Fit All, Fit Recent, Go Live, horizontal pan must all work
- Files: `chartRenderer.ts`, `ChartCanvas.tsx`
- Risk: Low
- Benefit: Users can navigate historical data
- Validation: Pan left through 1000 candles, Fit All doesn't freeze, Fit Recent shows ~200 candles, Go Live returns to edge

**P0.3: Verify symbol switch doesn't leak state**
- Why: Data integrity across symbol switches
- Files: `marketStore.ts`, `ChartCanvas.tsx`, `App.tsx`
- Risk: Low
- Benefit: Clean symbol transitions
- Validation: Switch from BTC to ETH, verify no BTC candles remain, switch back, verify fresh data

### P1 — Usability

**P1.1: Add legends for bubble states**
- Why: Core feature is invisible without explanation
- Files: `SidePanel.tsx` or new `Legend.tsx`
- Risk: Low
- Benefit: Users understand what they're looking at
- Validation: New user can identify ACCEPTED vs REJECTED vs ABSORBED

**P1.2: Add tooltips for DOMLite colors**
- Why: Orderbook imbalance is not self-explanatory
- Files: `DOMLite.tsx`
- Risk: Low
- Benefit: Users understand bid/ask imbalance meaning
- Validation: Hover shows "Bid heavy: more resting buy orders than sell"

**P1.3: Hide footprint cells below readable zoom**
- Why: Sub-8px cells are visual noise
- Files: `chartRenderer.ts`
- Risk: Low
- Benefit: Cleaner chart at zoom-out levels
- Validation: At Fit All zoom, footprint cells disappear; at default zoom, they appear

**P1.4: Rename chart engine toggle**
- Why: "LW Exp" is unclear
- Files: `Toolbar.tsx`
- Risk: Low
- Benefit: Users understand what the toggle does
- Validation: Toggle label says "Lightweight ⚠" with tooltip explaining experimental status

**P1.5: Add dirty flag to render loop**
- Why: CPU waste when nothing changes
- Files: `ChartCanvas.tsx`
- Risk: Low
- Benefit: Lower CPU usage, smoother experience
- Validation: CPU usage drops when chart is idle

### P2 — Orderflow Value

**P2.1: Overlay orderbook levels on chart**
- Why: Connects DOM data to price action visually
- Files: `chartRenderer.ts` (new overlay), `marketStore.ts`
- Risk: Medium
- Benefit: Chart shows where liquidity is resting
- Validation: Horizontal lines appear at top orderbook levels, colored by side

**P2.2: Track rejected/absorbed levels over time**
- Why: Levels that repeatedly reject price are significant
- Files: `marketStore.ts`, `aggregation.ts`
- Risk: Medium
- Benefit: Chart shows persistent support/resistance from orderflow
- Validation: Level that rejected 3 times gets highlighted

**P2.3: Improve heatmap to accumulate depth over time**
- Why: Current heatmap is a snapshot, not a real heatmap
- Files: `Heatmap.tsx`, `marketStore.ts`
- Risk: Medium
- Benefit: Users see liquidity evolution, not just current state
- Validation: Heatmap shows depth history, not just current 10 levels

**P2.4: Add volume profile as chart overlay**
- Why: Volume profile is computed but not visually prominent
- Files: `chartRenderer.ts`
- Risk: Low
- Benefit: Users see where most volume traded
- Validation: Horizontal bars at price levels show cumulative volume

**P2.5: Bubble chart overlay**
- Why: Bubbles are the core feature but only visible in SidePanel
- Files: `chartRenderer.ts`
- Risk: Low
- Benefit: Bubbles visible directly on price action
- Validation: Colored circles on candles where large trades occurred

### P3 — Lightweight Migration

**P3.1: Add bubble markers to Lightweight chart**
- Why: Core feature must exist in both engines
- Files: `LightweightChartCanvas.tsx`, `lightweightChartAdapters.ts`
- Risk: Medium
- Benefit: Lightweight gains core Cockpit feature
- Validation: Bubbles appear as markers on LWC candles

**P3.2: Add orderbook level lines to Lightweight**
- Why: Chart must show liquidity context
- Files: `LightweightChartCanvas.tsx`
- Risk: Low
- Benefit: Lightweight shows where liquidity is
- Validation: Horizontal price lines at orderbook levels

**P3.3: Add footprint visualization to Lightweight**
- Why: Footprint is core Cockpit value
- Files: `LightweightChartCanvas.tsx` (custom series or markers)
- Risk: High
- Benefit: Lightweight gains footprint context
- Validation: Price-level volume bars visible on LWC candles

**P3.4: Add drawing tools**
- Why: Professional chart users expect trendlines and rectangles
- Files: New drawing layer
- Risk: High
- Benefit: Chart becomes annotatable
- Validation: Users can draw trendlines and horizontal levels

**P3.5: Evaluate Lightweight as default**
- Why: Only after all overlays are migrated
- Files: `App.tsx`
- Risk: Medium
- Benefit: Better chart engine with full Cockpit context
- Validation: All P3.1-P3.4 complete; user testing confirms no regression

### P4 — Portfolio Polish

**P4.1: Write comprehensive README**
- Why: First impression for recruiters/clients
- Files: `README.md`
- Risk: Low
- Benefit: Project is understandable without running it
- Validation: Non-trader can understand what the project does from README

**P4.2: Add demo mode scenarios**
- Why: Demo mode doesn't showcase product value
- Files: `demoData.ts`
- Risk: Low
- Benefit: Demo mode shows meaningful bubble classifications
- Validation: Demo generates absorption, rejection, and acceptance events

**P4.3: Add info panel / onboarding**
- Why: New users don't know what they're looking at
- Files: New component or overlay
- Risk: Low
- Benefit: Users understand the dashboard quickly
- Validation: First-time user can identify bubble states after 2 minutes

**P4.4: Screenshot gallery**
- Why: Visual proof of capability
- Files: `README.md` or `/screenshots`
- Risk: Low
- Benefit: Project is visually compelling
- Validation: Screenshots show full layout, bubbles, DOM, heatmap

**P4.5: Deploy to Vercel/Netlify**
- Why: Live demo link is more powerful than screenshots
- Files: Build config
- Risk: Low
- Benefit: Recruiters/clients can try it immediately
- Validation: Live URL loads, connects to Binance, shows real data

---

## 13. Immediate Next 5 Actions

1. **Verify the 1000-candle experience locally.** Pull, run, check that historical candles load, chart shows context, pan works, Fit All doesn't freeze. Fix any visual bugs found.

2. **Add bubble state legend to SidePanel.** A small key at the top of the "Bubble States" section explaining what each state means in plain English. One-line descriptions, no jargon.

3. **Hide footprint cells below readable zoom.** In `chartRenderer.ts`, add a `bodyW > 8` check before drawing footprint cells. This removes visual noise at zoom-out levels.

4. **Rename "LW Exp" to "Lightweight ⚠".** Add a title tooltip: "Experimental — orderflow overlays not migrated yet." This makes the toggle self-explanatory.

5. **Add dirty flag to ChartCanvas render loop.** Track whether candles/view/mouse changed since last frame. Skip `requestAnimationFrame` callback if nothing changed. This is a 5-line change that reduces idle CPU usage.

---

## 14. What NOT To Do Next

- **Do not make Lightweight the default.** It has zero orderflow context. Making it default would remove the product's core value.
- **Do not remove the legacy chartRenderer.** It is the product. Even if it's a monolith, it works and it renders the Cockpit's unique features.
- **Do not add AI/signal/prediction features.** This is a visualization tool. Adding fake signals would undermine the honest microstructure analysis that makes it valuable.
- **Do not rename the project to sound like a trading bot.** "Orderflow Cockpit" is the correct name. It describes what it is.
- **Do not add too many visual layers without legends.** Every visual element needs an explanation. Unexplained colors create confusion, not insight.
- **Do not call historical kline data "orderflow."** Klines don't have bid/ask split. Historical candles show volume, not orderflow. Be honest about data quality.
- **Do not build features before fixing chart usability.** The chart must be navigable and readable before adding more overlays.
- **Do not rewrite the chartRenderer in one shot.** Split it incrementally: extract coordinate math, then controls, then drawing functions. Keep it working at every step.
- **Do not add drawing tools before orderflow overlays.** Drawing tools are polish. Orderflow overlays are product value. Prioritize value over polish.
- **Do not over-claim in the README.** "Real-time market microstructure visualization dashboard" is honest and impressive. "AI-powered trading terminal" is a lie.

---

*End of consultation report. No files were modified. No code was changed.*
