# QUALITY GATE — Orderflow Cockpit

**Last Assessed:** 2026-05-27 (Cycle 1, Phase B in progress)

---

## Scoring (0-10 scale)

| Dimension | Score | Trend | Notes |
|-----------|-------|-------|-------|
| **Correctness** | 7 | ↑ | P0-1 (spread validation) and P0-2 (stale closure) fixed — book integrity guard now functional. Remaining: unvalidated WS fields (P2-4), processTrade race (P2-5 fixed) |
| **Reliability** | 6 | ↑ | P1 fixes (cache bounding, alert pruning, reconnectAttempt reset, onerror handler) reduce failure modes. Remaining: no stale/reconnect triggers on component state |
| **Security** | 4 | → | esbuild vuln (P0-4), dev server exposure (P0-3), no CSP (P1-9), prototype pollution (P1-7). Positives: no secrets, strict TS, min deps |
| **Visual Quality** | 3 | → | 40+ missing CSS classes (P0-6), duplicate conflicting CSS blocks (P1-13/14), missing keyframes (P0-5), unstyled overlays (P1-16) |
| **State Visibility** | 4 | → | 3 canvas components show stale data without warning (P1-10/11/12), no book health differentiation in main view (P1-19) |
| **Accessibility** | 2 | → | No ARIA on CommandPalette (P1-18), no ARIA on tabs (P2-19), no focus-visible (P3-9), no keyboard nav on AssetSelector (P3-11) |
| **Maintainability** | 5 | ↑ | .gitignore expanded (P2-8), dead code cleaned (P3-1), shared refs fixed (P1-1). Remaining: hardcoded URLs (P2-3), duplicate CSS (P1-13/14), dead CSS (P2-15) |
| **Performance** | 6 | ↑ | DeltaHistogram RAF optimized (P1-4). Remaining: 60fps unconditional redraw (P2-7), O(n) cluster lookup (P2-2) |

**Overall: 4.6 / 10** — Fragile but building. Critical data-integrity bugs fixed. Major CSS/UX gaps need filling before the app feels professional.

---

## Gate Criteria for Cycle Completion

### Cycle 1 Gate (target: 6.0+)
- [x] All P0 data-integrity bugs fixed
- [x] All P1 code-quality bugs fixed (6/6)
- [ ] P0-5: Missing keyframe animations added
- [ ] P0-6: All missing CSS classes added (40+)
- [ ] At least 3 P1 UX issues fixed (stale states on canvas components)
- [ ] tsc --noEmit clean
- [ ] npm run build clean

### Cycle 2 Gate (target: 7.5+)
- [ ] All P1 UX issues resolved
- [ ] All CSS duplicates consolidated
- [ ] All stale/disconnected states implemented
- [ ] Connection status unified across components
- [ ] CommandPalette ARIA compliant

### Cycle 3 Gate (target: 8.5+)
- [ ] Central API config module
- [ ] CSP headers in place
- [ ] Vite upgraded (P0-4 resolved)
- [ ] All P2 issues resolved
- [ ] README updated
- [ ] Responsive layout for common breakpoints
- [ ] All accessibility P2/P3 resolved

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| esbuild vuln exploited in dev | Low (requires malicious site visit during dev) | Medium | Restrict dev server to localhost (P0-3) |
| Stale data misleads trading decisions | High (no visual warning on disconnect) | High | Implement stale states on all visual components (P1-10/11/12) |
| Missing CSS makes panels unusable | Confirmed (5 panels unstyled) | Medium | Add all missing CSS classes (P0-6) |
| Memory leak from unbounded maps | Medium (grows over hours of use) | Low | Already fixed (P1-2, P1-3) |
| CSS cascade overrides break styling | Confirmed (duplicate blocks) | Medium | Consolidate CSS (P1-13, P1-14) |
