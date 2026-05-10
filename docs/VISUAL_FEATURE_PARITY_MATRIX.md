# Visual Feature Parity Matrix

Generated: 2026-05-11 | Branch: `main`

## Baseline

- **Last good cockpit commit:** `05d2a67` — "fix: strict order book sync and degraded fallback" (custom ChartCanvas + chartRenderer.ts)
- **Fusion commit:** `315099c` — "fuse orderflow overlays into lightweight execution chart"
- **Current commit:** `d41aeff` + bubble coordinate fix

## Parity Comparison

| Capability | Last Good Cockpit (`05d2a67`) | Current Chart | Status | Required Action |
|---|---|---|---|---|
| **A. Large trade circles / bubbles** | | | | |
| Visible large trade circles | ✅ Full — index-based positioning at candle center | ✅ Fixed — uses candleTime for LW Charts coord mapping | PASS | — |
| Adaptive notional sizing | ✅ Percentile-based | ✅ Percentile-based (same algorithm) | PASS | — |
| Buy/sell distinction | ✅ Green/red fill + side notch | ✅ Same color system | PASS | — |
| Opacity/decay | ✅ Age-phase modifiers | ✅ Same age-phase system | PASS | — |
| Max visible cap | ✅ 60 bubbles | ✅ 60 bubbles (MAX_RENDERED_BUBBLES) | PASS | — |
| Tooltip | ✅ Hover tooltip | ✅ Hover tooltip | PASS | — |
| Hover hitbox | ✅ 30px radius | ✅ 30px radius | PASS | — |
| Recent bubble visibility | ✅ FRESH/ACTIVE/FADING/EXPIRED | ✅ Same phases | PASS | — |
| Cluster enrichment | ✅ Cluster outlines + badges | ✅ Cluster outlines + trade count badges | PASS | — |
| Independent of book HEALTHY | ✅ Drawn regardless | ✅ Drawn regardless (Smart Flow) | PASS | — |
| **B. Liquidity / heatmap** | | | | |
| Bid/ask liquidity bands | ✅ Horizontal bands | ✅ Horizontal bands | PASS | — |
| Intensity scaling | ✅ By relative qty | ✅ By relative qty | PASS | — |
| Quantity labels | ✅ BID/ASK labels | ✅ BID/ASK labels | PASS | — |
| Spread line | ✅ Mid-price dashed line | ✅ Mid-price dashed line + spread % | PASS | — |
| DEGRADED top-20 | ✅ 70% dim | ✅ 70% dim | PASS | — |
| RESYNCING last-known | ✅ 40% dim | ✅ 40% dim | PASS | — |
| STALE dimming | ✅ 25% dim | ✅ 25% dim | PASS | — |
| No full-screen fill | ✅ Bands only | ✅ Bands only | PASS | — |
| **C. Footprint / orderflow** | | | | |
| Bid/ask cells | ✅ Per-candle clipped | ✅ Per-candle clipped | PASS | — |
| Delta display | ✅ +/- labels | ✅ +/- labels | PASS | — |
| Visible at high zoom | ✅ bodyW >= 14 | ✅ slotWidth >= 12 | PASS | — |
| Text readability | ✅ Adaptive font size | ✅ Adaptive font size | PASS | — |
| Candle-slot alignment | ✅ Index-based | ✅ Uses candle.openTime | PASS | — |
| **D. Chart interaction** | | | | |
| Zoom | ✅ Custom wheel handler | ✅ LW Charts built-in | PASS | — |
| Pan | ✅ Custom drag handler | ✅ LW Charts built-in | PASS | — |
| Follow-live / GO LIVE | ✅ Scroll-to-real-time | ✅ scroll-to-real-time + pill | PASS | — |
| Crosshair | ✅ Custom drawn | ✅ LW Charts built-in | PASS | — |
| Time axis | ✅ Custom drawn | ✅ LW Charts built-in | PASS | — |
| Price axis | ✅ Custom drawn | ✅ LW Charts built-in | PASS | — |
| **E. UI tools** | | | | |
| Symbol selector | ✅ | ✅ | PASS | — |
| Interval selector | ✅ | ✅ | PASS | — |
| Connection state | ✅ | ✅ Per-stream separated | PASS | — |
| Book state | ✅ | ✅ | PASS | — |
| Side panel | ✅ | ✅ | PASS | — |
| Time & sales | ✅ | ✅ | PASS | — |
| DOM/book panel | ✅ | ✅ | PASS | — |
| Delta/CVD | ✅ | ✅ | PASS | — |
| No RAW/CLU/HYBRID | ❌ Had mode selector | ✅ Removed — Smart Flow | PASS | — |
| **F. Stream/data correctness** | | | | |
| Ticker independent | ✅ | ✅ | PASS | — |
| Trades independent | ✅ | ✅ | PASS | — |
| Order book independent | ✅ | ✅ | PASS | — |
| Trade bubbles independent from book | ✅ | ✅ | PASS | — |
| HEALTHY strict book | ✅ | ✅ | PASS | — |
| DEGRADED fallback | ✅ | ✅ | PASS | — |
| No mixed trade/book errors | ✅ | ✅ | PASS | — |

## Critical Fixes Applied

1. **Bubble coordinate mapping** — Changed from `bubble.timestamp` (exact trade time, returns null from LW Charts) to `bubble.candleTime` (candle open time, always in chart data)
2. **Cluster coordinate mapping** — Added `snapToCandleTime()` helper to snap trade timestamps to candle boundaries
3. **Hit testing** — Updated `findClosestBubble` and `findClosestCluster` to use snapped times

## Browser Test Status

**NOT RUN** — no browser available. All features marked PASS based on code audit + build verification only.

## Remaining Risks

1. Bubble coordinates now use candle center X (via candleTime) — this matches old behavior but means bubbles cluster at candle center rather than at exact trade time within the candle
2. Visual density at high zoom may differ from old renderer due to LW Charts pixel mapping differences
3. Browser visual verification needed to confirm bubble visibility under live trade conditions
