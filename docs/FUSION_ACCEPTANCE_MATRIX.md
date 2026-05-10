# Fusion Acceptance Matrix

Generated: 2026-05-11 | Commit: `7febdef` (add fusion report)

## A. Chart Base Capabilities

| Capability | Status | Evidence | Risk | Action |
|---|---|---|---|---|
| Candlestick rendering | PASS | `CandlestickSeries` in `ExecutionChart.tsx:160`. OHLC with wicks, up/down colors. | None | — |
| Volume histogram | PASS | `HistogramSeries` in `ExecutionChart.tsx:167`. Positioned at bottom 15% via `priceScaleId: 'volume'` + `scaleMargins`. | None | — |
| Time scale | PASS | Native Lightweight Charts time scale. `timeVisible: true`, `rightOffset: 5`, `barSpacing: 8`. | None | — |
| Price scale | PASS | Native auto-scaling price scale with `scaleMargins: { top: 0.08, bottom: 0.08 }`. | None | — |
| Crosshair | PASS | `CrosshairMode.Normal` with dashed lines and label background. Native Lightweight Charts handling. | None | — |
| Zoom/pan | PASS | Native wheel zoom + drag pan. `handleScroll: { vertTouchDrag: false }`. | None | — |
| Scroll to live edge | PASS | `chart.timeScale().scrollToRealTime()` called when `followLive` is true. | None | — |
| Symbol switch reset | PASS | `useEffect([symbol])` calls `candleSeries.setData()` and `volumeSeries.setData()` with new data. Resets `lastCandleTimeRef`. | None | — |

## B. Orderflow Overlay Capabilities

| Capability | Status | Evidence | Risk | Action |
|---|---|---|---|---|
| Heatmap/liquidity | PASS | `drawLiquidityLevels()` in overlay renderer. Draws top-5 bid/ask bands by qty. Uses `priceToY()` for coordinate mapping. Bounds-checked (`y < 0 \|\| y > height` skips). | None | — |
| Bubbles | PASS | `drawBubblesAndClusters()` renders raw bubbles and clusters. `timePriceToPixel()` for positioning. `getBubbleVisualStyle()` for state/age encoding. | None | — |
| Bubble tooltip | PASS | `drawBubbleTooltip()` in overlay renderer. Shows side, state, notional, volume, price, age. Boundary-aware positioning. Called from RAF loop on mouse hover via `findClosestBubble()`. | None | — |
| Footprint clusters | PASS | `drawFootprint()` iterates candles, clips to candle body area. Shows volume-at-price bars with delta coloring. Only renders when `slotWidth >= 12`. | None | — |
| Order book state badge | PASS | `drawOrderBookStateBadge()` renders badges for all non-HEALTHY/DISCONNECTED states. Uses `STATE_CONFIG` map with icon, color, bgAlpha, label. | None | — |
| GO LIVE badge/click | **PARTIAL** | Badge renders correctly. Click detection via `goLiveRectRef`. **Issue: `drawLiveBadge()` called twice per frame** — once inside `drawExecutionOverlay()` (line 96) and once directly in RAF loop (line 413). Second call overwrites rect for hit detection. Double-render is wasteful but not a correctness bug. | Low | Extract `drawLiveBadge` from `drawExecutionOverlay()` to avoid double-draw. |

## C. Order Book States

