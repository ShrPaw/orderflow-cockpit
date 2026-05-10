# Visual Regression Review

Generated: 2026-05-11

## What Regressed

After the fusion from custom ChartCanvas to Lightweight Charts (`315099c`), the following visual regressions occurred:

1. **Bubbles not visible** — The coordinate adapter used `timePriceToPixel(bubble.timestamp, ...)` which calls `chart.timeScale().timeToCoordinate(tradeTimestamp)`. Trade timestamps (exact execution times) don't match chart data points (candle open times), so `timeToCoordinate` returned `null` → all bubbles skipped.

2. **RAW/CLU/HYBRID mode selector** — Exposed internal rendering strategy to users, created failure modes where switching to CLUSTERED with no cluster data showed nothing.

3. **Overlay state badge could fill entire chart** — Fixed in prior commit (`6be5bc5`) — hex color was used as fillStyle without rgba conversion.

## What Was Restored

1. **Bubble visibility** — Fixed coordinate mapping to use `bubble.candleTime` (candle open time) instead of `bubble.timestamp` (exact trade time). This matches the old renderer behavior where bubbles were positioned at candle center.

2. **Smart Flow Bubbles** — Removed RAW/CLU/HYBRID. Always renders raw bubbles with optional cluster enrichment. No mode switch can blank the output.

3. **Cluster coordinate mapping** — Added `snapToCandleTime()` helper to snap trade timestamps to candle boundaries for reliable LW Charts coordinate mapping.

4. **Hit testing** — Updated `findClosestBubble` and `findClosestCluster` to use snapped candle times.

5. **Overlay safety** — Transparent canvas, clearRect first, save/restore per layer, globalAlpha reset.

6. **Order book timeouts** — SNAPSHOT_LOADING/SYNCING can no longer hang forever.

7. **Tool decoupling** — Trade-based tools (bubbles, footprint, T&S) draw regardless of orderBookHealth.

## Visual Parity Status

**PARTIAL** — Code audit shows all features are implemented and should render. Browser visual test NOT RUN.

Key difference from old renderer: Bubbles now use Lightweight Charts' pixel coordinates instead of custom index-based positioning. This means:
- Bubbles align to candle centers (same as old renderer)
- Price axis scaling is handled by LW Charts (more accurate than old custom scaling)
- Zoom/pan is handled by LW Charts (smoother than old custom handlers)

## Remaining Risks

1. **Browser test needed** — Cannot confirm bubble visibility without live visual test
2. **Bubble density** — Percentile sizing is computed across ALL bubbles, not just visible ones. May need adjustment.
3. **Footprint at extreme zoom** — LW Charts' timeToCoordinate may behave differently at very high zoom levels
