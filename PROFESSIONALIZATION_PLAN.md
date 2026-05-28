# PROFESSIONALIZATION PLAN — Orderflow Cockpit

**Created:** 2026-05-27
**Status:** Cycle 1 In Progress

---

## Priority Rule

> "If the project is currently broken: First make it run. If the project runs but is fragile: Make it resilient. If it is resilient: Make it professional." — Prompt instructions

The project builds and runs. P0 data-integrity bugs are fixed. Now making it resilient, then professional.

---

## Cycle 1 — Critical Fixes & Infrastructure (IN PROGRESS)

### Phase A: P0 Fixes (DONE)
- [x] P0-1: Fix spread sanity check using qty instead of price
- [x] P0-2: Fix stale closure in resyncOrderBook override

### Phase B: P1 Code Quality Fixes (IN PROGRESS)
- [x] P1-1: copyLevel() shared Set references → deep copy
- [x] P1-2: Unbounded CACHE Map → prune with max size
- [x] P1-3: Unbounded lastAlertByKey → prune stale entries
- [x] P1-4: DeltaHistogram RAF loop optimization
- [x] P1-5: tradeDiag singleton → per-connection diagnostics
- [x] P1-6: tickSize!/stepSize! non-null assertions → safe defaults
- [ ] P1-7: Prototype pollution in JSON.parse(localStorage)
- [ ] P1-8: XSS in archive innerHTML
- [ ] P1-9: Add Content-Security-Policy headers

### Phase C: P0 UX/CSS Fixes (PENDING)
- [ ] P0-5: Add missing @keyframes pulse and pulse-live
- [ ] P0-6: Add 40+ missing CSS classes for 5 components

### Phase D: P2 Quick Fixes (PENDING)
- [x] P2-1: depth20 reconnectAttempt reset
- [x] P2-5: processTrade race condition (dual set calls)
- [x] P2-6: onerror handler missing ws=null + onStatus(false)
- [x] P2-8: Expand .gitignore
- [ ] P2-20: Heatmap price label toFixed(0) fix
- [ ] P2-21: DepthRatioSparkline empty book ratio fix
- [ ] P3-12: Add .dot.purple CSS class

---

## Cycle 2 — Resilience & UX (PLANNED)

### Phase A: Stale State Awareness
- [ ] P1-10: DeltaHistogram empty/stale states
- [ ] P1-11: FootprintChart stale awareness
- [ ] P1-12: ChartCanvas stale/disconnected state
- [ ] P1-19: Book health differentiation in header
- [ ] P2-12: TradeFlow stale indicator
- [ ] P2-13: SessionStats misleading empty state
- [ ] P2-21: DepthRatioSparkline no-data state

### Phase B: CSS Cleanup
- [ ] P1-13: Alert Feed duplicate CSS blocks → consolidate
- [ ] P1-14: Delta Strip duplicate CSS → consolidate
- [ ] P1-15: MarketHeader stream dot CSS
- [ ] P1-16: Overlay toggle CSS
- [ ] P2-15: Dead session-stats CSS removal
- [ ] P2-16: Second alert-feed dead CSS removal
- [ ] P2-17: Heatmap VPVR summary CSS
- [ ] P1-17: CommandPalette selectedIdx race fix
- [ ] P1-18: CommandPalette ARIA + focus trap

### Phase C: Connection State Unification
- [ ] P2-18: Consistent connection status across 3 locations
- [ ] P1-20: Data freshness timestamp in SidePanel

---

## Cycle 3 — Professional Quality (PLANNED)

### Phase A: Architecture Improvements
- [ ] P2-2: O(n) clusterCandleIdx lookup → Map index
- [ ] P2-3: Central API config module (env overrides)
- [ ] P2-7: ExecutionChart dirty flag for RAF
- [ ] P2-9: Dependency version upgrades (vite → 8.x, etc.)
- [ ] P2-4: WebSocket message field validation

### Phase B: Security Hardening
- [ ] P0-3: Vite host: true → localhost
- [ ] P0-4: esbuild vulnerability → upgrade vite
- [ ] P1-7: Prototype pollution defense
- [ ] P1-9: CSP headers
- [ ] P2-10: window.__chartApi → React context
- [ ] P2-11: Remove archive/ or .gitignore it
- [ ] P3-2/3: Debug flags gated by DEV mode
- [ ] P3-5/6: URL-encode REST parameters

### Phase C: Accessibility & Polish
- [ ] P2-19: Bottom tab ARIA semantics
- [ ] P3-9: :focus-visible styling
- [ ] P3-10: CommandPalette reopen reset
- [ ] P3-11: AssetSelector keyboard nav
- [ ] P2-22: Responsive layout breakpoints

### Phase D: Documentation
- [ ] P3-4: README.md update (remove demo mode)
- [ ] P3-7: Hidden source maps for error monitoring
- [ ] P3-8: Client-side rate limiting on REST calls
- [ ] P3-13: Remove duplicate price display
- [ ] P3-14: Alert count badge animation

---

## Acceptance Criteria

A cycle is complete when:
1. All targeted issues are fixed
2. `npx tsc --noEmit` passes clean
3. `npm run build` passes clean
4. No new regressions in existing functionality
5. Changes documented in AGENT_WORKLOG.md
6. Quality gate reassessed in QUALITY_GATE.md
