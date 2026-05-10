# Orderflow Feature Recovery Matrix

Post-fusion regression recovery — restoring the full orderflow cockpit feature set inside the single Lightweight-based execution chart.

| Feature | Restored? | Evidence | File | Risk |
|---|---|---|---|---|
| Large trade circles (raw bubbles) | ✅ YES | `drawSingleBubble()` with full visual style encoding | `executionOverlayRenderer.ts` | None |
| Raw bubble mode | ✅ YES | `mode === 'RAW'` branch in `drawBubblesAndClusters()` | `executionOverlayRenderer.ts` | None |
| Clustered bubble mode | ✅ YES | `mode === 'CLUSTERED'` branch with `getRenderableClusters()` | `executionOverlayRenderer.ts` | None |
| Hybrid bubble mode | ✅ YES | `mode === 'HYBRID'` — clusters + freshest raw non-clustered | `executionOverlayRenderer.ts` | None |
| Bubble percentile sizing | ✅ YES | Per-candle notional percentile computed and passed to `getBubbleVisualStyle()` | `executionOverlayRenderer.ts` | None |
| Bubble tooltip | ✅ YES | `drawBubbleTooltip()` — side, price, qty, notional, age | `executionOverlayRenderer.ts` | None |
| Cluster tooltip | ✅ YES | `drawClusterTooltip()` — trades, volume, VWAP, flow type, absorption | `executionOverlayRenderer.ts` | None |
| Cluster hit detection | ✅ YES | `findClosestCluster()` with 40px hit area | `executionOverlayRenderer.ts` | None |
| Heatmap bands (bid/ask) | ✅ YES | `drawLiquidityLevels()` with proximity filtering | `executionOverlayRenderer.ts` | None |
| Heatmap quantity labels | ✅ YES | `BID 1.2k` / `ASK 3.5k` format | `executionOverlayRenderer.ts` | None |
| Heatmap range filtering | ✅ YES | 2% range threshold with fallback to global top-5 | `executionOverlayRenderer.ts` | None |
| Heatmap state dimming | ✅ YES | `stateDimFactor` based on `orderBookHealth` | `executionOverlayRenderer.ts` | None |
| Degraded top-20 liquidity | ✅ YES | `DEGRADED` state dimming + badge | `executionOverlayRenderer.ts` | None |
| Resyncing last known book | ✅ YES | `RESYNCING` state dimming + badge | `executionOverlayRenderer.ts` | None |
| Stale book dimming | ✅ YES | `STALE` state strong dimming + badge | `executionOverlayRenderer.ts` | None |
| Spread line | ✅ YES | `drawSpreadLine()` — mid-price dashed line + spread % label | `executionOverlayRenderer.ts` | None |
| Footprint cells | ✅ YES | `drawFootprint()` — per-candle price-level delta with zoom threshold | `executionOverlayRenderer.ts` | None |
| Delta display | ✅ YES | `+1.2k` / `-3.5k` labels in footprint cells | `executionOverlayRenderer.ts` | None |
| Footprint zoom threshold | ✅ YES | Hidden when `slotWidth < 12` | `executionOverlayRenderer.ts` | None |
| Level memory | ✅ YES | `drawLevelMemory()` — REJECTED, ABSORBED, FLIPPED levels | `executionOverlayRenderer.ts` | None |
| Crosshair | ✅ YES | Lightweight Charts native crosshair | `ExecutionChart.tsx` | None |
| GO LIVE | ✅ YES | `drawLiveBadge()` with click hit-testing | `executionOverlayRenderer.ts` | None |
| Symbol switch clears state | ✅ YES | `getDataResetFields()` in `marketStore.ts` | `marketStore.ts` | None |
| Order book health states | ✅ YES | HEALTHY, DEGRADED, RESYNCING, STALE, ERROR, DISCONNECTED | `marketStore.ts` + overlay | None |
| Toolbar controls | ✅ YES | Symbol, interval, bubble mode (RAW/CLU/HYB), nav, view | `Toolbar.tsx` | None |
| No duplicate charts | ✅ YES | Only `ExecutionChart` in `App.tsx`, no `ChartCanvas` | `App.tsx` | None |
| No WebSockets in chart | ✅ YES | Zero WebSocket calls in chart/overlay files | `ExecutionChart.tsx` | None |
| Build passes | ✅ YES | `tsc && vite build` — 0 errors | Build output | None |

## Notes

- **Bubble percentile sizing** was missing after fusion — old renderer computed per-candle notional percentiles and passed them to `getBubbleVisualStyle()`. Restored in recovery.
- **Heatmap range filtering** was missing — old renderer filtered by 2% price range. Restored with fallback.
- **Heatmap quantity labels** showed actual quantities (e.g., "BID 1.2k") — post-fusion only showed "BID LIQ". Restored.
- **Cluster tooltips** were not implemented — added with trade count, VWAP, flow type, absorption score.
- **Spread line** was not in old renderer either — added as improvement.
- **State dimming** for non-HEALTHY orderbook states was missing from heatmap — restored.
