# Architecture

## Overview

Orderflow Cockpit is a single-page React application that connects to Binance Futures public WebSocket streams and renders real-time market microstructure data on a unified execution chart built on TradingView Lightweight Charts with custom Canvas2D orderflow overlays.

## Data Flow

```
Binance Futures WebSocket (public)
    ↓
Connectors (binanceAggTrade, localOrderBook, binanceTicker)
    ↓
Zustand Store (marketStore)
    ↓
ExecutionChart component
    ├── Lightweight Charts (candlesticks, time/price scale, zoom/pan, crosshair)
    └── Overlay Canvas2D (heatmap, bubbles, footprint, state badges, GO LIVE)
```

## Binance Streams Used

| Stream | URL | Purpose |
|---|---|---|
| Trade | `wss://fstream.binance.com/ws/{symbol}@trade` | Individual trade events |
| Diff Depth | `wss://fstream.binance.com/ws/{symbol}@depth@100ms` | Order book diff events (strict sync) |
| Depth20 Fallback | `wss://fstream.binance.com/ws/{symbol}@depth20@100ms` | Partial depth (DEGRADED mode) |
| Mini Ticker | `wss://fstream.binance.com/ws/{symbol}@miniTicker` | Live price updates |
| REST Ticker | `https://fapi.binance.com/fapi/v1/ticker/24hr` | 24h stats (polled every 10s) |
| REST Depth | `https://fapi.binance.com/fapi/v1/depth` | Order book snapshot |
| REST Klines | `https://fapi.binance.com/fapi/v1/klines` | Historical candles |

No API keys required — all endpoints are public.

## Connector Lifecycle

Each connector follows the same pattern:

```
connect(symbol)
  → cancelReconnectTimer()
  → closeSocket()          // detach handlers, close socket
  → generation++           // invalidate stale events
  → registryAdd()          // track in dev mode
  → new WebSocket(url)

onopen:
  → check disposed && generation
  → reconnectAttempt = 0
  → onStatus(true)

onmessage:
  → check disposed && generation
  → process data

onclose:
  → check disposed && generation → bail if stale
  → onStatus(false)
  → scheduleReconnect(backoff)

onerror:
  → check disposed && generation
  → socket.close()         // onclose handles reconnect

cleanup:
  → disposed = true
  → generation++
  → cancelReconnectTimer()
  → closeSocket()
  → registryRemove()
```

### Generation Tokens

Every socket instance gets a monotonically increasing `generation` ID. All event handlers check `generation !== myGen` and bail if stale. This prevents:
- Old sockets updating state after symbol switch
- Duplicate sockets from reconnect races
- Stale socket events from affecting new connections

### Intentional Close Protection

When cleanup runs (symbol change, unmount, mode switch):
1. `disposed = true` — all future handlers bail
2. `generation++` — all existing handlers with old generation bail
3. `cancelReconnectTimer()` — kills pending reconnect
4. `closeSocket()` — detaches handlers, then closes (no `onclose` fires)

### Reconnect Backoff

| Connector | Initial | Factor | Max | Jitter |
|---|---|---|---|---|
| binanceAggTrade | 1000ms | 1.5x | 30s | ±25% |
| binanceTicker | 1000ms | 1.5x | 30s | ±25% |
| localOrderBook | 1000ms | 1.5x | 15s | ±25% |

Backoff resets to initial on successful connection.

## Order Book — Strict Diff-Depth Sync + DEGRADED Fallback

The local order book engine (`localOrderBook.ts`) implements strict Binance diff-depth synchronization:

### Strict Sync Methodology
1. Open diff-depth stream (`@depth@100ms`) → start buffering events
2. Fetch REST depth snapshot (with AbortController)
3. Let L = snapshot.lastUpdateId
4. Drop buffered events where `event.u < L`
5. Find first event satisfying `event.U <= L+1 && event.u >= L+1`
6. Apply that event → book is HEALTHY
7. For every following event: `event.pu` must equal previous `event.u`
8. If pu mismatch → reject event, preserve good book, controlled resync

### DEGRADED Fallback
If strict sync fails 3 times within 60 seconds, the engine switches to DEGRADED mode:
- Connects `@depth20@100ms` partial depth stream
- Each update is an authoritative top-20 snapshot
- Book is labeled "DEGRADED TOP-20 BOOK" in UI
- Periodic recovery attempts every 30s

### Order Book Health States

| State | Meaning | Overlays |
|---|---|---|
| HEALTHY | Strict diff-depth sync verified | Full brightness |
| RESYNCING | Sequence gap detected, resyncing | Last known book, dimmed |
| DEGRADED | Strict sync failed, depth20 fallback | Top-20 book, labeled |
| STALE | No updates for 20s+ | Strongly dimmed |
| ERROR | Unrecoverable error | Paused |
| DISCONNECTED | Intentionally closed | Hidden |
| CONNECTING | Opening socket | Hidden |
| BUFFERING | Stream open, waiting for snapshot | Hidden |
| SNAPSHOT_LOADING | Fetching REST snapshot | Hidden |
| SYNCING | Waiting for valid overlapping event | Hidden |

