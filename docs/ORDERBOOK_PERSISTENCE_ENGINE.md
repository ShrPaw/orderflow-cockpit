# Order Book Persistence Engine

## Architecture: DisplayBook + StrictBook

The order book uses a **dual-stream architecture** to ensure the UI always has usable depth data.

### DisplayBook (depth20 — immediate)

- Connected **immediately** on symbol start via `symbol@depth20@100ms`
- Provides a continuously updating **top-20** book for DOM, heatmap, and liquidity overlays
- Available within ~200ms of connection — no waiting for strict sync
- Each depth20 message is a full top-20 snapshot (no diff tracking needed)
- Source label: `depth20`

### StrictBook (diff-depth — parallel)

- Connected **in parallel** with depth20 via `symbol@depth@100ms`
- Uses the Binance official methodology:
  1. Open diff stream → buffer events
  2. Fetch REST snapshot (`/fapi/v1/depth?limit=1000`)
  3. Validate first overlapping event (`U <= L+1 && u >= L+1`)
  4. Validate `pu` chain continuity
  5. Only promotes to `HEALTHY` if mathematically valid
- Source label: `strict`

### How They Interact

```
Symbol Start
    │
    ├── depth20 connects immediately → DisplayBook ready in ~200ms
    │       health: TOP20, source: depth20
    │
    └── strict sync starts in parallel
            │
            ├── Snapshot loads → BUFFERING/SNAPSHOT_LOADING
            │       DisplayBook: still depth20
            │
            ├── First overlap validated → HEALTHY
            │       source switches to: strict
            │       depth20 stays connected but doesn't overwrite strict book
            │
            └── Strict fails → DEGRADED
                    source stays: depth20
                    strict retries in background with backoff
                    depth20 continues providing display book
```

## Health States

| Health | Meaning | Display Source | UI Visible |
|--------|---------|---------------|------------|
| `CONNECTING` | Initial connection | none | "Connecting..." |
| `TOP20` | depth20 active, strict loading | depth20 | ✅ Top-20 book shown |
| `BUFFERING` | Strict diff stream open, waiting for snapshot | depth20 | ✅ Top-20 book shown |
| `SNAPSHOT_LOADING` | Strict REST snapshot loading | depth20 | ✅ Top-20 book shown |
| `SYNCING` | Strict waiting for overlap event | depth20 | ✅ Top-20 book shown |
| `HEALTHY` | Strict sync validated | strict | ✅ Full book shown |
| `RESYNCING` | Strict resyncing after failure | depth20 | ✅ Top-20 book shown |
| `DEGRADED` | Strict failed, depth20 fallback | depth20 | ✅ Top-20 book shown |
| `STALE` | No updates for >20s | last_known | ⚠️ Dimmed |
| `ERROR` | Fatal error | none | ❌ Error message |
| `DISCONNECTED` | Not connected | none | ❌ Hidden |

## Source Labels

| Source | Meaning | UI Label |
|--------|---------|----------|
| `strict` | Mathematically validated diff-depth book | `SOURCE: STRICT DIFF-DEPTH` |
| `depth20` | Top-20 partial book (Binance depth20 stream) | `SOURCE: TOP-20 FALLBACK` |
| `last_known` | Last received data, no active stream | Shown as stale |
| `none` | No data yet | Hidden |

## Why depth20 Fallback Is Immediate

The previous architecture connected depth20 **only after** strict sync failed (3+ times). This meant:

- User stared at "SNAPSHOT_LOADING" for 10-40 seconds
- DOM showed no data during strict sync
- Heatmap was empty during sync
- Liquidity overlays were paused

The new architecture connects depth20 **immediately** on symbol start. The UI has usable (if limited) depth data within ~200ms. Strict sync runs in parallel and promotes when ready.

## What HEALTHY Means

`HEALTHY` means the strict diff-depth book has been mathematically validated:

1. REST snapshot was fetched successfully
2. First overlapping diff event was found (`U <= L+1 && u >= L+1`)
3. All subsequent events passed `pu` chain validation
4. The book is fully consistent with the exchange state

Only `HEALTHY` books have guaranteed update-ID continuity. The `depth20` fallback is authoritative for top-20 levels but has no diff tracking.

## What DEGRADED/TOP20 Means

- `TOP20`: depth20 is providing the display book while strict sync loads. This is a **normal transitional state**, not an error.
- `DEGRADED`: Strict sync failed after multiple attempts. depth20 continues as fallback. Strict retries in background.

Both states show usable top-20 book data. The UI is not paused.

## Why Strict Sync Retries in Background

When strict sync fails:

1. The display book (depth20) is **NOT cleared**
2. Health goes to `DEGRADED`
3. A recovery timer attempts strict resync every 30 seconds
4. If strict succeeds later, it promotes back to `HEALTHY`
5. If strict fails again, depth20 remains as display book

This ensures the user always has the best available book data.

## Limitations of Top-20 Fallback

- Only 20 price levels per side (vs 1000 from strict)
- No diff tracking (each update is a full replacement)
- No `lastUpdateId` continuity (can't validate sequence)
- Slightly higher bandwidth (full snapshot every 100ms vs diffs)

## No Fake HEALTHY Policy

The system **never** marks the book as `HEALTHY` unless the strict sync methodology has been fully validated. If only depth20 is available, the state is `TOP20` or `DEGRADED`, never `HEALTHY`.

## Resync Behavior

The "Resync Book" button:

1. Restarts strict sync in the background
2. Does **NOT** disconnect depth20 fallback
3. Does **NOT** clear the displayed book
4. UI continues showing top-20 or last-known book during resync
5. If strict succeeds, promotes to `HEALTHY`

## Debug Mode

Enable debug logging:

```javascript
localStorage.setItem('DEBUG_BOOK', '1')
```

Logs state transitions, not every tick. Shows:
- Source changes
- Health transitions
- Snapshot success/failure
- First overlap results
- Sequence gap detection
- Depth20 update samples (every 5s)
