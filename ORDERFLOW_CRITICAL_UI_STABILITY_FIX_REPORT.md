# Orderflow Cockpit — Critical UI Stability Fix Report

## Summary

All 7 phases of critical runtime + chart usability fixes have been executed and committed to the `main` branch. The cockpit is now significantly more stable, usable, and debuggable.

---

## Phase 1 — Runtime Stability / Error Boundary
**Commit:** `fix: harden cockpit runtime errors and recover chart state`

### Changes:
- **Global error boundary**: `window.onerror` and `unhandledrejection` handlers show non-fatal toast notifications instead of crashing the app
- **Try/catch wrappers**: All event handlers (mousemove, mousedown, mouseup, wheel, keydown, tool click) are wrapped in try/catch blocks
- **Toast notification system**: Non-blocking error/warn/info toasts that auto-dismiss after 5s
- **Reset UI State button** (`⟲ Reset UI`): Clears active tool, hover state, resets chart transform to defaults, does NOT restart server
- **Reconnect button** (`↻ Reconnect`): Clears stale frontend buffers and re-selects current symbol
- **WS error handling**: WebSocket message errors now show toasts instead of silently dying

### Files: `public/js/app.js`, `public/index.html`

---

## Phase 2 — Professional Chart Zoom/Pan
**Commit:** `fix: implement professional chart zoom pan and viewport controls`

### Changes:
- **Cursor-centered zoom**: Default wheel now zooms the time axis around the mouse cursor position. The candle under the cursor stays stationary during zoom
- **Cursor-centered price zoom**: Ctrl+wheel zooms the price scale while keeping the price under the cursor stable
- **Shift+wheel**: Horizontal pan (unchanged, already correct)
- **Dirty flag**: `_priceScaleDirty` flag prevents the render function from recalculating price scale every frame — only when new data arrives
- **Auto Scale mode** (`⚖ Auto`): Smoothly adjusts price scale to fit visible candles, toggleable
- **Zoom buttons**: `+` and `−` buttons for zoom in/out
- **No auto-reset**: Chart no longer auto-resets zoom on every data update

### Files: `public/js/app.js`, `public/index.html`

---

## Phase 3 — Historical Candle Loading
**Commit:** `feat: add historical candle context and live-history fallback`

### Changes:
- **Server endpoint**: `GET /api/history?symbol=BTC&interval=1m&count=300` fetches 1-minute historical candles from Hyperliquid REST API (`POST https://api.hyperliquid.xyz/info` with `candleSnapshot` type)
- **Frontend fetch**: On symbol selection, automatically fetches 300 historical 1m candles and prepends them to `state.candles`
- **Format conversion**: Converts Hyperliquid candle format (`t,o,h,l,c,v`) to internal format
- **UI feedback**: Right panel shows "Loaded: N candles (1m historical context)" in green
- **Fallback**: If historical data unavailable, shows "Live-only history building" message
- **Note**: 40s candles are not available on Hyperliquid, so 1m candles serve as historical context; live 40s candles build up over time

### Files: `server/index.js`, `public/js/app.js`

---

## Phase 4 — Bubble Cluster Labels & Tooltip
**Commit:** `fix: clarify bubble cluster labels and add cluster tooltip legend`

### Changes:
- **Cluster label format**: Changed from `+3` to `B×3` for clarity
- **Detailed cluster tooltip**: Hovering a cluster now shows:
  - "Bubble Cluster — N bubbles" title
  - Price range of cluster
  - Side breakdown (N buy / N sell)
  - State breakdown (N absorbed / N exhausted / etc.)
  - Total notional value
  - Interpretation text (e.g., "Buy aggression accepted — upward pressure")
- **Bubble Legend panel**: Collapsible section in right panel explaining each bubble type:
  - Filled green = accepted buy aggression
  - Filled red = accepted sell aggression
  - Hollow green with ring = rejected buy
  - Hollow red with ring = rejected sell
  - Green with halo = absorbed (reversal zone)
  - Gray dashed = exhausted (momentum fading)
  - "B×N" = N bubbles clustered at same price

