/**
 * localOrderBook.ts
 *
 * Binance Futures local order book engine — DUAL-STREAM ARCHITECTURE
 *
 * DISPLAY BOOK (depth20):
 *   Connected IMMEDIATELY on symbol start.
 *   Provides continuously updating top-20 book for DOM/heatmap/liquidity.
 *   Available even while strict sync is loading.
 *   Source label: "depth20"
 *
 * STRICT BOOK (diff-depth):
 *   Connected in PARALLEL with depth20.
 *   Uses Binance official methodology: diff stream + REST snapshot + U/u/pu validation.
 *   If strict sync succeeds → promotes to HEALTHY, source becomes "strict".
 *   If strict sync fails → depth20 remains as display book, strict retries in background.
 *   Strict failure NEVER destroys the display book.
 *
 * Stream: symbol@depth@100ms (diff-depth, strict)
 * Display: symbol@depth20@100ms (partial top-20, always connected)
 * REST:   GET /fapi/v1/depth?symbol=SYMBOL&limit=1000
 */

import type {
  OrderLevel, OrderBookHealth, OrderBookSource, DiffDepthEvent, DepthSnapshot,
} from '../types/market'
import { registryAdd, registryRemove } from './connectionRegistry'
import { isSpreadSane, validateBookIntegrity } from '../utils/bookValidation'

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export interface LocalBookCallbacks {
  onSnapshot: (bids: OrderLevel[], asks: OrderLevel[], lastUpdateId: number) => void
  onDiffApplied: (bids: OrderLevel[], asks: OrderLevel[], lastUpdateId: number, transactionTime: number) => void
  onHealthChange: (health: OrderBookHealth, error?: string | null) => void
  onSourceChange: (source: OrderBookSource) => void
  onStale: (reason: string) => void
}

interface BookState {
  bids: Map<string, number>   // price string → qty
  asks: Map<string, number>
  lastUpdateId: number
  lastEventUpdateId: number
  lastTransactionTime: number
  lastMessageTime: number
  health: OrderBookHealth
  source: OrderBookSource
  error: string | null
  reconnectAttempts: number
}

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const REST_SNAPSHOT_URL = 'https://fapi.binance.com/fapi/v1/depth'
const WS_BASE = 'wss://fstream.binance.com/ws'

const SNAPSHOT_LIMIT = 1000
const MAX_BUFFER_EVENTS = 1000

// Exponential backoff: 1s → 1.5s → 2.25s → 3.4s → 5.1s → 7.6s → 11.4s → 15s cap
const BACKOFF_INITIAL = 1_000
const BACKOFF_MAX = 15_000
const BACKOFF_FACTOR = 1.5

const STALE_THRESHOLD_MS = 20_000
const STALE_CHECK_INTERVAL_MS = 5_000
const INITIAL_GRACE_PERIOD_MS = 30_000

// Rate-limit resync: at most once per this interval
const RESYNC_COOLDOWN_MS = 5_000

// Degraded fallback: enter after this many failed strict syncs within window
const DEGRADED_SYNC_FAILURES = 3
const DEGRADED_SYNC_WINDOW_MS = 60_000

// Periodic recovery attempt from DEGRADED → HEALTHY
const DEGRADED_RECOVERY_INTERVAL_MS = 30_000

// ─── Timeout constants to prevent stuck states ───
const SNAPSHOT_REQUEST_TIMEOUT_MS = 10_000
const SNAPSHOT_LOADING_MAX_MS = 20_000
const SYNCING_MAX_MS = 15_000
const STRICT_SYNC_ATTEMPT_MAX_MS = 40_000
const MAX_STRICT_FAILURES_BEFORE_DEGRADED = 3

// ═══════════════════════════════════════════
// DEBUG BOOK DIAGNOSTICS
// ═══════════════════════════════════════════

let _debugBookEnabled: boolean | null = null
function isDebugBook(): boolean {
  if (_debugBookEnabled === null) {
    try { _debugBookEnabled = localStorage.getItem('DEBUG_BOOK') === '1' } catch { _debugBookEnabled = false }
  }
  return _debugBookEnabled
}

interface DebugBookEvent {
  type: string
  symbol?: string
  generation?: number
  [key: string]: unknown
}

function debugBookEmit(event: DebugBookEvent) {
  if (!isDebugBook()) return
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`%c[DEBUG_BOOK ${ts}]`, 'color:#4fc3f7;font-weight:bold', event.type, event)
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function getBackoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_INITIAL * Math.pow(BACKOFF_FACTOR, attempt), BACKOFF_MAX)
  const jitter = base * 0.25 * (Math.random() * 2 - 1)
  return Math.max(500, base + jitter)
}

function sortedBids(book: Map<string, number>): OrderLevel[] {
  return Array.from(book.entries())
    .filter(([, qty]) => qty > 0)
    .map(([price, qty]) => ({ price: parseFloat(price), qty }))
    .sort((a, b) => b.price - a.price)
}

function sortedAsks(book: Map<string, number>): OrderLevel[] {
  return Array.from(book.entries())
    .filter(([, qty]) => qty > 0)
    .map(([price, qty]) => ({ price: parseFloat(price), qty }))
    .sort((a, b) => a.price - b.price)
}

