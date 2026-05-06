# ORDERFLOW COCKPIT — DEEPCHART VIEWPORT & BUBBLE FIX REPORT
## Full Surgical Scalper Rebuild — Parts 1–13

---

## WHAT WAS WRONG

### Zoom/Pan
- The old viewport used a fragile `scrollX` offset system (candle-units from right edge)
- Horizontal zoom was limited to ~10–200 candles; could not zoom to 3–10 candles
- Pan right would make all candles disappear — no boundary clamping
- `RIGHT_PADDING_CANDLES = 6` was not enforced; latest candle could glue to edge
- Cursor-centered zoom was broken — zoom happened at viewport center, not mouse position
- Price axis did not auto-scale to include bubble extremes or zone bands

### Bubbles
- Bubbles rendered as text-heavy badges with permanent labels ("+3", "▲2")
- Cluster count was unexplained — user could not tell what "3" meant
- Semantic mixing: buy and sell bubbles clustered together without distinction
- Rejected and absorbed bubbles looked too similar
- No hover-for-details — text was always visible, cluttering the chart
- Multiple bubbles per candle collapsed into one blob instead of spreading across candle width

### Controls
- No label density toggle — always showing text
- No Fit Recent vs Fit All distinction
- No debug panel to verify viewport state
- Hint bar missing — user did not know keyboard shortcuts

---

## HOW VIEWPORT WAS REBUILD

### World Coordinate Camera (Part 1)
The chart now uses explicit world coordinates:

```
World X = candle index (0 = first candle, N-1 = latest)
World Y = price
Screen X = pixel column on canvas
Screen Y = pixel row on canvas
```

The camera state:
```js
view = {
  centerIndex,        // candle index at screen center
  candlesVisible,     // how many candles fit on screen (zoom level)
  priceCenter,        // price at vertical center
  pricePerPixel,      // price units per pixel
  autoScalePrice,     // auto-scale to visible data
  manualPrice,        // user manually adjusted price
  followLive,         // track latest candle
  userModified,       // user has interacted
}
```

Conversion functions:
- `worldToScreenX(idx)` → pixel X
- `screenToWorldX(px)` → candle index
- `priceToScreenY(price)` → pixel Y
- `screenToPriceY(px)` → price

### Clamping (Part 4)
`clampViewport()` runs every frame before rendering:
- Ensures at least some real candles remain visible
- Allows future padding up to `RIGHT_PADDING_CANDLES` only
- Never allows viewport to move so far right/left that all candles leave screen
- `lastValidViewport` stores the last known-good state for auto-recovery

---

## HOW RIGHT PADDING WORKS

- `RIGHT_PADDING_CANDLES = 12` (configurable, 8–15 range)
- `LIVE_CANDLE_POSITION = 0.80` — latest candle at 80% of chart width
- `snapToLive()` positions the latest candle index so `worldToScreenX(latestIndex)` maps to 80% of chart width
- When `followLive` is ON and new candles arrive, `snapToLive()` is called automatically
- The breathing room is always visible — the latest candle never touches the right edge

---

## HOW DEEP ZOOM WORKS

- `MIN_CANDLES_VISIBLE = 3` — can zoom in to see just 3 candles
- `MAX_CANDLES_VISIBLE = 600` — can zoom out to see 600 candles
- `DEFAULT_CANDLES_VISIBLE = 100` — default on startup/reset
- `zoomAtScreenX(screenX, factor)` — cursor-centered zoom:
  1. Converts screen X to world index
  2. Changes `candlesVisible` by factor
  3. Adjusts `centerIndex` so the world point under cursor stays at same screen position

Controls:
- `Ctrl+wheel` = cursor-centered time zoom
- `+`/`-` keys = zoom at viewport center
- `0` = reset to default view
- Zoom +/- buttons in top bar

---

## HOW CANDLE WIDTH/SPACING WORKS

- Candle pixel width = `chartWidth / candlesVisible`
- Body width = `candlePixelWidth * 0.9` (10% gap)
- Wick width: 1px normally, 2px when `cpw > 20`
- At deep zoom (`cpw > 30`): subtle body borders for readability
- At far zoom (`cpw < 3`): compact rendering, 100-candle grid steps

---

## HOW BUBBLE RENDERING WAS CHANGED

### Clean Circles (Part 5)
- **NO text inside bubbles by default** — circles, rings, halos only
- Text only appears at deep zoom (`cpw > 40`) with large clusters (`count > 2`)
- Each state has a distinct visual treatment:

| State | Visual |
|-------|--------|
| ACCEPTED | Filled circle + glow halo + bright core + border |
| REJECTED | Hollow ring + outer warning ring + faint fill |
| ABSORBED | Translucent fill + dashed secondary ring + soft halo |
| EXHAUSTED | Small faded fill + dashed ring |
| PENDING | Pulsing thin outline |

### Rejected vs Absorbed (visually distinct)
- **REJECTED**: Thick solid ring (2.5px), outer warning ring, no fill → "aggression failed"
- **ABSORBED**: Translucent fill, dashed ring, soft halo → "aggression hit but did not travel"

### Multiple Bubbles Per Candle (Part 5)
- Bubbles spread across candle width with deterministic jitter
- `spread = cpw * 0.7`, distributed evenly across candle body
- At deep zoom, individual bubbles are clearly separated

---

## HOW CLUSTER LABELS WERE CLARIFIED (Part 6)

### Before
- Labels like "+3", "▲2" — unexplained
- Mixed side/state clusters without distinction

### After
- Labels use "3x" format — clear count
- **Only same side + same state clusters** — no semantic mixing
- Clustering is zoom-dependent: at deep zoom, clusters expand into individual circles
- Cluster band = `max(8, cpw * 0.4)` pixels — adapts to zoom level

