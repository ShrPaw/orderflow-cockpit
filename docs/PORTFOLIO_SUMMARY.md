# Portfolio Summary

## Problem Solved

Building a real-time market microstructure visualization tool that processes high-frequency streaming data from cryptocurrency exchanges and renders it as an interactive orderflow cockpit — without requiring API keys, backend servers, or exchange accounts.

## Technical Challenge

The core challenge is managing WebSocket connections to multiple concurrent data streams while maintaining:
- Connection stability (reconnect with backoff, stale socket protection, generation tokens)
- Data integrity (order book sequence validation, local resync engine)
- Rendering performance (Canvas2D at 60fps under 100ms update rates)
- React lifecycle correctness (no render loops, no effect thrashing, no memory leaks)

## Architecture

Single-page React + TypeScript app with:
- **Zustand** for state management optimized for streaming data
- **Unified Canvas2D execution chart** — one chart surface fusing candles, footprint, bubbles, heatmap, liquidity, and order book state
- **Layered rendering model** — 16 clear layers from background to state overlay
- **Ref subscription pattern** to decouple render loops from React re-render cycles
- **Generation tokens** on every WebSocket to prevent stale socket events
- **Per-stream lifecycle management** with idempotent start/stop
- **Strict diff-depth sync** with DEGRADED depth20 fallback for order book reliability

## Stability Work

- Fixed WebSocket reconnect loop caused by timer accumulation in order book resync
- Added generation tokens to all connectors (stale socket protection)
- `closeSocket()` detaches handlers before closing to prevent ghost `onclose` events
- Rate-limited order book resync (max once per 5s)
- Exponential backoff with jitter (1s → 30s, ±25%)
- Enhanced stale checker with grace period and `readyState` verification
- Connection registry for dev-mode duplicate detection
- Per-stream error tracking (trade, depth, ticker independently)
- Chart render loop reads from refs (no teardown/recreate on every tick)
- Strict diff-depth sync: stream-first buffering, snapshot overlap validation, pu continuity
- DEGRADED fallback: automatic switch to depth20 partial stream after repeated sync failures
- Order book preserves last known good data during RESYNCING (no data wipe)

## UX Work

- Deep chart zoom (3 visible candles minimum) for individual candle inspection
- Smooth pan/zoom with focal-point preservation
- LIVE/GO LIVE pill indicator with click-to-return functionality
- Bubble hover tooltip (side, state, notional, volume, price, age)
- Improved heatmap with quantity labels, spread indicator, stale indication
- Footprint cells visible at lower zoom levels
- Candle timestamps on time axis
- Wider price scale for better label readability

## What This Demonstrates

1. **WebSocket lifecycle management** — generation tokens, handler detachment, backoff, stale protection
2. **Canvas rendering under streaming data** — RAF loop decoupled from React state
3. **React performance optimization** — refs + subscriptions for high-frequency data
4. **Market microstructure visualization** — footprint, bubbles, order book, heatmap
5. **Professional engineering discipline** — connection registry, per-stream errors, build validation

## Limitations

- Depends on Binance public WebSocket availability
- Not a trading bot — no order execution
- Not financial advice — visualization only
- No historical database — live data only
- aggTrade is aggregated, not full tick data
- Depth is top-20 levels at 100ms, not full order book

## Suggested Screenshots

1. **Full dashboard** — BTCUSDT live with chart, heatmap, side panel, Time & Sales
2. **Zoomed-in candles** — 5-10 visible candles showing footprint cells and wick detail
3. **Bubble tooltip** — Hover over a large trade bubble showing classification info
4. **Heatmap with liquidity** — Liquidity bands with quantity labels visible
5. **GO LIVE detached state** — Chart panned away with amber GO LIVE pill visible
6. **Connection health** — All green dots in toolbar, LIVE pill on chart
7. **Symbol selector** — Asset selector modal open with instrument list