### Files: `public/js/app.js`, `public/index.html`, `public/css/style.css`

---

## Phase 5 — Label/Text Overlap Cleanup
**Commit:** `fix: reduce chart text clutter with label density controls`

### Changes:
- **Label density state**: `labelDensity` variable with values `'minimal' | 'compact' | 'detailed'`
- **Toggle button** (`◉ Labels`): Cycles through compact → detailed → minimal
- **Minimal mode**: Hides all text labels except price scale and crosshair (no bubble labels, no zone labels)
- **Compact mode** (default): Shows cluster badges (`B×N`) and zone labels, hides individual bubble size labels
- **Detailed mode**: Shows everything including individual bubble notional values
- **Zone labels**: Hidden in minimal mode, shown in compact/detailed

### Files: `public/js/app.js`, `public/index.html`

---

## Phase 6 — Tool Mode Clarity
**Commit:** `fix: make drawing tool states explicit and recoverable`

### Changes:
- **Status bar**: Bottom-left of chart shows "Active Tool: Cursor" or "Active Tool: Range Profile — drag to select"
- **Tool-specific cursors**:
  - cursor: `grab`
  - hline/trendline/rect/range: `crosshair`
  - text: `text`
  - delete: `not-allowed`
- **Improved Escape behavior**:
  - First Escape: cancels active drawing state
  - Second Escape: returns to cursor mode
  - Third Escape: clears selected range
- **Active tool button glow**: Active tool button now has a blue glow effect (`box-shadow`)
- **Tool name tooltips**: Each toolbar button has a descriptive title attribute

### Files: `public/js/app.js`, `public/index.html`, `public/css/style.css`

---

## Phase 7 — Diagnostics Panel
**Commit:** `feat: add cockpit diagnostics panel`

### Changes:
- **Toggle button** (`⚙ Diag`): Opens/closes a floating diagnostics panel centered on screen
- **Connection section**: Selected source, symbol, interval, HL WS status, client WS state, trades/book subscribed status
- **Data section**: Last trade timestamp, last book timestamp, HL trade count, candle count, bubble count, visible candle count, viewport time range, history loaded status
- **View state section**: Active tool, follow live, auto scale, label density, scaleX, pricePerPixel, userModified flag
- **Errors section**: Last frontend error, last backend error, Binance futures WS status
- **Auto-refresh**: Updates every 5 seconds when panel is visible (piggybacks on status polling)

### Files: `public/js/app.js`, `public/index.html`, `public/css/style.css`

---

## Git Log

```
a4f6325 feat: add cockpit diagnostics panel
30ba5b9 fix: make drawing tool states explicit and recoverable
1d5df7a fix: reduce chart text clutter with label density controls
a4d1475 fix: clarify bubble cluster labels and add cluster tooltip legend
5431e11 feat: add historical candle context and live-history fallback
7d15f83 fix: implement professional chart zoom pan and viewport controls
ef2485e fix: harden cockpit runtime errors and recover chart state
```

---

## Remaining Limitations

1. **40s candles not available on Hyperliquid**: Historical data comes as 1m candles. Live 40s candles only build from real-time trades. The historical context is approximate.
2. **No candle time aggregation**: 1m historical candles are shown as-is, not downsampled to 40s. This means the chart has mixed timeframes until enough 40s candles accumulate.
3. **No persistent WebSocket reconnection logic with backoff**: The WS reconnect uses a fixed 2-second delay. Could be improved with exponential backoff.
4. **Label deconfliction in 'detailed' mode**: With many bubbles and zones at similar prices, text can still overlap. The deconfliction algorithm tries to shift labels vertically but has a max attempts limit.
5. **No keyboard shortcuts for zoom/pan**: Only mouse wheel and buttons. Arrow keys for pan could be added.
6. **Diagnostics panel is a floating overlay**: Doesn't dock to a side panel. Could be integrated into the right panel.
7. **No unit tests**: All changes are manual/visual. Automated tests would improve confidence.
8. **Canvas DPI handling**: Works but could be more robust on high-DPI displays with dynamic scaling.