### Stale Detection
- 20s threshold with 30s initial grace period
- Only fires from HEALTHY or DEGRADED states
- Verifies socket `readyState === OPEN` before marking stale

## Zustand Store

Single global store (`marketStore.ts`) with:

- **Primitive selectors** for React components (symbol, mode, interval)
- **Action functions** accessed via `useMarketStore.getState()` in callbacks
- **Per-stream errors** (tradeError, depthError, tickerError)
- **Array/data fields** (candles, bids, asks, trades, bubbles)
- **Derived state** computed in 2s interval (volume profile, heatmap, bubbles)

### Performance Pattern

High-frequency data (trades, depth) updates the store on every message. The chart component uses:
- **Ref subscription pattern** — Zustand subscription updates refs synchronously
- **Single RAF loop** — reads from refs, never restarts on market ticks
- **No React re-renders** for chart data — only for toolbar/panel selectors

## Unified Execution Chart

**One chart surface** — `ExecutionChart.tsx` with Lightweight Charts base + Canvas2D overlay.

### Architecture

```
┌─────────────────────────────────────────────┐
│  TradingView Lightweight Charts             │
│  (candlesticks, volume histogram,           │
│   time scale, price scale, native zoom/pan, │
│   crosshair, scroll-to-real-time)           │
├─────────────────────────────────────────────┤
│  Overlay Canvas2D (pointer-events: none)    │
│  (liquidity, footprint, bubbles, clusters,  │
│   tooltip, state badges, GO LIVE)           │
└─────────────────────────────────────────────┘
```

### What Lightweight Charts Owns

- Candlestick rendering (open/high/low/close)
- Volume histogram
- Time scale with zoom/pan
- Price scale with auto-scaling
- Native crosshair with labels
- Visible range management
- Scroll-to-real-time
- Resize handling

### What the Custom Overlay Owns

- Liquidity levels (orderbook bid/ask bands)
- Level memory (horizontal dashed lines at meaningful prices)
- Footprint cells (per-candle volume-at-price)
- Bubbles (aggressive flow events with state/age encoding)
- Auction clusters (clustered bubble rendering)
- Bubble tooltip (hover info)
- Order book state badges (DEGRADED, RESYNCING, STALE, ERROR, etc.)
- GO LIVE / LIVE indicator

### Coordinate Mapping

The overlay uses Lightweight Charts APIs for coordinate mapping:
- `chart.timeScale().timeToCoordinate(timeSec)` → x pixel
- `candleSeries.priceToCoordinate(price)` → y pixel
- Returns null for off-screen elements (caller skips)

### Data Flow

- `ExecutionChart` subscribes to store via `useMarketStore.subscribe()`
- Subscription updates refs (candles, bids, asks, bubbles, health, etc.)
- RAF loop reads refs every frame — no React re-render
- RAF loop updates Lightweight Charts series + redraws overlay canvas
- Symbol switch reloads all data into chart series

### Layer Order (bottom → top)

1. **Liquidity levels** — orderbook bid/ask bands
2. **Level memory** — horizontal dashed lines at meaningful prices
3. **Footprint cells** — per-candle volume-at-price bars
4. **Bubbles** — aggressive flow events with state encoding
5. **Auction clusters** — clustered bubble rendering
6. **Tooltip** — bubble hover info
7. **Order book state badge** — honest status for non-HEALTHY states
8. **GO LIVE / LIVE** — live edge indicator

### Interaction

- **Zoom/Pan** — native Lightweight Charts handling (wheel, drag)
- **Crosshair** — native Lightweight Charts crosshair
- **GO LIVE** — click pill to return to live edge
- **Double-click** — scroll to real-time
- **Mouse hover** — bubble tooltip on overlay canvas

## Performance Safeguards

- **Single chart instance** — created once on mount, cleaned up on unmount
- **Single series** — one candlestick + one volume histogram, created once
- **Single RAF loop** — starts once per mount, reads refs, cleaned up on unmount
- **No RAF restart on ticks** — loop runs continuously, reads latest refs
- **Ref-based data flow** — store subscription → refs → RAF reads refs
- **Overlay redraw scheduled** — integrated into existing RAF loop, no separate timer
- **Array size caps** — 1500 candles, 200 trades, 100 large trades, 3000 heatmap, 500 bubbles
- **No unbounded timers** — all intervals cleaned up
- **No duplicate render loops** — one chart, one RAF, one overlay canvas
- **No React render storm** — chart data flows through refs, not React state
