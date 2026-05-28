# AUDIT REPORT — Orderflow Cockpit

**Date:** 2026-05-27 (Cycle 1 — Full Multi-Angle Audit)
**Auditor:** Claude Opus 4.7 (automated: Architecture, Security, Frontend UX, Code Quality)
**Project:** Orderflow Cockpit — React/TS real-time order flow trading dashboard

---

## P0 — CRITICAL (Data integrity / crash risk / broken UI)

| ID | Category | File(s) | Issue | Status |
|----|----------|---------|-------|--------|
| P0-1 | Reliability | `localOrderBook.ts:392-394` | Spread sanity check used qty `[1]` instead of price `[0]` — book corruption guard non-functional | **FIXED** |
| P0-2 | Reliability | `App.tsx:143-148` | Stale closure in resyncOrderBook override | **FIXED** |
| P0-3 | Security | `vite.config.ts:8` | Dev server bound to 0.0.0.0 (`host: true`) — combined with esbuild vuln, maximizes attack surface | OPEN |
| P0-4 | Security | `package.json` | esbuild <=0.24.2 vulnerability (GHSA-67mh-4wv8-2f99) — any website can read dev server responses | OPEN |
| P0-5 | UX/CSS | `App.css` | Missing `@keyframes pulse` and `@keyframes pulse-live` — 7 CSS animation references silently fail, connection error/live indicators don't pulse | OPEN |
| P0-6 | UX/CSS | `App.css` | 40+ CSS class names used in components but completely missing from stylesheets (AlertRulesPanel, LiquidityLevelsPanel, FlowEventsPanel, MarketSnapshotPanel, overlay toggles) — 5 components render broken/unstyled | OPEN |

## P1 — HIGH (Degraded UX / data leaks / reliability / accessibility)

| ID | Category | File(s) | Issue | Status |
|----|----------|---------|-------|--------|
| P1-1 | Code Quality | `levelMemory.ts:108-125` | `copyLevel()` shares Set references — external consumer can mutate internal dedup trackers | **FIXED** |
| P1-2 | Code Quality | `binanceTicker.ts:4` | Unbounded `CACHE` Map — never pruned, grows indefinitely | **FIXED** |
| P1-3 | Code Quality | `marketStore.ts` | Unbounded `lastAlertByKey` Map — only cleared on setSymbol | **FIXED** |
| P1-4 | Performance | `DeltaHistogram.tsx` | Depends on `candles`+`currentCandle` directly — re-triggers RAF loop on every trade | **FIXED** |
| P1-5 | Code Quality | `binanceAggTrade.ts:21` | Module-level `tradeDiag` singleton overwritten on each new connection | **FIXED** |
| P1-6 | Code Quality | `binanceTicker.ts:94-95` | Unsafe `tickSize!`/`stepSize!` non-null assertions — NaN if filter missing | **FIXED** |
| P1-7 | Security | `marketStore.ts:28,38`, `alerts.ts:98` | Prototype pollution vector in JSON.parse(localStorage) | OPEN |
| P1-8 | Security | `archive/.../app.js:805` | XSS via innerHTML with unsanitized symbol names | OPEN |
| P1-9 | Security | `vite.config.ts`, `index.html` | No Content-Security-Policy headers configured | OPEN |
| P1-10 | UX | `DeltaHistogram.tsx:76-80` | No empty/loading/disconnected/stale state — blank when no data, stale data with no warning | OPEN |
| P1-11 | UX | `FootprintChart.tsx` | No connection/stale awareness — shows stale data with no visual warning | OPEN |
| P1-12 | UX | `ChartCanvas.tsx` | No connection/stale/error/empty/loading state — looks normal during disconnection | OPEN |
| P1-13 | UX/CSS | `App.css` lines 1062+1434 | Major CSS duplication with conflicting values — Alert Feed has duplicate blocks, cascade picks wrong one | OPEN |
| P1-14 | UX/CSS | `App.css` lines 756+1334 | Major CSS duplication — Delta Strip and sparkline have conflicting duplicate definitions | OPEN |
| P1-15 | UX/CSS | `MarketHeader.tsx`, `App.css` | Stream dot CSS classes completely missing — status dots invisible | OPEN |
| P1-16 | UX/CSS | `Toolbar.tsx`, `App.css` | Overlay toggles (VWAP/Liq/VP) completely unstyled | OPEN |
| P1-17 | UX/Access | `CommandPalette.tsx:110` | `selectedIdx` reset race condition on rapid typing — selectedIdx may point to wrong item on Enter | OPEN |
| P1-18 | UX/Access | `CommandPalette.tsx` | No ARIA attributes, no screen-reader accessibility, no focus trap | OPEN |
| P1-19 | UX | Multiple | User cannot distinguish depth20 vs strict depth from main view — "Connected" hides book health | OPEN |
| P1-20 | UX | `SidePanel.tsx` | No timestamp on data — user cannot assess freshness | OPEN |

## P2 — MEDIUM (Performance / maintainability / config)