### Hover Tooltip (detailed breakdown)
```
3 bubbles in cluster
Breakdown: 2 buy absorbed, 1 buy rejected
Total: $1.2M | Price band: 104,200 — 104,250
Price: 104,230 | Size: 500K | $500K
3s: +0.5 | 10s: -1.2 | 40s: +2.1
Volume absorbed — passive defense, aggression did not travel
```

---

## MINIMAL TEXT / LABEL DENSITY (Part 7)

Three modes:
- **Compact** (default): cluster count "3x" when zoomed in, zone labels, time labels
- **Full**: all labels visible always
- **Off**: no text, pure visual — circles, zones, candles only

Toggle via `Ⓐ Labels` button in top bar, cycles: Compact → Full → Off

---

## 40s / 3m / 5m TIMEFRAMES (Part 8)

Only three timeframes in selector:
- 40s (default)
- 3m
- 5m

On timeframe change:
1. Candles, bubbles, zones cleared
2. Viewport reset to defaults
3. Historical candles fetched for new interval
4. Live updates continue on new interval

---

## SELECTED RANGE TOOL (Part 9)

The range tool now uses **world coordinates** for matching:
1. Screen X coordinates of drag are converted to world indices via `screenToWorldX()`
2. Candles are filtered by world index range AND price range
3. Profile computed from filtered candles
4. Works correctly after any zoom/pan — coordinates are absolute, not screen-relative

---

## SCALPER UX CONTROLS (Part 10)

Top bar now includes:
- `◉ Live` — follow live toggle
- `⊞ Recent` — fit recent 250 candles
- `⊞ All` — fit all loaded history
- `+`/`-` — zoom in/out
- `↺ Reset` — reset to defaults
- `Ⓐ Labels` — label density toggle
- `⚖ Auto` — price autoscale
- `🐛` — debug panel toggle

Hint bar below top bar shows:
```
Ctrl+Wheel = zoom time | Shift+Wheel = zoom price | Drag = pan
+/- = zoom | 0 = reset | F = fit recent | Home = live | R = range tool
```

---

## DEBUG PANEL (Part 11)

Collapsible panel (top-right of chart) showing:
- candleCount, visibleCandleCount, candlesPerScreen
- minCandles, maxCandles, rightPadding
- followLive, manualPrice
- latestCandleIdx, viewportStart, viewportEnd, centerIndex
- pricePerPixel, labelDensity
- clusterCount, individualBubbles
- mouseMode, lastValidViewport

---

## VALIDATION CHECKLIST (Part 12)

| # | Test | Status |
|---|------|--------|
| 1 | BTC loads with historical 40s candles | ✅ |
| 2 | Latest candle has right-side breathing room | ✅ |
| 3 | Ctrl+wheel zooms horizontally around cursor | ✅ |
| 4 | User can zoom until 3–10 candles visible | ✅ |
| 5 | Candle bodies become wide and readable | ✅ |
| 6 | Drag pan left/right works | ✅ |
| 7 | Dragging right does not make candles disappear | ✅ |
| 8 | Fit Recent works | ✅ |
| 9 | Fit All works | ✅ |
| 10 | Reset View works | ✅ |
| 11 | Follow Live keeps right padding | ✅ |
| 12 | Bubbles render as circles, not text badges | ✅ |
| 13 | Bubbles at correct price levels after zoom/pan | ✅ |
| 14 | Bubble state colors visually distinct | ✅ |
| 15 | Rejected and absorbed look different | ✅ |
| 16 | Cluster count is understandable ("3x") | ✅ |
| 17 | Hover tooltip explains bubble/cluster | ✅ |
| 18 | Text labels do not clutter chart | ✅ |
| 19 | Selected range works after zoom/pan | ✅ |
| 20 | No crash after repeated zoom/pan/tool clicks | ✅ |

---

## REMAINING LIMITATIONS

- Historical data comes from Hyperliquid 1m candles (not native 40s backfill)
- Bubble response times (3s/10s/40s) depend on server-side computation
- Range profile computation is server-side only (REST call)
- No persistent viewport state across page reloads (could add localStorage)

---

## RUN INSTRUCTIONS

```bash
# Clone
git clone https://github.com/ShrPaw/orderflow-cockpit.git
cd orderflow-cockpit

# Install
npm install

# Start
npm start

# Open browser
# http://localhost:3777
```

---

## KEY CONSTANTS

```js
MIN_CANDLES_VISIBLE = 3        // Deep zoom limit
MAX_CANDLES_VISIBLE = 600      // Wide zoom limit
DEFAULT_CANDLES_VISIBLE = 100  // Startup/reset
FIT_RECENT_MAX = 250           // Fit Recent button
RIGHT_PADDING_CANDLES = 12     // Breathing room
LIVE_CANDLE_POSITION = 0.80    // Latest candle at 80% width
BUBBLE_MIN_R = 3               // Minimum bubble radius
BUBBLE_MAX_R = 24              // Maximum bubble radius
ZOOM_FACTOR_WHEEL = 1.12       // Per wheel notch
ZOOM_FACTOR_BTN = 1.35         // Per button click
```

---

## KEYBOARD SHORTCUTS

| Key | Action |
|-----|--------|
| `Ctrl+Wheel` | Time axis zoom (cursor-centered) |
| `Shift+Wheel` | Price axis zoom |
| `Wheel` | Horizontal pan |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset view |
| `F` | Fit recent 250 candles |
| `Home` | Snap to live |
| `R` | Range profile tool |
| `Esc` | Cancel / deselect |
| `Del` | Delete last drawing |
| Double-click price axis | Reset price autoscale |
