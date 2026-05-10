# Fusion Report — Lightweight Charts + Orderflow Overlay

## Correction Summary

Commit `0556c97` ("unify execution chart architecture") prematurely removed TradingView Lightweight Charts and made custom Canvas2D the only chart engine. This was a regression — Lightweight Charts provides professional-grade candlestick rendering, native zoom/pan, crosshair, time/price scales, and scroll-to-real-time that would take thousands of lines to replicate.

This fusion restores Lightweight Charts as the professional base layer while preserving all orderflow methodology overlays on a Canvas2D layer positioned on top.

## Final Architecture

```
┌─────────────────────────────────────────────┐
│  TradingView Lightweight Charts v5.2.0      │
│  (candlesticks, volume histogram,           │
│   time scale, price scale, native zoom/pan, │
│   crosshair, scroll-to-real-time)           │
├─────────────────────────────────────────────┤
│  Overlay Canvas2D (pointer-events: none)    │
│  (liquidity, footprint, bubbles, clusters,  │
│   tooltip, state badges, GO LIVE)           │
└─────────────────────────────────────────────┘
```

**One chart surface. One RAF loop. One data model.**

## What Lightweight Charts Owns

| Feature | Implementation |
|---|---|
| Candlestick rendering | `CandlestickSeries` — OHLC with wicks |
| Volume histogram | `HistogramSeries` — color-coded buy/sell |
| Time scale | Native zoom/pan, time labels, right offset |
| Price scale | Auto-scaling, price labels, margins |
| Crosshair | Native crosshair with price/time labels |
| Zoom/Pan | Wheel zoom, drag pan, focal-point preservation |
| Scroll-to-real-time | `timeScale().scrollToRealTime()` |
| Resize | `ResizeObserver` → `chart.resize()` |

## What the Custom Overlay Owns

| Feature | File |
|---|---|
| Liquidity levels (bid/ask bands) | `executionOverlayRenderer.ts` |
| Level memory (horizontal dashed lines) | `executionOverlayRenderer.ts` |
| Footprint cells (volume-at-price) | `executionOverlayRenderer.ts` |
| Bubbles (aggressive flow events) | `executionOverlayRenderer.ts` |
| Auction clusters | `executionOverlayRenderer.ts` |
| Bubble tooltip (hover info) | `executionOverlayRenderer.ts` |
| Order book state badges | `executionOverlayRenderer.ts` |
| GO LIVE / LIVE indicator | `executionOverlayRenderer.ts` |

## Files Created

| File | Purpose |
|---|---|
| `src/components/ExecutionChart.tsx` | Main chart component — Lightweight Charts + overlay canvas |
| `src/utils/executionOverlayRenderer.ts` | All overlay drawing logic (8 layers) |
| `src/utils/lightweightCoordinateAdapter.ts` | Coordinate mapping (time/price → pixel) |
| `src/utils/lightweightChartAdapters.ts` | Candle data → Lightweight Charts format |
| `src/types/executionChart.ts` | Types for overlay frame, render context, chart API |

## Files Removed (archived to `../orderflow-cockpit-archive-old-chart/`)

| File | Reason |
|---|---|
| `src/components/ChartCanvas.tsx` | Replaced by ExecutionChart.tsx |
| `src/utils/chartRenderer.ts` | Replaced by executionOverlayRenderer.ts + Lightweight Charts |

## Files Modified

| File | Change |
|---|---|
| `src/App.tsx` | Import ExecutionChart instead of ChartCanvas |
| `package.json` | Added `lightweight-charts` dependency |
| `docs/ARCHITECTURE.md` | Rewritten for dual-layer architecture |
| `docs/QA_CHECKLIST.md` | Updated chart QA section |
| `docs/PORTFOLIO_SUMMARY.md` | Updated architecture description |
| `README.md` | Updated features and tech stack |

## What Was Preserved

- ✅ All 10 order book health states (DISCONNECTED, CONNECTING, BUFFERING, SNAPSHOT_LOADING, SYNCING, HEALTHY, RESYNCING, DEGRADED, STALE, ERROR)
- ✅ Honest state labels — DEGRADED shows "DEGRADED TOP-20 BOOK", not faked HEALTHY
- ✅ Strict diff-depth sync + DEGRADED depth20 fallback (localOrderBook.ts unchanged)
- ✅ Bubble methodology (bubbleMethodology.ts unchanged)
- ✅ Auction clusters (auctionClusters.ts unchanged)
- ✅ Level memory (levelMemory.ts unchanged)
- ✅ All bubble states: PENDING, ACCEPTED, REJECTED, ABSORBED, EXHAUSTED, INVALIDATED, RESISTANCE
- ✅ Display modes: RAW, CLUSTERED, HYBRID
- ✅ Bubble hover tooltip
- ✅ Footprint cells at high zoom
- ✅ Liquidity bands from order book
- ✅ GO LIVE / LIVE pill indicator
- ✅ Symbol switching
- ✅ Demo mode
- ✅ Ref-based data flow (no React re-render per tick)
- ✅ Toolbar integration via `window.__chartApi`