| ID | Category | File(s) | Issue | Status |
|----|----------|---------|-------|--------|
| P2-1 | Code Quality | `localOrderBook.ts` | depth20 `reconnectAttempt` counter never resets in `onopen` handler | **FIXED** |
| P2-2 | Performance | `chartRenderer.ts:585` | O(n) `clusterCandleIdx` lookup per cluster per frame | OPEN |
| P2-3 | Config | Multiple connectors | Hardcoded Binance API URLs — no central config, no env override | OPEN |
| P2-4 | Security | `localOrderBook.ts:877-880` | Unvalidated WebSocket message fields — no type checks after JSON.parse | OPEN |
| P2-5 | Reliability | `marketStore.ts` | Two separate `set()` calls in `processTrade` — race condition risk | **FIXED** |
| P2-6 | Reliability | `binanceAggTrade.ts:146-151` | `onerror` handler doesn't set `ws=null` or call `onStatus(false)` | **FIXED** |
| P2-7 | Performance | `ExecutionChart.tsx` | No dirty flag — redraws at 60fps unconditionally even when static | OPEN |
| P2-8 | Git Hygiene | `.gitignore` | Incomplete — missing .env variants, certs, archive/, IDE dirs, coverage/ | **FIXED** |
| P2-9 | Dependencies | `package.json` | All major dependencies 1-3 major versions behind latest | OPEN |
| P2-10 | Security | `CommandPalette.tsx:66` | `window.__chartApi` global — overwriteable by any script | OPEN |
| P2-11 | Git Hygiene | `archive/` | Insecure legacy code in source tree | OPEN |
| P2-12 | UX | `TradeFlow.tsx` | No stale/disconnected indicator when trade stream drops | OPEN |
| P2-13 | UX | `SessionStats.tsx:96-97` | Misleading empty state — shows livePrice as both H and L with 0% range | OPEN |
| P2-14 | UX | `SidePanel.tsx:232-284` | BubbleStates shows 7 zero rows when no bubbles — wastes space | OPEN |
| P2-15 | UX/CSS | `App.css:1352-1408` | Dead (unused) CSS — session-stats grid/bias/momentum classes never referenced | OPEN |
| P2-16 | UX/CSS | `App.css:1433-1505` | Second alert-feed block references component-unused class names | OPEN |
| P2-17 | UX | `Heatmap.tsx:157-184` | VPVR summary section completely unstyled | OPEN |
| P2-18 | UX | Multiple | Inconsistent connection status presentation across 3 locations | OPEN |
| P2-19 | UX/Access | `App.tsx:206-212` | Bottom tabs lack ARIA tab semantics | OPEN |
| P2-20 | UX | `Heatmap.tsx:82` | Price label uses `toFixed(0)` — incorrect for prices < 1 | OPEN |
| P2-21 | UX | `DepthRatioSparkline.tsx` | Shows ratio=1 (balanced) when book is empty — misleading | OPEN |
| P2-22 | UX | Toolbar, SidePanel | No responsive layout — items overflow on narrow screens | OPEN |

## P3 — LOW (Code hygiene / future-proofing)

| ID | Category | File(s) | Issue | Status |
|----|----------|---------|-------|--------|
| P3-1 | Code Quality | `aggregation.ts` | Module-level `bubbleCounter` never resets across symbol changes | **FIXED** |
| P3-2 | Security | `executionOverlayRenderer.ts:68-92` | Debug flag checkable via localStorage in production | OPEN |
| P3-3 | Security | `localOrderBook.ts:96-101` | Debug flag checkable via localStorage in production | OPEN |
| P3-4 | Docs | `README.md` | Still mentions "Demo mode" which no longer exists | OPEN |
| P3-5 | Security | `binanceTicker.ts:12` | Symbol not URL-encoded in REST API calls | OPEN |
| P3-6 | Security | `binanceKlines.ts:37` | Symbol/interval not URL-encoded in REST API calls | OPEN |
| P3-7 | Build | `vite.config.ts` | No hidden source maps for production error monitoring | OPEN |
| P3-8 | Reliability | Multiple REST callers | No rate limiting on Binance REST API calls | OPEN |
| P3-9 | UX/CSS | `App.css` | No `:focus-visible` styling on interactive buttons | OPEN |
| P3-10 | UX | `CommandPalette.tsx` | Ctrl+K toggle doesn't reset selectedIdx on reopen | OPEN |
| P3-11 | UX | `AssetSelector.tsx` | No keyboard navigation for instrument list | OPEN |
| P3-12 | UX/CSS | `App.css` | Missing `.dot.purple` CSS class — used in SidePanel but not defined | OPEN |
| P3-13 | UX | `MarketHeader.tsx`, `Toolbar.tsx` | Redundant price/change display in two locations | OPEN |
| P3-14 | UX | `AlertFeed.tsx:26-31` | Alert count badge appears/disappears without animation | OPEN |
| P3-15 | UX | `App.css` | `MarketSnapshotPanel` imbalance computation duplicated inline | OPEN |

---

## Audit Methodology

1. **Architecture & Reliability** — Treated all connectors as distributed systems. Inspected WebSocket lifecycle, generation tokens, exponential backoff, dual-stream book, state machines, closure freshness, ref-based rendering, store action atomicity.
2. **Security** — Dependency audit (npm audit + manual version check), input validation, XSS vectors, CORS, CSP, global exposure, prototype pollution, .gitignore completeness.
3. **Frontend UX** — Component structure, rendering patterns, CSS completeness (found 40+ missing classes), state subscription granularity, stale/disconnected state handling, accessibility (ARIA, focus management), responsive layout.
4. **Code Quality** — Dead code, shared references, type safety, module-level singletons, unbounded growth patterns.

## Positive Findings

- No hardcoded secrets or API keys
- No `dangerouslySetInnerHTML` in current React/TS code
- Source maps correctly disabled in production
- WebSocket connectors implement proper exponential backoff with jitter
- Trade connector properly validates numeric fields with `isFinite()`
- `tsconfig.json` has `strict: true`
- Minimal dependency footprint (4 runtime + 6 dev)
- Book validation with symbol-aware spread thresholds
- Generation tokens prevent stale socket events
- Dual-stream order book architecture is sound (depth20 immediate + strict parallel)
