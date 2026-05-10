# Order Book Supremacy Report

## Strategic Correction

**Previous approach (wrong):** Condition every visual tool on `orderBookHealth`, disable overlays when the book is not HEALTHY, make bubbles/heatmap/footprint disappear because strict book sync is not perfect, add UI workarounds around an unstable book.

**Correct approach:** Order book connectivity and synchronization supremacy FIRST. The order book engine is foundational — it must be as reliable as possible. Only after the order book engine is stable should visual layers consume it. Trade-based tools must never depend on order book state.

## What Was Fixed

### 1. Order Book Engine Hardening

**Timeouts to prevent stuck states:**
- `SNAPSHOT_REQUEST_TIMEOUT_MS = 10,000` — REST snapshot fetch timeout
- `SNAPSHOT_LOADING_MAX_MS = 20,000` — max time in SNAPSHOT_LOADING state
- `SYNCING_MAX_MS = 15,000` — max time waiting for overlap event
- `STRICT_SYNC_ATTEMPT_MAX_MS = 40,000` — max total strict sync attempt
- `MAX_STRICT_FAILURES_BEFORE_DEGRADED = 3` — consecutive failures before DEGRADED

**Timeout checker** runs every 2 seconds, catches stuck SNAPSHOT_LOADING/SYNCING states and forces recovery.

**Consecutive failure tracking** — `consecutiveStrictFailures` counter ensures DEGRADED is reached after repeated failures, not just within a time window.

### 2. DEBUG_BOOK Diagnostics

Structured logging for order book internals, disabled by default:
```js
localStorage.setItem('DEBUG_BOOK', '1')
```

Emits structured objects for:
- `strict_sync_start` — when strict sync begins
- `snapshot_success` — snapshot fetch result with timing
- `first_overlap_result` — whether valid overlap was found
- `sequence_gap` — pu mismatch or gap detection
- `fallback_start` — entering DEGRADED mode
- `fallback_update` — depth20 fallback data (sampled every 5s)
- `book_stale` — stale state transition
- `manual_resync` — user-triggered resync

### 3. Tool Decoupling

**Trade-based tools (independent of orderBookHealth):**
- Bubbles — always draw if trade data exists
- Time & Sales — trade stream only
- Large trade activity — trade data only
- Footprint — depends on trade/cluster data, not book health

**Book-based tools (use best available book):**
- Heatmap/liquidity — HEALTHY: strict, DEGRADED: top-20, RESYNCING: last known, STALE: dimmed
- DOM — same as heatmap
- Spread — same as heatmap
- State badges — compact, non-destructive

**Shared chart tools (never disabled by book state):**
- Candles, crosshair, GO LIVE, time/price axis, zoom/pan

### 4. Smart Flow Bubbles

Removed RAW/CLU/HYBRID user-facing mode selector. Replaced with Smart Flow:
- Always render raw large trade bubbles when available
- If cluster data exists, enrich with outline context
- If cluster data does not exist, raw bubbles still render
- No user-facing mode switch
- No blank output mode
- No mode switch can break rendering

### 5. Overlay Safety

- Canvas background always transparent
- First operation per frame: `clearRect`
- `ctx.save()`/`ctx.restore()` around every layer
- `globalAlpha` reset after every layer
- State badge uses extremely low alpha (0.03–0.06) tint, NOT opaque fill
- Debug overlay disabled by default (`DEBUG_OVERLAY` flag)

### 6. Health Message Separation

Trade health, book health, and ticker health are fully separated:
- Trade messages never mention book issues
- Book messages never mention trade issues
- Each stream has independent error tracking

## Files Changed

| File | Changes |
|------|---------|
| `src/connectors/localOrderBook.ts` | DEBUG_BOOK diagnostics, timeout checker, consecutive failure tracking, snapshot request timeout |
| `src/utils/executionOverlayRenderer.ts` | Smart Flow bubbles, overlay safety, removed RAW/CLU/HYBRID rendering branches |
| `src/components/Toolbar.tsx` | Removed RAW/CLU/HYBRID selector buttons |
| `src/components/ExecutionChart.tsx` | Removed displayMode from overlay frame |
| `src/stores/marketStore.ts` | Removed displayMode/displayConfig state and actions |
| `src/types/executionChart.ts` | Removed DisplayMode from OverlayFrame |

## Remaining Risks

1. **Browser visual test not run** — all changes verified by code audit and build only
2. **Bubble threshold may need tuning** — $5000 notional for BTC may need adjustment based on actual trade flow
3. **Cluster enrichment is subtle** — cluster outlines drawn at very low alpha, may need visibility tuning
4. **Timeout values are conservative** — may need adjustment based on real network conditions
5. **depth20 fallback is top-20 only** — does not provide full book depth
