# Project Consulting Report — Orderflow Cockpit

**Date:** 2026-05-11
**Branch:** `main` @ `efaaad3`
**Consultant scope:** Technical, product, portfolio, roadmap, risk, testing
**Method:** Full source audit, build verification, architecture review, docs cross-check

---

## A. Executive Verdict

**This is a portfolio-grade technical demo that is one rigorous soak test away from being a credible internal research tool.**

It is not a product. It is not a trading system. It should not become either of those things without fundamental architectural changes that are not warranted by the current value proposition.

The strongest honest positioning: **"A live market microstructure visualization cockpit for studying order flow, liquidity, and trade aggression using public Binance Futures data."**

The project has genuine technical depth in three areas that most portfolio projects lack:
1. WebSocket lifecycle management with generation tokens and stale socket protection
2. Strict order book sync with honest degraded fallback
3. Canvas2D overlay rendering decoupled from React via ref subscription pattern

These are not toy implementations. The order book engine follows Binance's official diff-depth methodology. The chart architecture correctly delegates to Lightweight Charts for what it does well and uses a custom overlay only for what Lightweight Charts cannot do.

**Build: ✅ Passes.** `tsc && vite build` — 0 errors, 76 modules, 401.8 KB (127 KB gzipped).

---

## B. Project Identity

### What it is
A single-page React + TypeScript application that connects to Binance Futures public WebSocket streams and renders real-time market microstructure data on a unified execution chart: Lightweight Charts for candlesticks/time-price-scale/zoom-pan/crosshair, Canvas2D overlay for orderflow methodology (heatmap, bubbles, footprint, state badges).

### What problem it solves
Provides a visual interface for observing order flow, liquidity, and trade aggression in real-time crypto markets — without requiring API keys, exchange accounts, or backend servers.

### Who it is for
- The developer (portfolio, learning, potential client demonstration)
- A recruiter or technical lead evaluating the developer's real-time systems engineering ability
- A crypto trader or analyst who wants to observe microstructure behavior (not execute trades)

### What it is NOT
- Not a trading bot — no orders are placed
- Not a signal system — no buy/sell recommendations
- Not an AI predictor — no ML models
- Not a production SaaS — no auth, no persistence, no multi-user
- Not a profitable trading system — no edge claims

### Classification
**Portfolio-grade technical demo / engineering showcase**

It sits between "internal research tool" and "portfolio project." It has enough real technical substance to be credible in a portfolio, but lacks the persistence, testing, and reliability guarantees of a real tool.

### Strongest positioning
Position this as an engineering showcase that demonstrates:
- Real-time WebSocket lifecycle management
- Canvas rendering under high-frequency streaming data
- React performance optimization for market data
- Order book sequence validation and local resync

Do NOT position it as a trading tool, analysis platform, or product prototype.

---

## C. Architecture Assessment

### C.1 Data Ingestion

**Strong:**
- Stream-first diff-depth sync (open WebSocket, buffer events, then fetch snapshot) is the correct Binance methodology
- Generation tokens prevent stale socket events from polluting new connections
- `closeSocket()` detaches handlers before closing — prevents ghost `onclose` events
- Rate-limited resync (5s cooldown) prevents reconnect storms
- Exponential backoff with jitter (1s → 15s, ±25%)
- Per-stream error tracking (trade, depth, ticker independently)
- Connection registry for dev-mode duplicate detection

**Fragile:**
- `binanceAggTrade.ts` has `console.log` on every connection/disconnection — acceptable for dev but noisy in production. Should be gated like `localOrderBook.ts`'s `devLog`.
- Trade stream uses `@trade` (individual trades) but the README says "aggTrade is aggregated trade data" — minor documentation inconsistency. The code actually connects to `@trade`, not `@aggTrade`. This is correct behavior but the README is misleading.
- No rate limit awareness for REST calls (snapshot fetch, kline fetch, ticker poll). Binance rate limits are generous for public endpoints but not infinite.

**Overengineered:**
- `connectionRegistry.ts` is dev-only with zero production overhead — this is fine, not overengineered.

**Underdeveloped:**
- No WebSocket message size monitoring — if Binance sends an unexpectedly large message, there's no guard.
- No explicit handling of Binance maintenance windows (Binance publishes scheduled maintenance).

**Protect from changes:**
- The stream-first buffering approach in `localOrderBook.ts`. Changing the order (snapshot first, then stream) would break the sync methodology.
- Generation token pattern. This is the core safety mechanism.

### C.2 State Layer (Zustand)

**Strong:**
- Single global store — simple, predictable
- `getDataResetFields()` ensures complete cleanup on symbol switch — no stale state leakage
- Array caps on all data buffers (1500 candles, 200 trades, 100 large trades, 3000 heatmap, 500 bubbles)
- Ref subscription pattern in ExecutionChart — Zustand subscription updates refs, RAF reads refs, no React re-render per tick
- `processTrade` correctly merges bubble states (the BUGFIX comment shows real debugging happened)

