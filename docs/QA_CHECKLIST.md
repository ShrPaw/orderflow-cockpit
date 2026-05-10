# QA Checklist

Manual QA steps for Orderflow Cockpit.

## 1. Clean Install

```bash
git clone https://github.com/ShrPaw/orderflow-cockpit.git
cd orderflow-cockpit
npm install
```

**Expected:** No errors.

## 2. Build

```bash
npm run build
```

**Expected:** `tsc && vite build` passes with 0 TypeScript errors.

## 3. Dev Run

```bash
npm run dev
```

**Expected:** Vite prints local URL. App opens in browser.

## 4. Initial Connection

- [ ] Toolbar shows "LIVE" mode
- [ ] Symbol shows "BTC / USDT"
- [ ] Connection dots turn green (ticker, trades, depth)
- [ ] Console shows `[Binance trade] Connected: BTCUSDT`
- [ ] Console shows `[LocalBook] Diff stream connected: BTCUSDT`
- [ ] Console shows `[MiniTicker] Connected: BTCUSDT`
- [ ] No repeated connect/disconnect spam

## 5. Five-Minute Stability Test

Leave the app running for 5 minutes.

- [ ] No reconnect spam in console
- [ ] Chart continues updating
- [ ] Trades continue flowing in Time & Sales
- [ ] No blank screen
- [ ] No error messages in console
- [ ] Browser memory usage stays reasonable (< 500MB)

## 6. Symbol Switch Test

- [ ] Click symbol selector → Asset Selector opens
- [ ] Select ETHUSDT
- [ ] Old BTC candles clear
- [ ] New ETH candles appear
- [ ] ETH trades flow in Time & Sales
- [ ] Heatmap updates to ETH levels
- [ ] No duplicate sockets in console
- [ ] Switch back to BTCUSDT — same clean behavior

## 7. Zoom/Pan Test

- [ ] Scroll wheel zooms in — candles become wider
- [ ] Zoom to minimum (3 visible candles) — individual candles clearly readable
- [ ] Drag left — chart pans to older candles
- [ ] Drag right — chart returns toward live edge
- [ ] Price-axis drag — vertical scaling
- [ ] Time-axis drag — horizontal scaling
- [ ] No NaN/Infinity on price axis labels
- [ ] No candles disappearing during zoom

## 8. GO LIVE Test

- [ ] Pan away from live edge — GO LIVE pill appears (top-right, amber)
- [ ] Cursor changes to pointer when hovering GO LIVE
- [ ] Click GO LIVE — chart returns to live edge, LIVE pill appears
- [ ] Press Home key — same behavior
- [ ] Double-click chart — returns to live edge

## 9. Bubble Tooltip Test

- [ ] Wait for a large trade bubble to appear
- [ ] Hover near the bubble — tooltip appears
- [ ] Tooltip shows: side (BUY/SELL), state, notional, volume, price, age
- [ ] Tooltip is color-coded (green=buy, red=sell)
- [ ] Moving mouse away hides tooltip

## 10. Heatmap Stale Test

- [ ] Heatmap shows liquidity bands with quantity labels
- [ ] Spread line visible between bid/ask groups
- [ ] If order book goes stale — heatmap dims, shows "overlays paused"
- [ ] Stale book is NOT presented as live

## 11. Refresh Test

- [ ] Browser refresh (F5) starts clean
- [ ] No stale persisted state
- [ ] Streams reconnect automatically
- [ ] Chart starts with fresh candles

## 12. Console Error Check

Open DevTools → Console. Filter by "Error" level.

- [ ] No uncaught exceptions
- [ ] No "WebSocket connection failed" repeated
- [ ] No React errors
- [ ] console.error only appears for genuine stream errors (not spam)