## What Was Changed

- Chart engine: custom Canvas2D → TradingView Lightweight Charts + Canvas2D overlay
- Coordinate system: manual `makeCoords()` → Lightweight Charts `timeToCoordinate()`/`priceToCoordinate()`
- Candle rendering: custom Canvas2D → `CandlestickSeries`
- Volume rendering: custom Canvas2D → `HistogramSeries`
- Zoom/Pan: custom drag handlers → native Lightweight Charts handling
- Crosshair: custom Canvas2D → native Lightweight Charts crosshair
- Price/Time scales: custom Canvas2D → native Lightweight Charts scales

## What Was Removed

- Custom candlestick rendering code (~200 lines)
- Custom volume bar rendering code (~30 lines)
- Custom grid drawing code (~80 lines)
- Custom crosshair code (~50 lines)
- Custom price scale code (~100 lines)
- Custom time axis code (~80 lines)
- Custom zoom/pan handlers (~200 lines)
- ViewState type and all drag state management
- All `handleWheel`, `handleDragStart`, `handleDragMove`, `handleDragEnd` functions

## Performance Safeguards

- **Single chart instance** — `createChart()` called once in mount effect
- **Single series** — `addSeries(CandlestickSeries)` + `addSeries(HistogramSeries)` called once
- **Single RAF loop** — starts once, reads refs, never restarts on market ticks
- **Overlay integrated into RAF** — no separate timer or render loop
- **Ref-based data flow** — store subscription → refs → RAF reads refs
- **No React render storm** — chart data flows through refs, not React state
- **Cleanup on unmount** — chart.remove(), observer.disconnect(), cancelAnimationFrame()

## Order Book State Compatibility

All 10 states are rendered honestly on the overlay canvas:

| State | Badge | Background Tint |
|---|---|---|
| HEALTHY | (none) | (none) |
| DISCONNECTED | (none) | (none) |
| CONNECTING | ⏳ CONNECTING… | Subtle blue |
| BUFFERING | ⏳ BUFFERING… | Subtle blue |
| SNAPSHOT_LOADING | ⏳ LOADING SNAPSHOT… | Subtle blue |
| SYNCING | ⏳ SYNCING… | Subtle blue |
| RESYNCING | 🔄 RESYNCING — last known book | Subtle amber |
| DEGRADED | 📉 DEGRADED TOP-20 BOOK | Subtle red |
| STALE | ⚠ STALE BOOK | Subtle amber |
| ERROR | ❌ BOOK ERROR | Subtle red |

## Build Output

```
> orderflow-cockpit@3.0.0 build
> tsc && vite build

vite v5.4.21 building for production...
transforming...
✓ 76 modules transformed.
rendering chunks...
rendering chunks...
computing gzip size...
dist/index.html                   0.46 kB │ gzip:   0.30 kB
dist/assets/index-sRQUIry-.css   17.01 kB │ gzip:   3.70 kB
dist/assets/index-BD-C21Mp.js   401.77 kB │ gzip: 127.11 kB
✓ built in 1.51s
```

**0 errors, 0 warnings.** Bundle: 240 KB → 401 KB (+161 KB from lightweight-charts).

## Commit & Push

- **Commit:** `315099c` — "fuse orderflow overlays into lightweight execution chart"
- **Push:** ❌ Failed — no GitHub credentials configured in this environment
  ```
  fatal: could not read Username for 'https://github.com': No such device or address
  ```
  Manual push required: `git push origin main`

## Remaining Risks

1. **Overlay coordinate accuracy** — `timeToCoordinate()` returns null for off-screen candles. Footprint rendering iterates all candles and skips off-screen ones. This is correct but may miss edge cases where a candle is partially visible.

2. **Price line recreation** — The price line is removed and recreated every RAF frame. This is how the old code worked too, but Lightweight Charts may have a more efficient `update()` method for price lines.

3. **Volume series update frequency** — Both closed candles and current candle update the volume series. If `setData()` and `update()` race, the last call wins. The current code calls `setData()` only when a new candle appears, and `update()` for the live candle, which is correct.

4. **Crosshair event handling** — The overlay canvas has `pointer-events: none` and a transparent div captures mouse events for tooltip. Lightweight Charts handles its own crosshair natively. The two systems coexist but the overlay tooltip only shows when the mouse is directly over a bubble (30px hit radius).

5. **Bundle size increase** — lightweight-charts adds ~161 KB gzipped. This is acceptable for a professional charting library and is much less than the ~500 KB+ of a full TradingView widget.