**Fragile:**
- The store has ~40+ fields. This is a lot for a single store. Some fields are clearly related (orderBookHealth, orderBookLastUpdateId, orderBookError, etc.) but there's no sub-store or slice pattern. This will become harder to maintain as the project grows.
- `setConnected`, `setDepthConnected`, `setTickerConnected` are separate booleans — a single `connectionStatus` object would be cleaner.
- `resyncOrderBook` action is monkey-patched in `App.tsx` (original replaced with version that calls engine's `resync()`). This is a code smell — the store shouldn't need to be patched at runtime.

**Overengineered:**
- `volumeProfile`, `heatmapLevels`, and `clusters` are recomputed every 2 seconds via `setInterval` in App.tsx. This is a fixed-cost computation regardless of whether new data arrived. Not a performance problem but architecturally awkward.

**Underdeveloped:**
- No derived state selectors — components must slice the store manually
- No store middleware for logging or debugging

**Protect from changes:**
- The ref subscription pattern. This is the key performance optimization.
- `getDataResetFields()` — symbol switch correctness depends on this.

### C.3 Chart Layer

**Strong:**
- Lightweight Charts as base is the correct decision — it provides professional candlestick rendering, time/price scales, zoom/pan, crosshair, and scroll-to-real-time that would take thousands of lines to replicate
- Canvas2D overlay with `pointer-events: none` — clean separation
- Single RAF loop — starts once, reads refs, never restarts
- Coordinate mapping via Lightweight Charts APIs (`timeToCoordinate`, `priceToCoordinate`) — no guessing
- Null checks on all coordinate conversions — off-screen elements are skipped
- Layer order (liquidity → level memory → footprint → bubbles → clusters → tooltip → state badge → GO LIVE) is well-designed
- `ResizeObserver` keeps overlay canvas dimensions synchronized

**Fragile:**
- Price line is removed and recreated every time the price changes. Lightweight Charts v5 may have an `update()` method — the current approach is wasteful but not incorrect.
- `estimateSlotWidth()` uses `Date.now()` to measure pixel density — if viewing historical candles far from current time, the estimation may be slightly inaccurate. In practice, Lightweight Charts uses uniform bar spacing, so this is acceptable.
- `findClosestBubble()` is O(n) per mouse move — with 1500 candle cap and typical bubble counts, this is fine, but could become noticeable with very high bubble counts.
- The `window.__chartApi` global for toolbar integration is a minor architectural smell. A React context or Zustand action would be cleaner.

**Overengineered:**
- The zoom alpha scaling (`zoomAlphaScale`) that reduces overlay opacity when many candles are visible — this is a nice touch but adds complexity to every draw call.

**Underdeveloped:**
- No chart-level error boundary — if Lightweight Charts throws, the entire app crashes
- No fallback if Lightweight Charts fails to load (unlikely but possible with CDN issues)

**Protect from changes:**
- The dual-layer architecture (Lightweight Charts base + Canvas2D overlay). Do not re-merge these.
- The RAF loop structure. Do not add a second RAF loop.
- The coordinate adapter. Do not replace with manual coordinate math.

### C.4 UI Layer

**Strong:**
- Clean component structure (Toolbar, SidePanel, DOMLite, Heatmap, TradeFlow, ConnectionStatus, MarketHeader)
- Dark theme is consistent and appropriate for financial data
- Order book health states are rendered honestly — DEGRADED shows "DEGRADED TOP-20 BOOK", not faked HEALTHY

**Fragile:**
- No error boundaries on any component — a render error in any panel crashes the entire app
- No loading states for initial connection — the user sees an empty chart until data arrives
- No responsive design — the layout assumes a desktop viewport

**Underdeveloped:**
- No keyboard shortcuts beyond double-click for GO LIVE
- No accessibility attributes (ARIA labels, screen reader support)
- No dark/light theme toggle

**Protect from changes:**
- The honest state labeling. Do not soften DEGRADED/STALE/ERROR labels.

### C.5 Documentation

**Strong:**
- ARCHITECTURE.md is detailed and accurate — matches the actual code
- FUSION_ACCEPTANCE_REPORT.md and FUSION_ACCEPTANCE_MATRIX.md are thorough
- PORTFOLIO_SUMMARY.md is honest and well-positioned
- README.md is clear about what the project is and isn't

**Fragile:**
- The FUSION_REPORT.md references commit `7febdef` as latest, but `efaaad3` is now latest — minor staleness
- The README says "aggTrade is aggregated trade data" but the code uses `@trade` (individual trades) — documentation inconsistency
- No CHANGELOG.md — hard to track what changed between versions

**Protect from changes:**
- The honest limitations sections in README and PORTFOLIO_SUMMARY. Do not remove or soften these.

---

## D. Engineering Quality Scorecard

| Dimension | Rating 1-10 | Verdict | Evidence | Risk |
|---|---:|---|---|---|
| **Reliability** | 6/10 | Structurally sound, runtime-unproven | Generation tokens, backoff, stale detection all correct in code. No soak test performed. No automated tests. | P1 — no runtime validation |
| **Runtime stability** | 6/10 | Good design, no runtime proof | Single RAF loop, capped arrays, no unbounded timers. But no 30-minute soak test. Browser memory behavior unknown. | P1 — untested under load |
| **Data correctness** | 7/10 | Order book sync is methodologically correct | Strict Binance diff-depth methodology implemented correctly. pu validation, first-event alignment, snapshot overlap. Degraded fallback is honest. | P2 — no automated correctness tests |
| **Chart architecture** | 8/10 | Correct foundation, well-separated concerns | Lightweight Charts base + Canvas2D overlay is the right architecture. Coordinate mapping via LWC APIs. Single RAF loop. No duplicate render paths. | P2 — LWC version coupling |
| **UI clarity** | 7/10 | Clean, honest, appropriate | Dark theme is consistent. State badges are honest. No misleading labels. Missing loading states and error boundaries. | P3 — polish gaps |
| **Performance model** | 7/10 | Good ref-based pattern, no render storms | Ref subscription decouples RAF from React. Array caps prevent unbounded growth. Price line recreation is wasteful but not catastrophic. | P3 — price line overhead |
| **Maintainability** | 5/10 | Single large store, no tests, monkey-patching | 40+ field Zustand store. `resyncOrderBook` monkey-patched in App.tsx. No unit tests. No linting config. No CI. | P1 — technical debt |
| **Documentation quality** | 8/10 | Thorough, honest, matches code | Architecture docs match implementation. Fusion acceptance docs are detailed. Portfolio summary is well-positioned. Minor staleness. | P3 — minor inconsistencies |
| **Extensibility** | 5/10 | Hard to add features without tests | No test safety net. Single store makes adding state risky. No plugin/extension architecture. Adding a new overlay layer would require touching multiple files. | P2 — no test safety net |
| **Portfolio credibility** | 7/10 | Genuine technical substance | WebSocket lifecycle, order book sync, Canvas rendering are real engineering. Honest limitations stated. Risk: recruiter may not understand the technical depth. | P3 — positioning challenge |

**Overall: Advanced prototype / portfolio-grade technical demo.**

Not local production-grade (no tests, no soak validation). Not product-ready (no auth, no persistence, no error boundaries). The engineering quality is above average for a portfolio project but below production standards.

---

## E. Order Book / Market Data Assessment

### Is the strict/degraded model conceptually correct?
**Yes.** The strict sync follows Binance's official methodology: stream-first buffering, snapshot overlap validation, pu continuity chain. The degraded fallback to depth20 is appropriate — each depth20 update is an authoritative top-20 snapshot, which is honest about what it provides.

### Does HEALTHY mean something mathematically valid?
**Yes.** HEALTHY is set only after:
1. Snapshot loaded (L = lastUpdateId)
2. First overlapping event found (event.U <= L+1 && event.u >= L+1)
3. pu continuity validated for subsequent events

This is the correct Binance methodology. The book is sequence-validated.

### Does DEGRADED honestly communicate best available book?
**Yes.** DEGRADED uses depth20 partial stream — each update replaces the book with the top-20 snapshot. The UI labels it "DEGRADED TOP-20 BOOK" with a red tint. This is honest.

### Is depth20 fallback appropriate?
**Yes.** depth20 is the best available alternative when strict diff-depth sync fails. It provides authoritative top-20 levels at 100ms intervals. It's not a full book, but it's honest about what it is.

### Is public Binance data enough for this kind of cockpit?
**For visualization: yes. For research: limited.** Public data provides:
- aggTrade (aggregated trades, not full tick-by-tick)
- diff-depth (top-1000 levels at 100ms intervals)
- depth20 (top-20 levels at 100ms intervals)
- miniTicker (24h stats)

Missing for serious research:
- Full order book (not just top-20/1000)
- Individual order events (new, modify, cancel)
- Trade-by-trade data (not aggregated)
- Historical order book snapshots

### Limitations of aggTrade
- Aggregated by price level — individual orders are not visible
- No order size distribution — can't see individual order sizes
- No cancel events — can't see order removal
- Maker/taker distinction is approximate (based on `m` flag)

### Limitations of top-20 depth
- Only 20 levels — deep liquidity is invisible
- 100ms intervals — sub-100ms changes are missed
- No order-level detail — can't distinguish one large order from many small ones
- Stale between updates — the displayed book may be 99ms old

### Limitations of browser-only order book reconstruction
- No persistence — book is lost on page refresh
- No historical snapshots — can't compare book state over time
- Network latency affects sync accuracy
- Browser throttling (background tabs) can cause missed events

### What should be documented more clearly
- The README says "aggTrade" but the code uses `@trade` — clarify which stream is actually used
- Document the exact Binance stream names and their update frequencies
- Document the rate limits for REST API calls (snapshot, klines, ticker)
- Document the expected behavior during Binance maintenance windows

### What must not be overstated
- Do not claim the order book is "full" — it's top-20 or top-1000
- Do not claim "real-time" without qualification — there's 100ms depth latency and network latency
- Do not claim the book is "accurate" without noting it's only as good as the last validated sync

### Verdict

| Question | Answer |
|---|---|
| Good enough for visualization? | **Yes** — the strict/degraded model provides honest, validated order book data for visual observation |
| Good enough for serious microstructure research? | **No** — lacks historical data, full book, order-level events |
| Good enough for execution decisions? | **Absolutely not** — no order placement, no latency guarantees, no failover |
| Good enough for portfolio demo? | **Yes** — demonstrates real understanding of order book mechanics |

---

## F. Fused Chart Assessment

### Was using Lightweight Charts as base + custom overlay the right architecture?
**Yes, unconditionally.** Lightweight Charts provides professional-grade candlestick rendering, time/price scales, zoom/pan, crosshair, and scroll-to-real-time. Replicating these in Canvas2D would take thousands of lines and would be worse. The overlay approach correctly delegates to each layer for what it does best.

### What does Lightweight Charts solve well?
- Candlestick rendering with proper wick/body colors
- Volume histogram positioned below candles
- Time scale with zoom/pan and time labels
- Price scale with auto-scaling and price labels
- Native crosshair with labels
- Scroll-to-real-time
- Resize handling
- Wheel zoom with focal-point preservation
- Drag pan with momentum

### What does the custom overlay solve well?
- Liquidity bands from order book data
- Level memory (horizontal dashed lines at meaningful prices)
- Footprint cells (per-candle volume-at-price)
- Bubbles (aggressive flow events with state/age encoding)
- Auction clusters (clustered bubble rendering)
- Bubble tooltip (hover info)
- Order book state badges (DEGRADED, RESYNCING, STALE, ERROR)
- GO LIVE / LIVE indicator

### What remains hard with overlay alignment?
- Coordinate mapping relies on Lightweight Charts' `timeToCoordinate()` and `priceToCoordinate()` — if these change in a future version, the overlay silently misaligns
- Footprint slot width estimation uses `Date.now()` — slightly inaccurate for historical candles (acceptable with uniform bar spacing)
- Crosshair is native to Lightweight Charts — the overlay tooltip uses separate mouse tracking, so they don't interact

### What is the biggest risk of this architecture?
**Lightweight Charts version coupling.** The overlay depends on `timeToCoordinate()` and `priceToCoordinate()` which are not part of the stable public API contract — they could change in a major version. Mitigation: pin the version, test on upgrades.

### What should be tested visually?
- Candles render correctly at all zoom levels
- Footprint cells align with candle bodies
- Bubbles align with candle time + price
- Liquidity bands align with price axis
- State badges don't obscure chart data
- GO LIVE pill is clickable and returns to live edge
- Tooltip appears near the correct bubble

### What should be unit-tested or regression-tested?
- Coordinate adapter: `timePriceToPixel` returns null for off-screen coordinates
- Coordinate adapter: `priceToY` returns null for invalid prices
- Candle adapter: `adaptCandles` produces valid LWC format
- Order book: first-event alignment logic
- Order book: pu continuity validation
- Order book: degraded fallback trigger
- Bubble classification: state transitions
- Array caps: verify all buffers are capped

### What should not be touched casually anymore?
- The dual-layer architecture (Lightweight Charts + Canvas2D overlay)
- The RAF loop structure
- The coordinate adapter
- The order book sync methodology
- The generation token pattern
- The ref subscription pattern

### Feature Assessment

| Feature | Status | Notes |
|---|---|---|
| Candles | ✅ Strong | Lightweight Charts CandlestickSeries — professional quality |
| Time scale | ✅ Strong | Native zoom/pan, time labels, right offset |
| Price scale | ✅ Strong | Auto-scaling, price labels, margins |
| Zoom/pan | ✅ Strong | Native wheel zoom + drag pan, focal-point preservation |
| Crosshair | ✅ Strong | Native crosshair with price/time labels |
| Bubbles | ✅ Strong | State encoding, age encoding, side notch, level interaction |
| Heatmap | ✅ Adequate | Top-5 bid/ask bands by qty — simple but functional |
| Footprint | ✅ Adequate | Visible at high zoom, delta coloring, compact labels |
| Order book state badges | ✅ Strong | All 10 states rendered honestly |
| GO LIVE | ✅ Strong | Click detection, double-click, keyboard shortcut |
| Symbol switch | ✅ Strong | Complete data reset, fresh connections |
| Performance 30+ min | ⚠ Untested | Structurally sound but no runtime proof |

### Verdict
**Yes, this is the correct long-term chart foundation.** The Lightweight Charts + Canvas2D overlay architecture is the right choice. It delegates rendering to the appropriate layer, maintains clean separation of concerns, and provides a solid foundation for future overlay work.

---

## G. Product / Portfolio Positioning

### What role should this project play in a portfolio?
**Lead technical showcase for real-time systems engineering.** This should be the project that demonstrates the developer can build complex, streaming, high-performance frontend systems — not just CRUD apps.

### What job/client profile does it support?
- Frontend engineer roles involving real-time data (fintech, trading, monitoring)
- React performance engineering roles
- WebSocket/streaming data roles
- Market data visualization roles
- Any role that values "can you build something that handles high-frequency data without falling over?"

### What should the GitHub README emphasize?
1. The technical challenge (real-time streaming + Canvas rendering + React performance)
2. The architecture (dual-layer chart, ref subscription, generation tokens)
3. The honest limitations (not a trading system, no signals, no AI)

### What should screenshots show?
1. Full dashboard — chart + panels + connection status
2. Zoomed-in candles — footprint cells and bubble detail
3. Order book state badge — DEGRADED or STALE state
4. GO LIVE pill — detached from live edge
5. Bubble tooltip — hover info

### What should a short portfolio card say?
"Real-time crypto orderflow cockpit — WebSocket lifecycle management, Canvas2D rendering under streaming data, strict order book sync with degraded fallback."

### What should an Upwork project entry say?
"Built a real-time market microstructure visualization dashboard using React, TypeScript, and Canvas2D. Connects to Binance Futures public WebSocket streams for live trade, depth, and ticker data. Features include strict order book synchronization with sequence validation, aggressive flow classification via bubble state machine, and professional chart rendering using TradingView Lightweight Charts with custom Canvas2D overlays."

### What claims should be avoided?
- "Institutional-grade" — it's not
- "Production-ready" — no tests, no soak validation
- "Trading tool" — no order execution
- "AI-powered" — no ML
- "Profitable" — no edge claims
- "Real-time" without qualification — there's latency
- "Full order book" — it's top-20 or top-1000

### What technical achievements are genuinely impressive?
1. **Order book sync** — correctly implementing Binance's diff-depth methodology with pu validation is non-trivial. Most portfolio projects skip this entirely.
2. **Ref subscription pattern** — decoupling high-frequency data from React re-renders via refs + Zustand subscription is a real performance optimization.
3. **Generation tokens** — preventing stale socket events from polluting new connections is a subtle but important safety mechanism.
4. **Honest state labeling** — showing "DEGRADED TOP-20 BOOK" instead of hiding the degraded state demonstrates engineering integrity.

### What would make a recruiter/client trust it?
- Live demo (the app actually works)
- Clean code structure
- Honest limitations stated
- Technical depth in documentation
- Build passing with 0 errors

### What would make them skeptical?
- No tests
- No CI/CD
- No deployment
- Claims that don't match the code
- Overly promotional README

### Portfolio Deliverables

**A. One-sentence portfolio headline:**
"Real-time crypto orderflow visualization cockpit — WebSocket lifecycle, Canvas2D rendering, and strict order book sync using public Binance Futures data."

**B. 3-bullet technical summary:**
- Strict Binance diff-depth order book sync with pu validation and degraded depth20 fallback
- Dual-layer chart architecture: TradingView Lightweight Charts base + Canvas2D orderflow overlay
- Ref subscription pattern decouples high-frequency streaming data from React re-render cycles

**C. 3-bullet product summary:**
- Live candlestick chart with footprint, bubbles, heatmap, and order book state visualization
- Symbol switching across 24 Binance Futures perpetuals with complete data reset
- Honest order book health states (HEALTHY, DEGRADED, STALE, ERROR) with visual indicators

**D. 3-bullet "what it demonstrates":**
- WebSocket lifecycle management with generation tokens, backoff, and stale socket protection
- Canvas2D rendering at 60fps under 100ms streaming data updates
- React state management optimized for market microstructure data (Zustand + refs + subscriptions)

**E. 3-bullet "limitations honestly stated":**
- Depends on Binance public WebSocket availability — no offline mode
- No automated tests — all verification is manual
- Browser-only — no server-side persistence or historical database

**F. 120-word portfolio description:**
"Orderflow Cockpit is a real-time market microstructure visualization tool built with React, TypeScript, and TradingView Lightweight Charts. It connects to Binance Futures public WebSocket streams for live trade, depth, and ticker data, rendering orderflow methodology overlays (heatmap, footprint, bubbles, liquidity bands) on a Canvas2D layer synchronized with the chart. The order book engine implements Binance's official diff-depth synchronization methodology with sequence validation and automatic degraded fallback to partial depth streams. Performance is optimized through a ref subscription pattern that decouples high-frequency streaming data from React re-render cycles, with all data buffers capped to prevent memory growth. The project demonstrates real-time WebSocket lifecycle management, Canvas rendering under streaming data, and honest engineering — including transparent order book health states and documented limitations."

**G. 500-character Upwork project description:**
"Real-time crypto orderflow cockpit using React, TypeScript, Binance Futures WebSockets, and TradingView Lightweight Charts. Features strict order book sync with sequence validation, Canvas2D overlay for heatmap/footprint/bubbles, aggressive flow classification, and honest degraded/stale state handling. No API keys required. Demonstrates WebSocket lifecycle management, Canvas rendering under streaming data, and React performance optimization for high-frequency market data."

---

## H. Roadmap Recommendation

### Phase Candidates

| Phase | Value | Risk | Difficulty | Why now / why not now | Recommendation |
|---|---|---|---|---|---|
| 30-minute live soak + runtime profiling | High | Low | Low | Validates the most critical unverified claim (runtime stability). No code changes needed — just run and observe. | **DO NOW** |
| Automated regression tests for order book | High | Low | Medium | The order book engine is the most complex and critical component. Tests would catch regressions during future refactoring. | **DO NEXT** |
| Screenshot/demo capture | Medium | Low | Low | Needed for portfolio. No code changes. Just run the app and take screenshots. | **DO NEXT** |
| Unit tests for coordinate adapter | Medium | Low | Low | Simple functions, easy to test, high value for catching coordinate drift. | **DO NEXT** |
| Deployment hardening (Vercel/Netlify) | Medium | Low | Low | Makes the project accessible for demo. No code changes needed. | **DO SOON** |
| Error boundaries on components | Medium | Low | Low | Prevents full app crash on component errors. Simple React pattern. | **DO SOON** |
| Historical recorder | High | Medium | Medium | Enables replay, backtesting, and historical analysis. Significant new feature — should come after tests. | **POSTPONE** |
| Replay engine | High | Medium | High | Depends on historical recorder. Would enable deterministic testing of overlays. | **POSTPONE** |
| Source abstraction (other exchanges) | Medium | Medium | Medium | Adds complexity. Current Binance-only focus is fine for portfolio. | **POSTPONE** |
| Event detection layer | Medium | Medium | Medium | Would add real analytical value but increases scope. Should come after soak test and tests. | **POSTPONE** |
| Performance profiling | Low | Low | Low | The app already performs well structurally. Profiling is premature without soak test data. | **POSTPONE** |
| Multi-symbol simultaneous | Low | High | High | Adds significant complexity (multiple WebSocket sets, multiple order books). Not needed for portfolio. | **AVOID** |
| Local persistence (IndexedDB) | Medium | Medium | Medium | Nice-to-have but adds complexity. Not needed for portfolio demo. | **POSTPONE** |
| Alert/event journal | Low | Medium | Medium | Feature creep. The project should stay focused on visualization. | **AVOID** |
| Desktop packaging (Electron) | Low | High | High | Massive scope increase. The web app is sufficient. | **AVOID** |

### Immediate next step
**Run a 30-minute live soak test.** Start the app, let it run for 30 minutes, and monitor:
- Browser memory usage (should stay under 500MB)
- WebSocket stability (no reconnect spam)
- Chart responsiveness (no progressive slowdown)
- Console errors (should be minimal)
- Order book health (should stay HEALTHY or recover from DEGRADED)

This is the single highest-leverage action because it validates the most critical unverified claim.

### Next 7-day technical plan
1. **Day 1:** 30-minute soak test + screenshot capture
2. **Day 2-3:** Write unit tests for order book first-event alignment, pu chain, symbol switch
3. **Day 4-5:** Write unit tests for coordinate adapter, candle adapter
4. **Day 6:** Deploy to Vercel/Netlify for live demo
5. **Day 7:** Update README with screenshots and live demo link

### Next 30-day technical plan
1. **Week 1:** Soak test + unit tests + deployment (above)
2. **Week 2:** Error boundaries + loading states + price line optimization
3. **Week 3:** Integration tests for order book state transitions + symbol switch
4. **Week 4:** Historical recorder (if tests are solid)

### What should be postponed
- Historical recorder — until tests exist
- Replay engine — until historical recorder exists
- Source abstraction — not needed for portfolio
- Event detection layer — increases scope
- Multi-symbol simultaneous — too complex
- Local persistence — not needed for demo
- Desktop packaging — massive scope

### What should never be built unless there is evidence
- Trading execution — unless there's a specific client requirement
- AI/ML predictions — unless there's a specific research need
- Backend server — unless multi-user or persistence is required
- Mobile responsive — unless there's evidence of mobile usage

---

## I. Risk Register

| Risk | Severity | Probability | Evidence | Mitigation | Owner/Next Action |
|---|---|---|---|---|---|
| **No automated tests** | P1 | Certain | 0 test files in project | Write order book + coordinate adapter unit tests | Developer — Week 1-2 |
| **No runtime soak validation** | P1 | High | No soak test performed | Run 30-minute live soak with memory monitoring | Developer — Day 1 |
| **Browser memory growth** | P1 | Medium | Capped arrays, but no runtime proof | Soak test with memory profiling | Developer — Day 1 |
| **Order book sync correctness** | P2 | Low | Code follows Binance methodology, but no automated tests | Unit tests for first-event alignment, pu chain | Developer — Week 1 |
| **Overlay coordinate drift** | P2 | Low | Uses LWC APIs correctly, but LWC version coupling exists | Pin LWC version, test on upgrades | Developer — ongoing |
| **Chart performance degradation** | P2 | Medium | Single RAF loop, but no profiling under load | Soak test + Chrome DevTools Performance tab | Developer — Day 1 |
| **Lightweight Charts version coupling** | P2 | Medium | Overlay depends on `timeToCoordinate`/`priceToCoordinate` | Pin version, test on upgrades, document dependency | Developer — ongoing |
| **WebSocket instability (Binance)** | P2 | Medium | Binance can rate-limit or block IPs | Backoff + degraded fallback already implemented | Already mitigated |
| **REST snapshot rate limits** | P3 | Low | Binance allows 2000 request weight/min for depth endpoint | Rate-limited resync (5s cooldown) already implemented | Already mitigated |
| **Possible misleading visual interpretation** | P2 | Medium | Users may interpret DEGRADED book as complete | Honest state labels + documentation | Already mitigated, verify in screenshots |
| **Deployment/network issues** | P3 | Medium | No deployment configured | Deploy to Vercel/Netlify | Developer — Week 1 |
| **Overclaiming portfolio value** | P2 | Medium | README and docs are honest, but screenshots may mislead | Include state badges in screenshots, state limitations prominently | Developer — when capturing |
| **Scope creep** | P2 | Medium | Historical recorder, replay engine, multi-symbol are tempting | Follow this roadmap strictly | Developer — ongoing |
| **Two-source state inconsistency** | P3 | Low | Store and engine both track order book health | Engine is source of truth, store mirrors via callbacks | Already mitigated |
| **Stale documentation** | P3 | Medium | FUSION_REPORT.md references `7febdef`, latest is `efaaad3` | Update docs after consulting report | Developer — this commit |
| **`resyncOrderBook` monkey-patching** | P3 | Low | Store action replaced at runtime in App.tsx | Refactor to pass engine handle via context or store | Developer — when convenient |
| **No error boundaries** | P2 | Medium | Any component render error crashes entire app | Add React error boundaries to major panels | Developer — Week 2 |
| **No loading states** | P3 | Medium | Empty chart until data arrives | Add skeleton/loading indicator | Developer — Week 2 |

---

## J. Testing Strategy

### A. Manual QA (existing — keep using)

The existing `docs/QA_CHECKLIST.md` is thorough. Continue using it for:
- Clean install + build
- Initial connection
- Symbol switch
- Zoom/pan
- GO LIVE
- Bubble tooltip
- Order book state transitions
- 5-minute stability

**Add to QA checklist:**
- 30-minute soak test (new)
- Memory profiling screenshot (new)
- Order book state transition: HEALTHY → STALE → RESYNCING → HEALTHY (new)
- Order book state transition: HEALTHY → DEGRADED → HEALTHY (new)

### B. Runtime Soak (new)

**30-minute live soak test:**
1. Start `npm run dev`
2. Connect to BTCUSDT
3. Leave running for 30 minutes
4. Monitor:
   - Chrome Task Manager memory (should stay under 500MB)
   - Console for reconnect spam (should be minimal)
   - Chart responsiveness (should not degrade)
   - Order book health (should stay HEALTHY or recover)
5. Take memory profiling screenshot at 0, 10, 20, 30 minutes

**Pass criteria:**
- Memory stays under 500MB
- No progressive slowdown
- No uncaught exceptions
- WebSocket connections remain stable (or recover cleanly)

### C. Unit Tests (new — minimal realistic suite)

**Framework:** Vitest (already compatible with Vite)

**Priority 1: Order book logic** (`src/connectors/__tests__/localOrderBook.test.ts`)
- First-event alignment: given snapshot with L=100, event with U=99, u=101 should be accepted
- First-event alignment: event with U=102, u=104 should be rejected (gap)
- pu continuity: event with pu=101 after event with u=100 should be accepted
- pu mismatch: event with pu=102 after event with u=100 should be rejected
- Symbol switch: dispose should invalidate all pending events
- DEGRADED trigger: 3 sync failures within 60s should enter DEGRADED
- DEGRADED recovery: 30s timer should trigger recovery attempt
- Stale detection: 20s without updates from HEALTHY should mark STALE
- Grace period: no stale detection within first 30s

**Priority 2: Coordinate adapter** (`src/utils/__tests__/lightweightCoordinateAdapter.test.ts`)
- `timePriceToPixel` returns null for off-screen time
- `priceToY` returns null for off-screen price
- `timePriceToPixel` returns valid {x, y} for on-screen coordinates
- `getVisibleCandleCount` returns positive integer

**Priority 3: Candle adapter** (`src/utils/__tests__/lightweightChartAdapters.test.ts`)
- `adaptCandles` produces valid LWC format (time as UTCTimestamp, OHLC as numbers)
- `adaptSingleCandle` handles null/undefined gracefully
- `adaptVolumes` produces valid histogram data

**Priority 4: Bubble classification** (`src/utils/__tests__/bubbleMethodology.test.ts`)
- PENDING bubble near resistance → RESISTANCE state
- ACCEPTED bubble with price moving away → stays ACCEPTED
- EXHAUSTED bubble with no follow-through → stays EXHAUSTED

### D. Integration Tests (new — higher priority than unit tests for order book)

**Order book state machine integration test:**
- Start with DISCONNECTED
- Connect → CONNECTING → BUFFERING → SNAPSHOT_LOADING → SYNCING → HEALTHY
- Inject pu mismatch → RESYNCING → HEALTHY
- Inject 3 sync failures → DEGRADED
- Wait 30s → recovery attempt → HEALTHY
- Stop receiving messages for 20s → STALE
- Reconnect → HEALTHY

**Symbol switch integration test:**
- Start with BTCUSDT HEALTHY
- Switch to ETHUSDT → all data cleared, new connections established
- Switch back to BTCUSDT → clean state, no stale data

### E. Visual Regression Tests (postpone)

Not needed for current phase. Would require Playwright + screenshot comparison. High effort, low priority compared to unit/integration tests.

### F. Performance Tests (postpone until soak test results)

After soak test, if performance issues are found:
- Chrome DevTools Performance profile during 1000-trade burst
- Memory allocation timeline over 30 minutes
- RAF loop duration histogram

### G. Data Correctness Tests (integrate into order book unit tests)

- Verify that HEALTHY book has no gaps in price levels
- Verify that DEGRADED book has exactly 20 levels per side
- Verify that RESYNCING preserves last known good book
- Verify that symbol switch clears all data buffers

### Minimal Test Suite Proposal

```
src/
  connectors/
    __tests__/
      localOrderBook.test.ts     (12 tests — first-event, pu, degraded, stale, symbol switch)
  utils/
    __tests__/
      lightweightCoordinateAdapter.test.ts  (4 tests — null handling, valid coords)
      lightweightChartAdapters.test.ts      (3 tests — format, null, volume)
      bubbleMethodology.test.ts             (4 tests — state transitions)
```

**Total: ~23 tests.** This is realistic for a solo developer in 2-3 days of focused work. It covers the most critical and fragile components.

---

## K. Consultant Decision Memo

### 1. Should the project continue?
**Yes.** The project has genuine technical substance and is close to being a credible portfolio piece. The remaining work (soak test, unit tests, deployment) is low-effort, high-value.

### 2. What is the strongest reason to continue?
**The order book sync engine is real engineering.** Most portfolio projects have no concept of order book synchronization, sequence validation, or degraded fallback. This project correctly implements Binance's diff-depth methodology — that's a differentiator.

### 3. What is the biggest risk?
**No runtime validation.** The code is structurally sound but has never been run under real conditions for more than a few minutes. A soak test could reveal memory leaks, WebSocket instability, or performance degradation that would undermine the portfolio value.

### 4. What should be done next?
1. **Today:** Run a 30-minute soak test
2. **This week:** Write unit tests for order book logic and coordinate adapter
3. **Next week:** Deploy to Vercel/Netlify, capture screenshots, update README

### 5. What should not be done next?
- Do NOT add historical recorder/replay engine (no tests to catch regressions)
- Do NOT add multi-symbol simultaneous (too complex)
- Do NOT add trading execution (out of scope)
- Do NOT add AI/ML features (out of scope)
- Do NOT refactor the Zustand store (working code, low ROI)

### 6. Is it portfolio-ready?
**Almost.** It needs:
- Screenshots (low effort)
- Live demo deployment (low effort)
- Soak test validation (low effort)
- Unit tests for credibility (medium effort)

With those additions, it becomes a strong portfolio piece.

### 7. Is it product-ready?
**No.** Missing: authentication, persistence, error boundaries, loading states, responsive design, automated tests, CI/CD, deployment. These are not needed for a portfolio project.

### 8. What would make it meaningfully stronger?
In order of impact:
1. **Live demo URL** — makes it real for recruiters/clients
2. **Unit tests** — demonstrates engineering discipline
3. **Soak test proof** — validates runtime claims
4. **Screenshots** — makes it visual
5. **Historical recorder** — would add real analytical value (but only after tests)

### 9. What is the technical "north star"?
**"A live market microstructure visualization cockpit that honestly represents what it can and cannot see."**

The north star is not "make it more feature-rich." The north star is "make it more trustworthy." Every feature should pass the test: "Does this make the visualization more honest, or just more busy?"

### 10. Final recommendation
**Continue. Focus on validation, not features.** The next month should be:
- Week 1: Soak test + unit tests + deployment
- Week 2: Error boundaries + screenshots + README polish
- Week 3: Integration tests + historical recorder (if tests are solid)
- Week 4: Portfolio presentation + client/recruiter outreach

Do not add features until the existing features are validated and tested.

---

## L. Immediate Action Plan

### Today (Day 1)
1. ✅ Run `npm run build` — PASS (verified)
2. Run 30-minute soak test with Chrome memory monitoring
3. Capture screenshots for portfolio
4. Commit and push consulting report

### This Week (Days 2-7)
1. Write order book unit tests (12 tests)
2. Write coordinate adapter unit tests (4 tests)
3. Write bubble classification unit tests (4 tests)
4. Deploy to Vercel or Netlify
5. Update README with screenshots and live demo link

### Next Week (Days 8-14)
1. Add error boundaries to major components
2. Add loading state for initial connection
3. Fix minor issues found during soak test
4. Write integration tests for order book state machine

### End of Month
- Portfolio-ready with: live demo, screenshots, unit tests, soak test proof, honest documentation
- Ready to present to recruiters/clients as a technical showcase

---

*Report generated by project consultant — 2026-05-11*
*Build verified: `tsc && vite build` — 0 errors, 76 modules, 401.8 KB*
*Latest commit: `efaaad3` — "harden fused execution chart acceptance"*
