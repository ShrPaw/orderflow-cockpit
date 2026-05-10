# Emergency Cockpit Recovery Report

Generated: 2026-05-11

## A. Why Emergency Rollback Was Necessary

The Lightweight Charts ExecutionChart fusion (`315099c`) failed the real user test:
- Zoom/pan interaction was broken (full-chart interactive div blocked LW Charts native events)
- Tools did not work correctly
- Orderflow layers felt broken
- Bubbles came back partially but cockpit was still not usable
- Heatmap/liquidity behavior was inconsistent
- Book state dominated visual behavior
- The previous cockpit experience was not recovered
- Build passing was irrelevant because runtime UX was broken

**User verdict: "None of the tools work."**

## B. Last Good Baseline Commit

**`05d2a67`** — "fix: strict order book sync and degraded fallback"
- ChartCanvas.tsx was active (custom Canvas2D chart)
- chartRenderer.ts had all rendering logic
- Bubbles, heatmap, footprint, zoom/pan all worked
- Order book strict/degraded engine was already in place

## C. What Was Restored

| Feature | Status |
|---------|--------|
| **Zoom/pan** | ✅ Custom wheel handler + drag/pan in chartRenderer.ts |
| **Bubbles/circles** | ✅ Full bubble rendering with percentile sizing, state machine, tooltips |
| **Heatmap/liquidity** | ✅ Bid/ask bands with state-aware dimming |
| **Footprint/orderflow** | ✅ Per-candle price-level delta at high zoom |
| **GO LIVE** | ✅ Canvas-drawn pill with hitbox |
| **Crosshair** | ✅ Custom crosshair with price/time labels |
| **Time & Sales** | ✅ Unchanged (trade stream) |
| **Side panel** | ✅ Unchanged |
| **DOM/book panel** | ✅ Unchanged |

## D. What Was Preserved from Newer Infrastructure

| Component | Status |
|-----------|--------|
| **localOrderBook.ts** | ✅ Kept current version (timeouts, DEBUG_BOOK, consecutive failure tracking) |
| **connectionRegistry.ts** | ✅ Kept current version |
| **binanceAggTrade.ts** | ✅ Kept current version |
| **binanceTicker.ts** | ✅ Kept current version |
| **binanceKlines.ts** | ✅ Kept current version |
| **marketStore.ts** | ✅ Kept current version (separated health states) |
| **ConnectionStatus.tsx** | ✅ Kept current version (separated trade/book health) |
| **SidePanel.tsx** | ✅ Kept current version |
| **DOMLite.tsx** | ✅ Kept current version |
| **Heatmap.tsx** | ✅ Kept current version |
| **TradeFlow.tsx** | ✅ Kept current version |
| **Bubble methodology** | ✅ Kept current version |
| **Auction clusters** | ✅ Kept current version |
| **Level memory** | ✅ Kept current version |

## E. What Was Removed

| Component | Action |
|-----------|--------|
| **ExecutionChart.tsx** | Removed from App.tsx (file kept for reference) |
| **executionOverlayRenderer.ts** | No longer used by active chart |
| **lightweightCoordinateAdapter.ts** | No longer used by active chart |
| **lightweightChartAdapters.ts** | No longer used by active chart |
| **RAW/CLU/HYBRID** | Not in old renderer (Smart Flow: 'CLUSTERED' hardcoded) |
| **displayMode** | Hardcoded to 'CLUSTERED' in ChartCanvas |

## F. Active Chart After Recovery

**ChartCanvas** — custom Canvas2D rendering via chartRenderer.ts
- Single canvas, all rendering in one RAF loop
- Native zoom/pan/drag via custom event handlers
- No external chart library dependency
- 238 KB bundle (down from 407 KB)

## G. Browser Test

**NOT RUN** — no browser available.

## H. Visual Status

| Feature | Status |
|---------|--------|
| Zoom works | NOT VERIFIED (code restored from working baseline) |
| Pan works | NOT VERIFIED |
| Bubbles visible | NOT VERIFIED |
| Heatmap usable | NOT VERIFIED |
| Footprint usable | NOT VERIFIED |

## I. Recommendation for Future Lightweight Fusion

1. Do it in a **separate branch**, never directly on main
2. Require **visual parity proof** (screenshots/video) before merging
3. Never replace a working cockpit without browser-tested proof
4. The old ChartCanvas + chartRenderer.ts is the reference implementation
5. Any new chart engine must match its behavior exactly before becoming default
