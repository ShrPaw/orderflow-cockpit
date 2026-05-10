# Interaction and Overlay Fix Report

Generated: 2026-05-11

## A. Root Cause of Zoom/Pan Not Working

**File:** `src/components/ExecutionChart.tsx`

**Cause:** A full-chart interactive `<div>` with `zIndex: 11` and `pointerEvents: 'auto'` was layered on top of the Lightweight Charts canvas. This div captured ALL mouse events (wheel, drag, click, mousemove) before Lightweight Charts could process them for zoom/pan interaction.

The div was originally intended for tooltip mouse tracking and GO LIVE click detection, but its `pointerEvents: 'auto'` on the full chart area blocked all native LW Charts interaction.

**Fix:** Removed the full-chart interactive div entirely. Replaced with:
- Container `mousemove` listener (passive, `{ passive: true }`) for tooltip tracking
- Small HTML `<button>` for GO LIVE with `pointerEvents: 'auto'` only on that element
- Overlay canvas remains `pointerEvents: 'none'`

## B. Root Cause of Liquidity Band During SNAPSHOT_LOADING

**File:** `src/utils/executionOverlayRenderer.ts`

**Cause:** During BUFFERING/SNAPSHOT_LOADING/SYNCING, the order book engine preserves `bids`/`asks` from the previous connection (doesn't clear them on reconnect). The overlay renderer checked `frame.bids.length > 0` and drew them as valid liquidity.

**Fix:** Added `isTransitionalState` check — skip liquidity rendering entirely during CONNECTING, BUFFERING, SNAPSHOT_LOADING, SYNCING states. Also added distance filtering (max 1.5% from price, fallback to 3%) to prevent distant levels from creating huge bands.

## C. What Was Fixed

### Interaction
- Removed full-chart interactive div that blocked zoom/pan
- Overlay canvas: `pointerEvents: 'none'`
- GO LIVE: small HTML button with `pointerEvents: 'auto'`
- Mouse tracking: passive container listener
- No `preventDefault` or `stopPropagation` calls
- Lightweight Charts owns ALL chart interactions

### Liquidity State Semantics
- HEALTHY: full opacity, strict book
- DEGRADED: 70% dim, top-20 fallback
- RESYNCING: 40% dim, last known book
- STALE: 25% dim, last known book
- BUFFERING/SNAPSHOT_LOADING/SYNCING: NO liquidity drawn, badge only
- ERROR/DISCONNECTED: no liquidity, badge only

### Band Height Clamping
- Max band height: 6px
- Max alpha: 0.26 * stateDimFactor
- Distance filter: 1.5% from live price (3% fallback)
- Top 5 levels per side only

## D. Browser Test
**NOT RUN**

## E. Visual Result
- Zoom works: NOT VERIFIED (code fix applied, needs browser)
- Pan works: NOT VERIFIED (code fix applied, needs browser)
- Bubbles visible: NOT VERIFIED
- Liquidity non-destructive: NOT VERIFIED

## F. Files Changed
| File | Change |
|------|--------|
| `src/components/ExecutionChart.tsx` | Removed interactive div, passive mouse tracking, HTML GO LIVE button |
| `src/utils/executionOverlayRenderer.ts` | Distance filter for liquidity levels |
| `docs/INTERACTION_AND_OVERLAY_FIX_REPORT.md` | New |