| State | Status | Evidence | Risk | Action |
|---|---|---|---|---|
| HEALTHY | PASS | `localOrderBook.ts`: Set after strict diff-depth sync validates first overlapping event + pu continuity. Overlay shows no badge (correct). | None | — |
| RESYNCING | PASS | Set on `triggerResync()`. Preserves last known good book (does NOT clear `book.bids`/`book.asks`). Overlay shows "🔄 RESYNCING — last known book" badge with amber tint. | None | — |
| DEGRADED | PASS | Entered after 3 sync failures within 60s. Switches to `@depth20@100ms` partial stream. Overlay shows "📉 DEGRADED TOP-20 BOOK" badge with red tint. Recovery attempts every 30s. | None | — |
| STALE | PASS | 20s threshold with 30s initial grace. Only fires from HEALTHY/DEGRADED. Verifies `readyState === OPEN`. Overlay shows "⚠ STALE BOOK" badge with amber tint. | None | — |
| ERROR | PASS | Set on unrecoverable errors (snapshot fetch failure after retries). Overlay shows "❌ BOOK ERROR" badge with red tint. | None | — |
| CONNECTING | PASS | Set on initial `createLocalOrderBook()`. Overlay shows "⏳ CONNECTING…" badge with subtle blue tint. | None | — |
| BUFFERING | PASS | Set when diff stream opens but snapshot hasn't loaded yet. Overlay shows "⏳ BUFFERING…" badge. | None | — |
| SNAPSHOT_LOADING | PASS | Set during REST snapshot fetch. Overlay shows "⏳ LOADING SNAPSHOT…" badge. | None | — |
| SYNCING | PASS | Set after snapshot loads but before valid overlapping event found. Overlay shows "⏳ SYNCING…" badge. | None | — |
| DISCONNECTED | PASS | Set on intentional close. Overlay shows no badge (correct — `drawOrderBookStateBadge` returns early for HEALTHY/DISCONNECTED). | None | — |

## D. Runtime Safety

| Capability | Status | Evidence | Risk | Action |
|---|---|---|---|---|
| No reconnect loop | PASS | Generation tokens prevent stale reconnects. `cancelReconnectTimer()` before scheduling new. Rate-limited resync (5s cooldown). Exponential backoff with jitter. | None | — |
| No duplicate sockets | PASS | `connectionRegistry.ts` tracks active sockets per stream/symbol. Generation tokens invalidate stale events. `closeSocket()` detaches handlers before close. | None | — |
| No duplicate chart loops | PASS | Single `useEffect([], ...)` creates chart. Single RAF loop starts in mount effect. `running` flag + `cancelAnimationFrame` on cleanup. | None | — |
| No console spam | PASS | `devLog`/`devWarn` gated by `import.meta.env?.DEV`. Diagnostic `console.table` every 15s (acceptable). | None | — |
| No progressive slowdown | **NOT VERIFIED** | Requires browser runtime soak test. Code analysis shows: capped arrays (1500 candles, 200 trades, 500 bubbles, 3000 heatmap), single RAF loop, no unbounded timers. | Medium | Manual 5-minute soak test recommended. |
| Build passes | PASS | `tsc && vite build` — 0 errors, 76 modules, 401 KB bundle. | None | — |

## E. Additional Findings

| Finding | Severity | Details |
|---|---|---|
| Price line recreated every frame | Low | `removePriceLine()` + `createPriceLine()` called every RAF frame. Lightweight Charts may not have an `update()` method for price lines, but checking price change before recreation would reduce overhead. |
| `drawLiveBadge` double-render | Low | Called once inside `drawExecutionOverlay()` and once directly in RAF loop. The first call's return value (goLiveRect) is discarded. Should extract from overlay function. |
| `estimateSlotWidth` calls `timeToCoordinate` per frame | Low | Called in `drawFootprint()` which iterates all candles. However, `estimateSlotWidth` is called once per frame (not per candle), so impact is minimal. |
| `findClosestBubble` iterates all candles | Low | O(n) scan on every mouse move. With 1500 candle cap and typical bubble counts, this is acceptable. |

## Summary

| Category | PASS | PARTIAL | FAIL | NOT VERIFIED |
|---|---|---|---|---|
| Chart Base (A) | 8 | 0 | 0 | 0 |
| Orderflow Overlays (B) | 5 | 1 | 0 | 0 |
| Order Book States (C) | 10 | 0 | 0 | 0 |
| Runtime Safety (D) | 5 | 0 | 0 | 1 |
| **Total** | **28** | **1** | **0** | **1** |

**Verdict: Fusion is ACCEPTED.** 28/30 items PASS. 1 PARTIAL (GO LIVE double-render, cosmetic). 1 NOT VERIFIED (soak test, requires browser). 0 FAIL.
