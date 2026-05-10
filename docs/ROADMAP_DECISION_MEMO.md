# Roadmap Decision Memo

**Date:** 2026-05-11
**Project:** Orderflow Cockpit
**Decision authority:** Developer (this memo is advisory)

---

## TL;DR

**Stop adding features. Start validating what exists.**

The project has genuine technical depth but zero runtime validation and zero automated tests. The next 30 days should focus on proving the existing features work, not adding new ones.

---

## Decision 1: Should we continue?

**Yes.** The order book sync engine, WebSocket lifecycle management, and dual-layer chart architecture are real engineering. This is worth finishing as a portfolio piece.

**Cost to finish:** ~20 hours of focused work over 2-3 weeks.

---

## Decision 2: What is the single most important action?

**Run a 30-minute soak test. Today.**

This costs 30 minutes of wall time and validates the most critical unverified claim: that the app doesn't fall over under real conditions.

If the soak test reveals memory leaks or WebSocket instability, that changes the roadmap entirely. If it passes, we have confidence to proceed.

---

## Decision 3: What should we build next?

**Nothing new.** Write tests for what exists.

| Priority | Action | Effort | Value |
|---|---|---|---|
| 1 | Soak test | 30 min | Validates runtime stability |
| 2 | Order book unit tests | 2 days | Prevents regressions on most complex component |
| 3 | Coordinate adapter tests | 0.5 days | Prevents overlay drift |
| 4 | Deploy to Vercel/Netlify | 0.5 days | Makes project accessible |
| 5 | Screenshots | 0.5 days | Makes portfolio visual |

**Total: ~4 days of work.**

---

## Decision 4: What should we NOT build?

| Feature | Why not |
|---|---|
| Historical recorder | No tests to catch regressions |
| Replay engine | Depends on historical recorder |
| Multi-symbol simultaneous | Too complex for portfolio value |
| Trading execution | Out of scope |
| AI/ML predictions | Out of scope |
| Mobile responsive | No evidence of need |
| Electron packaging | Massive scope increase |

---

## Decision 5: Is this a product or a portfolio piece?

**Portfolio piece.** Do not try to make it a product.

A product would require: auth, persistence, multi-user, error recovery, support, legal compliance, payment processing. That's 6+ months of work for a different project.

The portfolio value is in the engineering, not the features.

---

## Decision 6: What would change this recommendation?

If any of the following are true, the roadmap changes:

1. **Soak test fails** → Fix stability issues before anything else
2. **A specific client wants a specific feature** → Build that feature (with tests)
3. **The developer wants to pivot to a product** → Fundamentally different roadmap
4. **The order book sync has a bug** → Fix it immediately (it's the core value)

---

## Decision 7: Timeline

| Week | Focus | Deliverable |
|---|---|---|
| 1 | Soak test + unit tests + deploy | Tests passing, live demo URL |
| 2 | Error boundaries + screenshots | Portfolio-ready screenshots |
| 3 | Integration tests + polish | Credible test suite |
| 4 | Portfolio presentation | Ready for recruiters/clients |

**End state:** A portfolio-ready project with live demo, screenshots, tests, and honest documentation.

---

## Decision 8: Success criteria

The project is "done" when:

1. ✅ Build passes (verified)
2. ☐ 30-minute soak test passes
3. ☐ Unit tests exist for order book logic
4. ☐ Live demo URL is accessible
5. ☐ Screenshots are in README
6. ☐ Honest limitations are documented (already done)

**6 criteria. 4 remaining. ~20 hours of work.**

---

*This memo is intentionally brief. The full consulting report has details. This memo is for decisions.*
