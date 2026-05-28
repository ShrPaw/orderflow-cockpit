# AGENT WORKLOG — Orderflow Cockpit Professionalization

---

## 2026-05-27 — Cycle 1 Start

### Prior Session (before context compaction)
- Merged 24 remote commits (+10,822 lines) with local work (+1,101 lines) despite 42 merge conflicts
- Resolved all TypeScript errors after merge (17 errors: mode/setMode/AppMode, ChartEngine, etc.)
- Build passes: 457KB JS + 27KB CSS
- Pushed commit 9d260e7 to origin/main
- Deployed 4 audit subagents (Architecture, Security, Frontend UX, Code Quality)

### Current Session

#### P0 Fixes
- **P0-1 FIXED**: `localOrderBook.ts:392-394` — Changed `parsedBids[0][1]` (qty) to `parseFloat(parsedBids[0][0])` (price) in spread sanity check. This was a critical data integrity bug: the book corruption guard was comparing quantities instead of prices, making it non-functional.
- **P0-2 FIXED**: `App.tsx:143-148` — Replaced stale closure pattern (`origResync` captured once) with inline resync logic that reads store state fresh on each call. This eliminates the risk of the resyncOrderBook override calling an outdated version of the store method.

#### P1 Fixes
- **P1-1 FIXED**: `levelMemory.ts:108-125` — `copyLevel()` now creates new Sets instead of sharing references. Prevents external consumers from mutating internal dedup trackers.
- **P1-2 FIXED**: `binanceTicker.ts:4` — Added cache pruning: entries older than 5 min are evicted on each `fetchTicker24h` call. Also caps CACHE at 50 entries.
- **P1-3 FIXED**: `marketStore.ts` — Added pruning to `lastAlertByKey`: entries older than max cooldown (300s) are evicted on each `shouldFireAlert` call.
- **P1-4 FIXED**: `DeltaHistogram.tsx` — Changed to ref-based subscription pattern. RAF loop now reads from refs, not React state, preventing re-trigger on every trade.
- **P1-5 FIXED**: `binanceAggTrade.ts:21` — Changed `tradeDiag` from module-level singleton to per-connection instance via WeakMap keyed by generation. Each connection now has independent diagnostics.
- **P1-6 FIXED**: `binanceTicker.ts:94-95` — Replaced `tickSize!`/`stepSize!` with `tickSize ?? 0.01`/`stepSize ?? 0.001` safe defaults. Added `isFinite()` validation before using parsed values.

#### P2 Fixes
- **P2-1 FIXED**: `localOrderBook.ts` — Added `reconnectAttempt = 0` reset in depth20 `onopen` handler.
- **P2-5 FIXED**: `marketStore.ts` — Merged two `set()` calls in `processTrade` into single atomic `set()`.
- **P2-6 FIXED**: `binanceAggTrade.ts:146-151` — Added `ws = null` and `onStatus(false)` to `onerror` handler.
- **P2-8 FIXED**: `.gitignore` — Expanded with .env variants, certs, archive/, IDE dirs, coverage/, OS files.
- **P3-1 FIXED**: `aggregation.ts` — Added `resetBubbleCounter()` export, called from store's symbol reset.

#### Working Documents Created
- `AUDIT_REPORT.md` — Comprehensive multi-angle audit (Architecture, Security, UX, Code Quality) — 66 issues classified P0-P3
- `PROFESSIONALIZATION_PLAN.md` — 3-cycle improvement plan with phases and acceptance criteria
- `AGENT_WORKLOG.md` — This file — tracks all changes and decisions
- `QUALITY_GATE.md` — Quality gate scoring and criteria

#### Verification
- `npx tsc --noEmit` — PASS (clean, no errors)
- `npm run build` — PASS (458KB JS + 27KB CSS, 1.94s build)

---

## Audit Results Summary

### Architecture & Reliability (completed)
- 2 P0 critical bugs found and fixed (spread validation, stale closure)
- 6 P1 high-severity bugs found (5 fixed, 1 open: prototype pollution)
- 7 P2 medium-severity issues found (4 fixed, 3 open)

### Security (completed)
- 2 P0: esbuild vuln + dev server 0.0.0.0
- 4 P1: prototype pollution, XSS in archive, no CSP, wildcard CORS
- 6 P2: hardcoded URLs, unvalidated WS fields, incomplete .gitignore, outdated deps, global exposure, archive code
- 6 P3: various defense-in-depth issues

### Frontend UX & Visual (completed)
- 2 P0: missing keyframe animations, 40+ missing CSS classes
- 11 P1: missing stale states on 3 canvas components, CSS duplication conflicts, missing stream-dot/overlay CSS, CommandPalette race/accessibility
- 11 P2: stale indicators, dead CSS, unstyled sections, inconsistent connection display
- 5 P3: focus styling, keyboard nav, animation, redundancy

### Code Quality (pending — agent failed, needs re-run)
- Will deploy in next cycle