// ═══════════════════════════════════════════
// REST SNAPSHOT
// ═══════════════════════════════════════════

async function fetchDepthSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<DepthSnapshot> {
  const url = `${REST_SNAPSHOT_URL}?symbol=${symbol.toUpperCase()}&limit=${SNAPSHOT_LIMIT}`
  const resp = await fetch(url, { signal })
  if (!resp.ok) {
    throw new Error(`Depth snapshot HTTP ${resp.status}: ${resp.statusText}`)
  }
  const data = await resp.json()
  if (!data.lastUpdateId || !Array.isArray(data.bids) || !Array.isArray(data.asks)) {
    throw new Error('Invalid depth snapshot response')
  }
  return {
    lastUpdateId: data.lastUpdateId,
    bids: data.bids,
    asks: data.asks,
  }
}

// ═══════════════════════════════════════════
// LOCAL ORDER BOOK ENGINE — DUAL STREAM
// ═══════════════════════════════════════════

const STREAM_NAME = 'depth'
const FALLBACK_STREAM_NAME = 'depth20'

export interface LocalOrderBookHandle {
  resync: () => void
  dispose: () => void
}

export function createLocalOrderBook(
  symbol: string,
  callbacks: LocalBookCallbacks,
): LocalOrderBookHandle {

  // ─── Shared book state (written by both streams) ───
  const book: BookState = {
    bids: new Map(),
    asks: new Map(),
    lastUpdateId: 0,
    lastEventUpdateId: 0,
    lastTransactionTime: 0,
    lastMessageTime: 0,
    health: 'DISCONNECTED',
    source: 'none',
    error: null,
    reconnectAttempts: 0,
  }

  // ─── WebSocket references ───
  let strictWs: WebSocket | null = null
  let depth20Ws: WebSocket | null = null

  // ─── Lifecycle ───
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let recoveryTimer: ReturnType<typeof setInterval> | null = null
  let timeoutChecker: ReturnType<typeof setInterval> | null = null
  let createdAt = Date.now()
  let lastResyncTime = 0

  // ─── Generation token: ignores events from stale sockets ───
  let generation = 0

  // ─── Snapshot AbortController ───
  let snapshotAbort: AbortController | null = null

  // ─── Strict sync state ───
  let snapshotLoaded = false
  let pendingEvents: DiffDepthEvent[] = []
  let firstEventValidated = false
  let lastPu: number | null = null
  let lastAppliedUpdateId = 0
  let syncFailureTimes: number[] = []
  let consecutiveStrictFailures = 0
  let strictHealthy = false  // track if strict book has ever been HEALTHY this session

  // ─── Timeout tracking ───
  let syncStartTime = 0
  let snapshotLoadStartTime = 0
  let syncingStartTime = 0

  // ─── Depth20 tracking ───
  let depth20Connected = false
  let lastDepth20Time = 0
  let lastFallbackLogTime = 0

  // ─── Degraded mode (strict failed, using depth20) ───
  let isDegraded = false
  let degradedRecoveryAttempt = 0

  // ─── Dev logging ───
  const LOG_TAG = `[LocalBook:${symbol}]`
  function devLog(...args: unknown[]) {
    if (import.meta.env?.DEV) console.log(LOG_TAG, `gen=${generation}`, ...args)
  }
  function devWarn(...args: unknown[]) {
    if (import.meta.env?.DEV) console.warn(LOG_TAG, `gen=${generation}`, ...args)
  }

  // ═══════════════════════════════════════════
  // HEALTH + SOURCE MANAGEMENT
  // ═══════════════════════════════════════════

  // States where depth20 is providing valid display data
  const DEPTH20_ACTIVE_STATES: OrderBookHealth[] = ['TOP20', 'DEGRADED']
  // Strict sync transitional states that should NOT overwrite depth20-active states
  const STRICT_TRANSITIONAL_STATES: OrderBookHealth[] = ['BUFFERING', 'SNAPSHOT_LOADING', 'SYNCING', 'RESYNCING', 'CONNECTING']

  function setHealth(h: OrderBookHealth, err: string | null = null) {
    const prev = book.health
    if (prev === h && book.error === err) return

    // PROTECTION: Don't let strict sync transitional states downgrade
    // a depth20-active state. If depth20 is providing valid data (TOP20 or DEGRADED),
    // strict sync's loading states should not overwrite it.
    if (STRICT_TRANSITIONAL_STATES.includes(h) && DEPTH20_ACTIVE_STATES.includes(prev)) {
      debugBookEmit({
        type: 'health_blocked',
        symbol,
        requested: h,
        current: prev,
        reason: 'depth20 active — strict transitional state blocked',
      })
      return
    }

    book.health = h
    book.error = err
    devLog(`health: ${prev} → ${h}`, err ?? '')
    callbacks.onHealthChange(h, err)
  }

  function setSource(s: OrderBookSource) {
    const prev = book.source
    if (prev === s) return
    book.source = s
    devLog(`source: ${prev} → ${s}`)
    callbacks.onSourceChange(s)
  }

  // ═══════════════════════════════════════════
  // EMIT CURRENT BOOK TO UI
  // ═══════════════════════════════════════════

  function emitBook() {
    const bids = sortedBids(book.bids)
    const asks = sortedAsks(book.asks)
    callbacks.onDiffApplied(bids, asks, book.lastEventUpdateId, book.lastTransactionTime)
  }

  // ═══════════════════════════════════════════
  // DEPTH20 FALLBACK — IMMEDIATE DISPLAY BOOK
  // ═══════════════════════════════════════════

  function connectDepth20() {
    if (disposed) return
    closeDepth20()

    const myGen = generation
    const wsSymbol = symbol.toLowerCase() + '@depth20@100ms'
    const url = `${WS_BASE}/${wsSymbol}`
    devLog(`connecting depth20 immediately: ${url}`)
    registryAdd(FALLBACK_STREAM_NAME, symbol, myGen, url)

    const socket = new WebSocket(url)
    depth20Ws = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      devLog('depth20 connected')
      depth20Connected = true
    }

    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
      try {
        const msg = JSON.parse(event.data as string)
        handleDepth20Update(msg, myGen)
      } catch (err) {
        devWarn('depth20 parse error:', err)
      }
    }

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) return
      devLog(`depth20 closed: code=${ev.code}`)
      depth20Ws = null
      depth20Connected = false
      // Reconnect depth20 if still running
      if (!disposed) {
        const delay = getBackoffDelay(book.reconnectAttempts)
        book.reconnectAttempts++
        scheduleReconnect(() => {
          if (!disposed && generation === myGen) connectDepth20()
        }, delay)
      }
    }

    socket.onerror = () => {
      if (disposed || generation !== myGen) return
      socket.close()
    }
  }

  function closeDepth20() {
    if (depth20Ws) {
      depth20Ws.onopen = null
      depth20Ws.onmessage = null
      depth20Ws.onerror = null
      depth20Ws.onclose = null
      try { depth20Ws.close() } catch { /* ignore */ }
      depth20Ws = null
      depth20Connected = false
    }
  }

  function handleDepth20Update(msg: any, gen: number) {
    if (gen !== generation) return
    book.lastMessageTime = Date.now()
    lastDepth20Time = Date.now()

    const bidsRaw: [string, string][] = msg.bids ?? msg.b ?? []
    const asksRaw: [string, string][] = msg.asks ?? msg.a ?? []

    // If strict is HEALTHY, strict owns the book — don't overwrite
    if (strictHealthy && book.health === 'HEALTHY') return

    // Parse and sort depth20 data (it's a full top-20 snapshot)
    const parsedBids: [string, number][] = []
    const parsedAsks: [string, number][] = []
    for (const [priceStr, qtyStr] of bidsRaw) {
      const qty = parseFloat(qtyStr as string)
      if (qty > 0) parsedBids.push([priceStr as string, qty])
    }
    for (const [priceStr, qtyStr] of asksRaw) {
      const qty = parseFloat(qtyStr as string)
      if (qty > 0) parsedAsks.push([priceStr as string, qty])
    }

    // Sort: bids descending, asks ascending (depth20 may not always be sorted)
    parsedBids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    parsedAsks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))

    // Quick sanity check on spread before accepting
    if (parsedBids.length > 0 && parsedAsks.length > 0) {
      const bestBid = parsedBids[0][1]
      const bestAsk = parsedAsks[0][1]
      if (!isSpreadSane(bestBid, bestAsk)) {
        debugBookEmit({
          type: 'depth20_rejected',
          symbol,
          reason: 'unrealistic spread',
          bestBid,
          bestAsk,
          spreadPct: ((bestAsk - bestBid) / bestBid * 100).toFixed(4),
        })
        return // Reject this update — don't corrupt the book
      }
    }

    // Replace book atomically
    book.bids.clear()
    book.asks.clear()
    for (const [priceStr, qty] of parsedBids) book.bids.set(priceStr, qty)
    for (const [priceStr, qty] of parsedAsks) book.asks.set(priceStr, qty)

    // depth20 has no diff tracking — use 0
    book.lastUpdateId = 0
    book.lastEventUpdateId = 0
    book.lastTransactionTime = Date.now()

    // If strict is not HEALTHY, depth20 IS the display book
    if (!strictHealthy || book.health !== 'HEALTHY') {
      setSource('depth20')

      // depth20 is providing valid data — promote to TOP20.
      // IMPORTANT: TOP20 is a valid, stable display state.
      // Do NOT overwrite with strict sync's transitional states.
      const health = book.health
      const shouldPromote = health === 'CONNECTING'
        || health === 'DISCONNECTED'
        || health === 'TOP20'  // already TOP20, stay there
        || health === 'SNAPSHOT_LOADING'
        || health === 'BUFFERING'
        || health === 'SYNCING'
        || health === 'RESYNCING'

      if (shouldPromote) {
        setHealth('TOP20')
      }

      emitBook()
    }

    // Debug: sample at most once every 5 seconds
    const now = Date.now()
    if (isDebugBook() && now - lastFallbackLogTime > 5_000) {
      lastFallbackLogTime = now
      debugBookEmit({
        type: 'depth20_update',
        symbol,
        bidsCount: parsedBids.length,
        asksCount: parsedAsks.length,
        bestBid: parsedBids.length > 0 ? parsedBids[0][0] : 'N/A',
        bestAsk: parsedAsks.length > 0 ? parsedAsks[0][0] : 'N/A',
        displayBookSource: book.source,
        orderBookHealth: book.health,
      })
    }
  }

  // ═══════════════════════════════════════════
  // STRICT SYNC — PARALLEL BACKGROUND ENGINE
  // ═══════════════════════════════════════════

  function applyDiff(event: DiffDepthEvent) {
    for (const [priceStr, qtyStr] of event.b) {
      const qty = parseFloat(qtyStr)
      if (qty === 0) book.bids.delete(priceStr)
      else book.bids.set(priceStr, qty)
    }
    for (const [priceStr, qtyStr] of event.a) {
      const qty = parseFloat(qtyStr)
      if (qty === 0) book.asks.delete(priceStr)
      else book.asks.set(priceStr, qty)
    }
    book.lastEventUpdateId = event.u
    lastAppliedUpdateId = event.u
    book.lastTransactionTime = event.T ?? Date.now()
    book.lastMessageTime = Date.now()
  }

  function applySnapshot(snapshot: DepthSnapshot) {
    book.bids.clear()
    book.asks.clear()
    for (const [priceStr, qtyStr] of snapshot.bids) {
      const qty = parseFloat(qtyStr)
      if (qty > 0) book.bids.set(priceStr, qty)
    }
    for (const [priceStr, qtyStr] of snapshot.asks) {
      const qty = parseFloat(qtyStr)
      if (qty > 0) book.asks.set(priceStr, qty)
    }
    book.lastUpdateId = snapshot.lastUpdateId
    book.lastEventUpdateId = snapshot.lastUpdateId
    lastAppliedUpdateId = snapshot.lastUpdateId
    book.lastMessageTime = Date.now()
    snapshotLoaded = true
    firstEventValidated = false
    lastPu = null

    devLog(`snapshot applied: lastUpdateId=${snapshot.lastUpdateId}`)
    const bids = sortedBids(book.bids)
    const asks = sortedAsks(book.asks)
    callbacks.onSnapshot(bids, asks, snapshot.lastUpdateId)
  }

  /**
   * Process buffered events from the diff stream.
   *
   * Called AFTER snapshot is applied. Finds the first event that spans
   * lastUpdateId+1 (the Binance overlap condition) and applies from there.
   *
   * Returns true if promotion to HEALTHY succeeded.
   * Returns false if we need to wait for live events or resync.
   */
  function processBufferedEvents(gen: number): boolean {
    if (!snapshotLoaded) return false
    if (gen !== generation) return false

    const L = book.lastUpdateId

    // STEP A: Drop stale events (u <= lastUpdateId, per Binance docs)
    const beforeCount = pendingEvents.length
    const valid = pendingEvents.filter(e => e.u > L)
    const droppedCount = beforeCount - valid.length
    pendingEvents = []

    devLog(`[gen=${gen}] processBufferedEvents: ${beforeCount} buffered, ${droppedCount} dropped (u <= ${L}), ${valid.length} valid`)

    if (valid.length === 0) {
      // No valid events after dropping stale ones.
      // The diff stream started after the snapshot — need live events.
      debugBookEmit({
        type: 'overlap_check',
        symbol,
        generation: gen,
        snapshotLastUpdateId: L,
        bufferedTotal: beforeCount,
        droppedStale: droppedCount,
        validRemaining: 0,
        foundOverlap: false,
        reason: 'no valid events after dropping stale — waiting for live',
      })
      setHealth('SYNCING', 'Waiting for overlapping diff event…')
      syncingStartTime = Date.now()
      return false
    }

    valid.sort((a, b) => a.U - b.U)

    const firstBuf = valid[0]
    const lastBuf = valid[valid.length - 1]

    // STEP B: Find first event where U <= L+1 && u >= L+1 (Binance overlap condition)
    // This is the event that "bridges" the snapshot to the live stream.
    let startIdx = -1
    for (let i = 0; i < valid.length; i++) {
      const e = valid[i]
      if (e.U <= L + 1 && e.u >= L + 1) {
        startIdx = i
        break
      }
    }

    debugBookEmit({
      type: 'overlap_check',
      symbol,
      generation: gen,
      snapshotLastUpdateId: L,
      condition: `U <= ${L + 1} && u >= ${L + 1}`,
      bufferedTotal: beforeCount,
      droppedStale: droppedCount,
      validRemaining: valid.length,
      firstValidEvent: { U: firstBuf.U, u: firstBuf.u, pu: firstBuf.pu },
      lastValidEvent: { U: lastBuf.U, u: lastBuf.u, pu: lastBuf.pu },
      foundOverlap: startIdx >= 0,
      overlapIndex: startIdx,
    })

    if (startIdx === -1) {
      // No event spans L+1.
      // Check if the buffer overshot: first valid event starts AFTER L+1
      if (firstBuf.U > L + 1) {
        devWarn(`[gen=${gen}] BUFFER OVERSHOOT: first valid U=${firstBuf.U} > L+1=${L + 1}. Gap=${firstBuf.U - L - 1}. Need fresh snapshot.`)
        debugBookEmit({
          type: 'overshoot',
          symbol,
          generation: gen,
          snapshotLastUpdateId: L,
          firstValidU: firstBuf.U,
          gap: firstBuf.U - L - 1,
          action: 'will timeout → resync',
        })
        // Don't resync immediately — let the timeout handle it to avoid resync storms.
        // The SYNCING timeout (15s) will trigger recordSyncFailure → resync.
        setHealth('SYNCING', 'Buffer gap — waiting for fresh snapshot…')
        syncingStartTime = Date.now()
        return false
      }

      // Events exist but none span L+1 yet. Wait for live events.
      devLog(`[gen=${gen}] no overlap yet: first U=${firstBuf.U}, last u=${lastBuf.u}, need U<=${L+1} && u>=${L+1}`)
      setHealth('SYNCING', 'Waiting for overlapping diff event…')
      syncingStartTime = Date.now()
      return false
    }

    // STEP C: Found overlap — apply from startIdx onward
    const overlapEvent = valid[startIdx]
    devLog(`[gen=${gen}] OVERLAP FOUND at index ${startIdx}: U=${overlapEvent.U} u=${overlapEvent.u} (L=${L})`)

    for (let i = startIdx; i < valid.length; i++) {
      const event = valid[i]
      // Validate pu continuity (per Binance docs: pu must equal previous u)
      if (i > startIdx && event.pu !== undefined) {
        const prevEvent = valid[i - 1]
        if (event.pu !== prevEvent.u) {
          devWarn(`[gen=${gen}] pu gap at index ${i}: pu=${event.pu} != prev.u=${prevEvent.u}`)
          recordSyncFailure(`Sequence gap: pu=${event.pu} != prev.u=${prevEvent.u}`)
          return false
        }
      }
      applyDiff(event)
      lastPu = event.pu ?? null
    }

    promoteToHealthy()
    return true
  }

  /**
   * Handle a live diff event after the snapshot has been loaded.
   *
   * If strict is already healthy: apply with pu continuity check.
   * If not yet healthy: look for the first event that spans lastUpdateId+1.
   */
  function handleDiffEvent(event: DiffDepthEvent, gen: number) {
    if (gen !== generation) return
    book.lastMessageTime = Date.now()

    // Safety buffer if snapshot not loaded yet
    if (!snapshotLoaded) {
      if (pendingEvents.length < MAX_BUFFER_EVENTS) pendingEvents.push(event)
      return
    }

    // Drop stale events (u <= lastUpdateId, per Binance docs)
    if (event.u <= book.lastUpdateId) return

    // ── Strict book already healthy: apply with pu check ──
    if (strictHealthy) {
      if (event.pu !== undefined && event.pu !== lastAppliedUpdateId) {
        devWarn(`[gen=${gen}] pu mismatch on HEALTHY book: pu=${event.pu} != lastApplied=${lastAppliedUpdateId}`)
        recordSyncFailure(`pu mismatch on healthy book: ${event.pu} != ${lastAppliedUpdateId}`)
        return
      }
      applyDiff(event)
      lastPu = event.pu ?? null
      setSource('strict')
      emitBook()
      return
    }

    // ── Not yet healthy: find first overlap ──
    if (!firstEventValidated) {
      const L = book.lastUpdateId

      if (event.U <= L + 1 && event.u >= L + 1) {
        // OVERLAP FOUND — this event bridges the snapshot
        firstEventValidated = true
        lastPu = event.pu ?? null
        applyDiff(event)
        promoteToHealthy()
        devLog(`[gen=${gen}] LIVE overlap: U=${event.U} u=${event.u} L=${L} → HEALTHY`)
        debugBookEmit({
          type: 'live_overlap',
          symbol,
          generation: gen,
          snapshotLastUpdateId: L,
          event: { U: event.U, u: event.u, pu: event.pu, T: event.T },
        })
        return
      }

      // Gap: event starts too far past snapshot — unbridgeable
      if (event.U > L + 1) {
        devWarn(`[gen=${gen}] live gap: U=${event.U} > L+1=${L + 1} (gap=${event.U - L - 1})`)
        debugBookEmit({
          type: 'live_gap',
          symbol,
          generation: gen,
          snapshotLastUpdateId: L,
          eventU: event.U,
          gap: event.U - L - 1,
        })
        recordSyncFailure(`Live event gap: U=${event.U} > L+1=${L + 1}`)
        return
      }

      // Event starts before snapshot — stale, drop
      return
    }

    // ── firstEventValidated but not yet healthy (shouldn't happen normally) ──
    if (event.pu !== undefined && event.pu !== lastAppliedUpdateId) {
      devWarn(`[gen=${gen}] pu mismatch: pu=${event.pu} != lastApplied=${lastAppliedUpdateId}`)
      recordSyncFailure(`pu mismatch: ${event.pu} != ${lastAppliedUpdateId}`)
      return
    }

    applyDiff(event)
    lastPu = event.pu ?? null
    setSource('strict')
    emitBook()
  }

  // ─── Promote to HEALTHY (strict book validated) ───
  function promoteToHealthy() {
    strictHealthy = true
    isDegraded = false
    consecutiveStrictFailures = 0
    syncFailureTimes = []
    book.reconnectAttempts = 0
    stopRecoveryTimer()
    setSource('strict')
    setHealth('HEALTHY')
    emitBook()
    devLog('STRICT BOOK HEALTHY — promoted display book to strict')
  }

  // ─── Record sync failure and possibly enter degraded ───
  function recordSyncFailure(reason: string) {
    const now = Date.now()
    syncFailureTimes.push(now)
    consecutiveStrictFailures++
    syncFailureTimes = syncFailureTimes.filter(t => now - t < DEGRADED_SYNC_WINDOW_MS)

    devWarn(`sync failure (${syncFailureTimes.length}/${DEGRADED_SYNC_FAILURES}, consecutive=${consecutiveStrictFailures}): ${reason}`)

    if (syncFailureTimes.length >= DEGRADED_SYNC_FAILURES || consecutiveStrictFailures >= MAX_STRICT_FAILURES_BEFORE_DEGRADED) {
      enterDegraded()
    } else {
      triggerStrictResync(reason)
    }
  }

  // ─── Enter degraded mode (strict failed, depth20 is display) ───
  function enterDegraded() {
    if (isDegraded) return
    isDegraded = true
    degradedRecoveryAttempt = 0
    devLog('entering DEGRADED — depth20 is display book, strict retries in background')

    debugBookEmit({
      type: 'degraded_enter',
      symbol,
      generation,
      reason: `Strict sync failed ${consecutiveStrictFailures} times consecutively`,
    })

    // Close strict socket
    closeStrictSocket()

    // Abort in-flight snapshot
    if (snapshotAbort) {
      snapshotAbort.abort()
      snapshotAbort = null
    }

    // Clear strict sync state
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []
    strictHealthy = false
    stopTimeoutChecker()

    // DO NOT clear book — depth20 data is still valid
    // Set health to DEGRADED, source stays depth20
    setHealth('DEGRADED', 'Strict sync failed — using top-20 fallback')
    setSource('depth20')

    // depth20 is already connected (connected at start) — just ensure it's running
    if (!depth20Connected && !depth20Ws) {
      connectDepth20()
    }

    // Start periodic recovery attempts
    startRecoveryTimer()
  }

  // ─── Exit degraded → attempt strict resync ───
  function exitDegraded() {
    if (!isDegraded) return
    isDegraded = false
    degradedRecoveryAttempt = 0
    devLog('exiting DEGRADED — attempting strict resync')
    stopRecoveryTimer()

    // Don't clear book — depth20 data stays as display while strict loads
    // Don't disconnect depth20 — it remains the display book until strict promotes
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []
    strictHealthy = false

    // Health goes to SNAPSHOT_LOADING (strict loading), source stays depth20
    setHealth('SNAPSHOT_LOADING', 'Strict sync retrying — top-20 book active')
    setSource('depth20')

    connectStrictStreamThenSnapshot()
  }

  // ═══════════════════════════════════════════
  // STRICT STREAM — SOCKET MANAGEMENT
  // ═══════════════════════════════════════════

  function closeStrictSocket() {
    if (strictWs) {
      strictWs.onopen = null
      strictWs.onmessage = null
      strictWs.onerror = null
      strictWs.onclose = null
      try { strictWs.close() } catch { /* ignore */ }
      strictWs = null
    }
  }

  /**
   * CORRECT Binance Futures local order book sync (WebSocket-first):
   *
   * Per https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly
   *
   * 1. Open diff-depth WebSocket stream → buffer events
   * 2. Fetch REST depth snapshot
   * 3. Drop any buffered event where u <= snapshot.lastUpdateId
   * 4. Find first event that spans lastUpdateId+1:
   *    event.U <= lastUpdateId+1 && event.u >= lastUpdateId+1
   * 5. Apply snapshot, then apply from overlap event onward
   * 6. For subsequent events, validate pu == previous.u
   * 7. If gap detected, restart from step 2
   *
   * WHY snapshot-first was wrong:
   *   Snapshot-first means the diff stream starts AFTER the snapshot.
   *   By the time the WebSocket connects and events arrive, they've
   *   already moved past the snapshot's lastUpdateId. The overlap
   *   condition can never be satisfied → permanent SYNCING.
   *
   * WHY WebSocket-first works:
   *   Events are buffered from the moment the stream connects.
   *   The snapshot is fetched immediately after.
   *   The snapshot's lastUpdateId is recent, and the buffered events
   *   bracket it — guaranteeing an overlap exists.
   */
  async function connectStrictStreamThenSnapshot() {
    if (disposed) return

    cancelReconnectTimer()
    closeStrictSocket()
    stopTimeoutChecker()

    const myGen = ++generation
    syncStartTime = Date.now()

    // ── STEP 1: Connect diff-depth WebSocket FIRST (per Binance docs) ──
    const wsSymbol = symbol.toLowerCase() + '@depth@100ms'
    const url = `${WS_BASE}/${wsSymbol}`
    devLog(`[gen=${myGen}] STEP 1: connecting strict diff stream: ${url}`)
    registryAdd(STREAM_NAME, symbol, myGen, url)

    const socket = new WebSocket(url)
    strictWs = socket

    // Buffer events immediately on message (before snapshot loads)
    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
      try {
        const msg = JSON.parse(event.data as string)
        const diffEvent: DiffDepthEvent = {
          U: msg.U, u: msg.u, pu: msg.pu,
          b: msg.b ?? [], a: msg.a ?? [], T: msg.T,
        }
        book.lastMessageTime = Date.now()
        // Always buffer — snapshot not loaded yet
        if (!snapshotLoaded && pendingEvents.length < MAX_BUFFER_EVENTS) {
          pendingEvents.push(diffEvent)
        }
      } catch { /* ignore parse errors */ }
    }

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      devLog(`[gen=${myGen}] strict diff stream connected, buffered so far: ${pendingEvents.length}`)
      setHealth('BUFFERING', 'Buffering diff events…')
    }

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) return
      devLog(`[gen=${myGen}] strict diff stream closed: code=${ev.code}`)
      strictWs = null
      if (strictHealthy) {
        strictHealthy = false
        setHealth('STALE', 'Strict stream disconnected')
        setSource('depth20')
      }
    }

    socket.onerror = () => {
      if (disposed || generation !== myGen) return
      socket.close()
    }

    // ── STEP 2: Fetch REST snapshot (stream is already buffering) ──
    setHealth('SNAPSHOT_LOADING', 'Loading depth snapshot…')

    debugBookEmit({
      type: 'strict_sync_start',
      symbol,
      generation: myGen,
      phase: 'websocket_first',
      wsUrl: url,
      snapshotUrl: `${REST_SNAPSHOT_URL}?symbol=${symbol.toUpperCase()}&limit=${SNAPSHOT_LIMIT}`,
    })

    if (snapshotAbort) snapshotAbort.abort()
    const ac = new AbortController()
    snapshotAbort = ac

    const snapshotTimeout = setTimeout(() => {
      if (!ac.signal.aborted) ac.abort()
    }, SNAPSHOT_REQUEST_TIMEOUT_MS)

    let snapshot: DepthSnapshot
    try {
      const t0 = Date.now()
      snapshot = await fetchDepthSnapshot(symbol, ac.signal)
      clearTimeout(snapshotTimeout)
      if (disposed || myGen !== generation || ac.signal.aborted) return

      debugBookEmit({
        type: 'snapshot_loaded',
        symbol,
        generation: myGen,
        lastUpdateId: snapshot.lastUpdateId,
        durationMs: Date.now() - t0,
        bufferedEventsCount: pendingEvents.length,
      })
    } catch (err) {
      clearTimeout(snapshotTimeout)
      if (disposed || myGen !== generation) return
      const msg = err instanceof Error ? err.message : 'Snapshot fetch failed'
      devWarn(`[gen=${myGen}] snapshot error: ${msg}`)
      recordSyncFailure(msg)
      return
    }

    // ── STEP 3: Apply snapshot, then process buffered events ──
    applySnapshot(snapshot)
    if (disposed || myGen !== generation) return

    // Re-wire onmessage to the full handler (now that snapshot is loaded)
    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
      try {
        const msg = JSON.parse(event.data as string)
        const diffEvent: DiffDepthEvent = {
          U: msg.U, u: msg.u, pu: msg.pu,
          b: msg.b ?? [], a: msg.a ?? [], T: msg.T,
        }
        handleDiffEvent(diffEvent, myGen)
      } catch (err) {
        devWarn('strict parse error:', err)
      }
    }

    // Process buffered events — find overlap
    const ok = processBufferedEvents(myGen)
    if (ok) {
      // HEALTHY — wired up live handler, done
      startTimeoutChecker()
      return
    }

    if (disposed || myGen !== generation) return

    // Not yet HEALTHY — check if we need to resync (buffer overshot)
    // processBufferedEvents already set health to SYNCING if events exist
    // or SYNCING if no valid overlap yet
    devLog(`[gen=${myGen}] STEP 3 result: not healthy yet, waiting for live overlap`)

    // Wire up close handler for reconnect
    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) return
      devLog(`[gen=${myGen}] strict diff stream closed: code=${ev.code}`)
      strictWs = null
      if (strictHealthy) {
        strictHealthy = false
        setHealth('STALE', 'Strict stream disconnected')
        setSource('depth20')
      }
      const delay = getBackoffDelay(book.reconnectAttempts)
      book.reconnectAttempts++
      scheduleReconnect(() => {
        if (!disposed && generation === myGen) {
          if (isDegraded) enterDegraded()
          else triggerStrictResync('strict stream closed during sync')
        }
      }, delay)
    }

    startTimeoutChecker()
  }

  // ═══════════════════════════════════════════
  // STRICT RESYNC (background, preserves display)
  // ═══════════════════════════════════════════

  function triggerStrictResync(reason: string) {
    if (disposed) return

    const now = Date.now()
    const timeSinceLastResync = now - lastResyncTime
    if (timeSinceLastResync < RESYNC_COOLDOWN_MS && lastResyncTime > 0) {
      const waitMs = RESYNC_COOLDOWN_MS - timeSinceLastResync
      devLog(`resync rate-limited: "${reason}" — waiting ${Math.round(waitMs)}ms`)
      scheduleReconnect(() => triggerStrictResync(reason), waitMs)
      return
    }

    debugBookEmit({
      type: 'strict_resync',
      symbol,
      previousState: book.health,
      reason,
      displayBookSource: book.source,
    })

    devLog(`triggering strict resync: ${reason}`)
    lastResyncTime = now

    cancelReconnectTimer()
    stopTimeoutChecker()

    if (snapshotAbort) {
      snapshotAbort.abort()
      snapshotAbort = null
    }

    closeStrictSocket()

    // Don't clear display book — depth20 data stays
    // Only clear strict sync state
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []
    strictHealthy = false

    // Health: RESYNCING (strict), source stays depth20
    setHealth('RESYNCING', reason)

    // Reconnect depth20 if it dropped
    if (!depth20Connected && !depth20Ws) {
      connectDepth20()
    }

    connectStrictStreamThenSnapshot()
  }

  // ═══════════════════════════════════════════
  // TIMEOUT CHECKER
  // ═══════════════════════════════════════════

  function startTimeoutChecker() {
    stopTimeoutChecker()
    timeoutChecker = setInterval(() => {
      if (disposed) return
      const now = Date.now()
      const h = book.health

      // SNAPSHOT_LOADING timeout is now covered by the overall STRICT_SYNC_ATTEMPT_MAX_MS check below

      if (h === 'SYNCING' && syncingStartTime > 0) {
        const elapsed = now - syncingStartTime
        if (elapsed > SYNCING_MAX_MS) {
          devWarn(`SYNCING timeout after ${elapsed}ms`)
          recordSyncFailure(`Overlap wait timeout (${Math.round(elapsed)}ms)`)
        }
      }

      if ((h === 'SNAPSHOT_LOADING' || h === 'SYNCING' || h === 'BUFFERING') && syncStartTime > 0) {
        const elapsed = now - syncStartTime
        if (elapsed > STRICT_SYNC_ATTEMPT_MAX_MS) {
          devWarn(`Strict sync attempt timeout after ${elapsed}ms`)
          recordSyncFailure(`Strict sync timeout (${Math.round(elapsed)}ms)`)
        }
      }
    }, 2_000)
  }

  function stopTimeoutChecker() {
    if (timeoutChecker) { clearInterval(timeoutChecker); timeoutChecker = null }
  }

  // ═══════════════════════════════════════════
  // RECONNECT / TIMERS
  // ═══════════════════════════════════════════

  function cancelReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect(fn: () => void, delay: number) {
    cancelReconnectTimer()
    devLog(`scheduling reconnect in ${Math.round(delay)}ms (attempts=${book.reconnectAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!disposed) fn()
    }, delay)
  }

  function startStaleMonitor() {
    stopStaleMonitor()
    staleTimer = setInterval(() => {
      if (disposed) return
      const now = Date.now()
      if (now - createdAt < INITIAL_GRACE_PERIOD_MS) return

      const h = book.health
      if (h === 'CONNECTING' || h === 'BUFFERING' || h === 'SNAPSHOT_LOADING' ||
          h === 'SYNCING' || h === 'RESYNCING' || h === 'DISCONNECTED' || h === 'ERROR') {
        return
      }

      // Check if either stream has timed out
      if (book.lastMessageTime <= 0) return

      const elapsed = now - book.lastMessageTime
      if (elapsed > STALE_THRESHOLD_MS) {
        const hasSocket = (strictWs && strictWs.readyState === WebSocket.OPEN) ||
                          (depth20Ws && depth20Ws.readyState === WebSocket.OPEN)
        if (hasSocket) {
          devWarn(`stale detected: no updates for ${Math.round(elapsed / 1000)}s`)
          callbacks.onStale(`No updates for ${Math.round(elapsed / 1000)}s`)
          setHealth('STALE', 'No depth updates — book stale')
        }
      }
    }, STALE_CHECK_INTERVAL_MS)
  }

  function stopStaleMonitor() {
    if (staleTimer) { clearInterval(staleTimer); staleTimer = null }
  }

  function startRecoveryTimer() {
    stopRecoveryTimer()
    recoveryTimer = setInterval(() => {
      if (disposed || !isDegraded) return
      degradedRecoveryAttempt++
      devLog(`degraded recovery attempt #${degradedRecoveryAttempt}`)
      exitDegraded()
    }, DEGRADED_RECOVERY_INTERVAL_MS)
  }

  function stopRecoveryTimer() {
    if (recoveryTimer) { clearInterval(recoveryTimer); recoveryTimer = null }
  }

  // ═══════════════════════════════════════════
  // START — CONNECT BOTH STREAMS
  // ═══════════════════════════════════════════

  createdAt = Date.now()
  setHealth('CONNECTING')
  setSource('none')
  startStaleMonitor()

  // 1. Connect depth20 IMMEDIATELY — provides display book within ~200ms
  connectDepth20()

  // 2. Start strict sync IN PARALLEL — will promote to HEALTHY when validated
  connectStrictStreamThenSnapshot()

  // ═══════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════

  function dispose() {
    disposed = true
    registryRemove(STREAM_NAME, symbol, generation)
    registryRemove(FALLBACK_STREAM_NAME, symbol, generation)
    generation++
    cancelReconnectTimer()
    stopStaleMonitor()
    stopRecoveryTimer()
    stopTimeoutChecker()
    if (snapshotAbort) { snapshotAbort.abort(); snapshotAbort = null }
    closeStrictSocket()
    closeDepth20()
  }

  function manualResync() {
    if (!disposed) {
      debugBookEmit({
        type: 'manual_resync',
        symbol,
        previousState: book.health,
        reason: 'User clicked Resync Book',
        displayBookSource: book.source,
      })
      // Manual resync restarts strict sync but doesn't destroy display book
      triggerStrictResync('manual resync requested')
    }
  }

  return { resync: manualResync, dispose }
}
