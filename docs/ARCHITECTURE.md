# Architecture

## Overview

Orderflow Cockpit is a single-page React application that connects to Binance Futures public WebSocket streams and renders real-time market microstructure data on Canvas2D.

## Data Flow

```
Binance Futures WebSocket (public)
    ↓
Connectors (binanceAggTrade, localOrderBook, binanceTicker)
    ↓
Zustand Store (marketStore)
    ↓
React Components (ChartCanvas, SidePanel, DOMLite, Heatmap, TradeFlow)
    ↓
Canvas2D Rendering (chartRenderer.ts)
```

## Binance Streams Used

| Stream | URL | Purpose |
|---|---|---|
| Trade | `wss://fstream.binance.com/ws/{symbol}@trade` | Individual trade events |
| Diff Depth | `wss://fstream.binance.com/ws/{symbol}@depth@100ms` | Order book diff events |
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

## Order Book Resync

The local order book engine (`localOrderBook.ts`) implements the official Binance methodology:

1. Open diff depth stream → buffer events
2. Fetch REST depth snapshot
3. Discard stale events (u < lastUpdateId)
4. Validate first event: U <= lastUpdateId && u >= lastUpdateId
5. Apply updates in sequence
6. Validate continuity via pu (previous final update ID)
7. If sequence breaks → resync (rate-limited to once per 5s)

### Stale Detection

- 15s threshold with 20s initial grace period
- Verifies socket `readyState === OPEN` before marking stale
- Does not mark stale during initial connection/sync

## Zustand Store

Single global store (`marketStore.ts`) with:

- **Primitive selectors** for React components (symbol, mode, interval)
- **Action functions** accessed via `useMarketStore.getState()` in callbacks
- **Per-stream errors** (tradeError, depthError, tickerError)
- **Array/data fields** (candles, bids, asks, trades, bubbles)
- **Derived state** computed in 2s interval (volume profile, heatmap, bubbles)

### Performance Pattern

High-frequency data (trades, depth) updates the store on every message. Components that need this data use:
- **Ref subscription pattern** for Canvas render loops (ChartCanvas, LightweightChartCanvas)
- **Direct selectors** for DOM components (TradeFlow, DOMLite, SidePanel)

This prevents the render loop from being torn down on every market tick.

## Chart Rendering

### Legacy Canvas (default)

`chartRenderer.ts` renders everything on a single Canvas2D:
- Candles with wick/body scaling
- Footprint cells (per-candle price-level volume)
- Bubbles (aggressive flow events)
- Liquidity levels (orderbook bid/ask bands)
- Volume profile overlay
- Level memory overlay
- Crosshair with price/time labels
- Price scale and time axis
- LIVE/GO LIVE pill indicator

The render loop runs via `requestAnimationFrame` at display refresh rate. Data is read from refs (not React state) to avoid tearing down the loop on every tick.

### Lightweight Charts (experimental)

`LightweightChartCanvas.tsx` uses TradingView Lightweight Charts v5 as the base engine with a Canvas2D overlay for bubbles and liquidity. This is experimental and not the default.

## Performance Safeguards

- Chart RAF loop depends only on `[size]` — reads data from refs
- Overlay redraw reads from `overlayDataRef` — depends only on `[symbol]`
- Zustand subscription keeps refs current without causing re-renders
- Array sizes capped: 1500 candles, 200 trades, 100 large trades, 3000 heatmap levels, 500 bubbles
- No unbounded timers or intervals
- All intervals and event listeners cleaned up on unmount
