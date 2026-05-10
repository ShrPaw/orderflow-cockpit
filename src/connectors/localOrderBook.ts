/**
 * localOrderBook.ts
 *
 * Binance Futures local order book engine — strict diff-depth sync
 * with degraded depth20 fallback.
 *
 * STRICT SYNC METHODOLOGY (Binance official):
 * 1. Open diff depth stream → buffer events
 * 2. Fetch REST depth snapshot
 * 3. Let L = snapshot.lastUpdateId
 * 4. Drop buffered events where event.u < L
 * 5. Find first event: event.U <= L+1 && event.u >= L+1
 * 6. Apply that event — book is now SYNCING → HEALTHY
 * 7. For every following event: event.pu must equal previous event.u
 * 8. If pu mismatch → reject event, preserve good book, controlled resync
 *
 * DEGRADED FALLBACK:
 * If strict sync fails repeatedly, fall back to depth20 partial stream.
 * Each depth20 update is an authoritative top-20 snapshot.
 *
 * Stream: symbol@depth@100ms (diff-depth, strict)
 * Fallback: symbol@depth20@100ms (partial, degraded)
 * REST:   GET /fapi/v1/depth?symbol=SYMBOL&limit=1000
 */

import type {
  OrderLevel, OrderBookHealth, DiffDepthEvent, DepthSnapshot,
} from '../types/market'
import { registryAdd, registryRemove } from './connectionRegistry'

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export interface LocalBookCallbacks {
  onSnapshot: (bids: OrderLevel[], asks: OrderLevel[], lastUpdateId: number) => void
  onDiffApplied: (bids: OrderLevel[], asks: OrderLevel[], lastUpdateId: number, transactionTime: number) => void
  onHealthChange: (health: OrderBookHealth, error?: string | null) => void
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

const STALE_THRESHOLD_MS = 20_000          // ≥20s per spec
const STALE_CHECK_INTERVAL_MS = 5_000
const INITIAL_GRACE_PERIOD_MS = 30_000     // 30s grace per spec

// Rate-limit resync: at most once per this interval
const RESYNC_COOLDOWN_MS = 5_000

// Degraded fallback: enter after this many failed strict syncs within window
const DEGRADED_SYNC_FAILURES = 3
const DEGRADED_SYNC_WINDOW_MS = 60_000

// Periodic recovery attempt from DEGRADED → HEALTHY
const DEGRADED_RECOVERY_INTERVAL_MS = 30_000

// ─── Timeout constants to prevent stuck states ───
const SNAPSHOT_REQUEST_TIMEOUT_MS = 10_000     // max time for REST snapshot fetch
const SNAPSHOT_LOADING_MAX_MS = 20_000         // max time in SNAPSHOT_LOADING state
const SYNCING_MAX_MS = 15_000                  // max time waiting for overlap in SYNCING
const STRICT_SYNC_ATTEMPT_MAX_MS = 40_000     // max total time for one strict sync attempt
const MAX_STRICT_FAILURES_BEFORE_DEGRADED = 3 // consecutive failures before DEGRADED

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
// LOCAL ORDER BOOK ENGINE
// ═══════════════════════════════════════════

const STREAM_NAME = 'depth'
const FALLBACK_STREAM_NAME = 'depth20'

export interface LocalOrderBookHandle {
  /** Manually trigger a resync (e.g. from UI button) */
  resync: () => void
  /** Cleanup — call on unmount or symbol switch */
  dispose: () => void
}

export function createLocalOrderBook(
  symbol: string,
  callbacks: LocalBookCallbacks,
): LocalOrderBookHandle {
  const book: BookState = {
    bids: new Map(),
    asks: new Map(),
    lastUpdateId: 0,
    lastEventUpdateId: 0,
    lastTransactionTime: 0,
    lastMessageTime: 0,
    health: 'DISCONNECTED',
    error: null,
    reconnectAttempts: 0,
  }

  let ws: WebSocket | null = null
  let fallbackWs: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let recoveryTimer: ReturnType<typeof setInterval> | null = null
  let snapshotLoaded = false
  let pendingEvents: DiffDepthEvent[] = []
  let firstEventValidated = false
  let lastPu: number | null = null
  let lastAppliedUpdateId = 0
  let createdAt = Date.now()
  let lastResyncTime = 0

  // ─── Generation token: ignores events from stale sockets ───
  let generation = 0

  // ─── Snapshot AbortController ───
  let snapshotAbort: AbortController | null = null

  // ─── Degraded fallback tracking ───
  let syncFailureTimes: number[] = []
  let isDegraded = false
  let degradedRecoveryAttempt = 0
  let consecutiveStrictFailures = 0

  // ─── Timeout tracking ───
  let syncStartTime = 0
  let snapshotLoadStartTime = 0
  let syncingStartTime = 0
  let timeoutChecker: ReturnType<typeof setInterval> | null = null

  // ─── Dev logging ───
  const LOG_TAG = `[LocalBook:${symbol}]`
  function devLog(...args: unknown[]) {
    if (import.meta.env?.DEV) {
      console.log(LOG_TAG, `gen=${generation}`, ...args)
    }
  }
  function devWarn(...args: unknown[]) {
    if (import.meta.env?.DEV) {
      console.warn(LOG_TAG, `gen=${generation}`, ...args)
    }
  }

  // ─── Health management ───
  function setHealth(h: OrderBookHealth, err: string | null = null) {
    const prev = book.health
    if (prev === h && book.error === err) return // no-op if unchanged
    book.health = h
    book.error = err
    devLog(`health: ${prev} → ${h}`, err ?? '')
    callbacks.onHealthChange(h, err)
  }

  // ─── Cancel any pending reconnect timer ───
  function cancelReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  // ─── Schedule a reconnect with the given delay ───
  function scheduleReconnect(fn: () => void, delay: number) {
    cancelReconnectTimer()
    devLog(`scheduling reconnect in ${Math.round(delay)}ms (attempts=${book.reconnectAttempts})`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!disposed) fn()
    }, delay)
  }

  // ─── Emit current book state ───
  function emitBook() {
    const bids = sortedBids(book.bids)
    const asks = sortedAsks(book.asks)
    callbacks.onDiffApplied(bids, asks, book.lastEventUpdateId, book.lastTransactionTime)
  }

  // ─── Apply diff to local book (does NOT change health) ───
  function applyDiff(event: DiffDepthEvent) {
    for (const [priceStr, qtyStr] of event.b) {
      const qty = parseFloat(qtyStr)
      if (qty === 0) {
        book.bids.delete(priceStr)
      } else {
        book.bids.set(priceStr, qty)
      }
    }
    for (const [priceStr, qtyStr] of event.a) {
      const qty = parseFloat(qtyStr)
      if (qty === 0) {
        book.asks.delete(priceStr)
      } else {
        book.asks.set(priceStr, qty)
      }
    }
    book.lastEventUpdateId = event.u
    lastAppliedUpdateId = event.u
    book.lastTransactionTime = event.T ?? Date.now()
    book.lastMessageTime = Date.now()
  }

  // ─── Apply snapshot to local book ───
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

  // ─── Process buffered events after snapshot ───
  function processBufferedEvents(gen: number): boolean {
    if (!snapshotLoaded) return false
    if (gen !== generation) return false

    // Discard events with u < lastUpdateId (stale)
    const valid = pendingEvents.filter(e => e.u >= book.lastUpdateId)
    pendingEvents = []

    if (valid.length === 0) {
      // NO VALID OVERLAPPING EVENT — cannot mark HEALTHY
      // Must wait for live stream to provide the first valid event
      devLog(`processBufferedEvents: no buffered events after snapshot (lastUpdateId=${book.lastUpdateId}), waiting for live overlap`)
      debugBookEmit({
        type: 'first_overlap_result',
        symbol,
        generation: gen,
        snapshotLastUpdateId: book.lastUpdateId,
        bufferedEventsCount: 0,
        foundOverlap: false,
      })
      setHealth('SYNCING', 'Waiting for overlapping diff event…')
      syncingStartTime = Date.now()
      return false
    }

    // Sort by update ID
    valid.sort((a, b) => a.U - b.U)

    // Find first applicable event: U <= lastUpdateId+1 && u >= lastUpdateId+1
    // (Binance official: U <= lastUpdateId+1 && u >= lastUpdateId+1)
    const L = book.lastUpdateId
    let startIdx = -1
    for (let i = 0; i < valid.length; i++) {
      const e = valid[i]
      if (e.U <= L + 1 && e.u >= L + 1) {
        startIdx = i
        break
      }
    }

    if (startIdx === -1) {
      debugBookEmit({
        type: 'first_overlap_result',
        symbol,
        generation: gen,
        snapshotLastUpdateId: L,
        bufferedEventsCount: valid.length,
        foundOverlap: false,
        firstBufferedEvent: { U: valid[0].U, u: valid[0].u, pu: valid[0].pu, E: valid[0].T },
        lastBufferedEvent: { U: valid[valid.length - 1].U, u: valid[valid.length - 1].u, pu: valid[valid.length - 1].pu, E: valid[valid.length - 1].T },
      })
      devWarn(`processBufferedEvents: no valid first event (need U<=${L + 1}&&u>=${L + 1}), resyncing`)
      return false
    }

    const firstEvent = valid[startIdx]
    devLog(`first valid event: U=${firstEvent.U} u=${firstEvent.u} (snapshot L=${L})`)

    debugBookEmit({
      type: 'first_overlap_result',
      symbol,
      generation: gen,
      snapshotLastUpdateId: L,
      bufferedEventsCount: valid.length,
      foundOverlap: true,
      firstValidEvent: { U: firstEvent.U, u: firstEvent.u, pu: firstEvent.pu, E: firstEvent.T },
      firstBufferedEvent: { U: valid[0].U, u: valid[0].u, pu: valid[0].pu, E: valid[0].T },
      lastBufferedEvent: { U: valid[valid.length - 1].U, u: valid[valid.length - 1].u, pu: valid[valid.length - 1].pu, E: valid[valid.length - 1].T },
    })

    // Apply from startIdx onward
    for (let i = startIdx; i < valid.length; i++) {
      const event = valid[i]

      // Validate continuity via pu
      if (i > startIdx && event.pu !== undefined) {
        const prevEvent = valid[i - 1]
        if (event.pu !== prevEvent.u) {
          debugBookEmit({
            type: 'sequence_gap',
            symbol,
            generation: gen,
            previousAppliedUpdateId: prevEvent.u,
            event: { U: event.U, u: event.u, pu: event.pu, E: event.T },
            action: 'resync',
          })
          devWarn(`sequence gap in buffered events: pu=${event.pu} !== prev.u=${prevEvent.u}`)
          return false
        }
      }

      applyDiff(event)
      lastPu = event.pu ?? null
    }

    firstEventValidated = true
    book.reconnectAttempts = 0
    syncFailureTimes = []
    consecutiveStrictFailures = 0
    isDegraded = false
    setHealth('HEALTHY')
    emitBook()
    return true
  }

  // ─── Handle incoming diff event (strict mode) ───
  function handleDiffEvent(event: DiffDepthEvent, gen: number) {
    if (gen !== generation) return
    book.lastMessageTime = Date.now()

    if (!snapshotLoaded) {
      // Buffer until snapshot arrives
      if (pendingEvents.length < MAX_BUFFER_EVENTS) {
        pendingEvents.push(event)
      }
      return
    }

    // Discard stale events (u < lastUpdateId)
    if (event.u <= book.lastUpdateId) {
      return
    }

    // First event validation (strict Binance methodology)
    if (!firstEventValidated) {
      const L = book.lastUpdateId
      if (event.U <= L + 1 && event.u >= L + 1) {
        // Valid first event!
        firstEventValidated = true
        lastPu = event.pu ?? null
        applyDiff(event)
        book.reconnectAttempts = 0
        syncFailureTimes = []
        consecutiveStrictFailures = 0
        isDegraded = false
        setHealth('HEALTHY')
        emitBook()
        devLog(`first live event validated: U=${event.U} u=${event.u} L=${L}`)
        debugBookEmit({
          type: 'first_overlap_result',
          symbol,
          generation: gen,
          snapshotLastUpdateId: L,
          bufferedEventsCount: 0,
          foundOverlap: true,
          firstValidEvent: { U: event.U, u: event.u, pu: event.pu, E: event.T },
        })
        return
      } else if (event.U > L + 1) {
        // Gap — we missed the overlapping event
        debugBookEmit({
          type: 'sequence_gap',
          symbol,
          generation: gen,
          previousAppliedUpdateId: L,
          event: { U: event.U, u: event.u, pu: event.pu, E: event.T },
          action: 'degrade',
        })
        devWarn(`first event gap: U=${event.U} > L+1=${L + 1}`)
        recordSyncFailure('first event gap: missing overlapping event')
        return
      }
      // Otherwise discard (event.u < lastUpdateId — stale, already filtered above)
      return
    }

    // Validate continuity via pu
    if (event.pu !== undefined) {
      if (event.pu !== lastAppliedUpdateId) {
        debugBookEmit({
          type: 'sequence_gap',
          symbol,
          generation: gen,
          previousAppliedUpdateId: lastAppliedUpdateId,
          event: { U: event.U, u: event.u, pu: event.pu, E: event.T },
          action: 'reject',
        })
        devWarn(`pu mismatch: event.pu=${event.pu} !== lastApplied=${lastAppliedUpdateId} (event.U=${event.U} u=${event.u})`)
        // REJECT: do NOT apply to healthy book
        recordSyncFailure(`pu mismatch: ${event.pu} !== ${lastAppliedUpdateId}`)
        return
      }
    }

    applyDiff(event)
    lastPu = event.pu ?? null
    emitBook()
  }

  // ─── Handle depth20 partial update (degraded mode) ───
  let lastFallbackLogTime = 0
  function handleDepth20Update(msg: any, gen: number) {
    if (gen !== generation) return
    book.lastMessageTime = Date.now()

    // depth20 is a partial snapshot: [price, qty] arrays
    const bids: [string, string][] = msg.bids ?? msg.b ?? []
    const asks: [string, string][] = msg.asks ?? msg.a ?? []

    book.bids.clear()
    book.asks.clear()
    for (const [priceStr, qtyStr] of bids) {
      const qty = parseFloat(qtyStr as string)
      if (qty > 0) book.bids.set(priceStr, qty)
    }
    for (const [priceStr, qtyStr] of asks) {
      const qty = parseFloat(qtyStr as string)
      if (qty > 0) book.asks.set(priceStr, qty)
    }
    book.lastUpdateId = 0 // partial — no diff tracking
    book.lastEventUpdateId = 0
    book.lastTransactionTime = Date.now()

    // Debug: sample at most once every 5 seconds
    const now = Date.now()
    if (isDebugBook() && now - lastFallbackLogTime > 5_000) {
      lastFallbackLogTime = now
      const bestBid = bids.length > 0 ? bids[0][0] : 'N/A'
      const bestAsk = asks.length > 0 ? asks[0][0] : 'N/A'
      debugBookEmit({
        type: 'fallback_update',
        symbol,
        bidsCount: bids.length,
        asksCount: asks.length,
        bestBid,
        bestAsk,
        lastMessageAgeMs: 0,
      })
    }

    emitBook()
  }

  // ─── Record sync failure and possibly enter degraded ───
  function recordSyncFailure(reason: string) {
    const now = Date.now()
    syncFailureTimes.push(now)
    consecutiveStrictFailures++
    // Keep only failures within the window
    syncFailureTimes = syncFailureTimes.filter(t => now - t < DEGRADED_SYNC_WINDOW_MS)

    devWarn(`sync failure (${syncFailureTimes.length}/${DEGRADED_SYNC_FAILURES}, consecutive=${consecutiveStrictFailures}): ${reason}`)

    if (syncFailureTimes.length >= DEGRADED_SYNC_FAILURES || consecutiveStrictFailures >= MAX_STRICT_FAILURES_BEFORE_DEGRADED) {
      enterDegraded()
    } else {
      triggerResync(reason)
    }
  }

  // ─── Enter degraded fallback mode ───
  function enterDegraded() {
    if (isDegraded) return
    isDegraded = true
    degradedRecoveryAttempt = 0
    devLog('entering DEGRADED mode — switching to depth20 fallback')

    debugBookEmit({
      type: 'fallback_start',
      symbol,
      generation,
      streamUrl: `${symbol.toLowerCase()}@depth20@100ms`,
      reason: `Strict sync failed ${consecutiveStrictFailures} times consecutively`,
    })

    // Close strict diff socket
    closeSocket()

    // Abort any in-flight snapshot
    if (snapshotAbort) {
      snapshotAbort.abort()
      snapshotAbort = null
    }

    // Clear strict sync state
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []
    stopTimeoutChecker()

    // DO NOT clear book — preserve last known good
    setHealth('DEGRADED', 'Strict sync failed — using depth20 fallback')

    // Connect depth20 fallback
    connectFallbackStream()

    // Start periodic recovery attempts
    startRecoveryTimer()
  }

  // ─── Exit degraded mode back to strict ───
  function exitDegraded() {
    if (!isDegraded) return
    isDegraded = false
    degradedRecoveryAttempt = 0
    devLog('exiting DEGRADED mode — attempting strict sync')
    stopRecoveryTimer()
    closeFallbackStream()
    // Full resync with strict methodology
    book.bids.clear()
    book.asks.clear()
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []
    connectStreamThenSnapshot()
  }

  // ─── Close the current WebSocket if open ───
  function closeSocket() {
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try { ws.close() } catch { /* ignore */ }
      ws = null
    }
  }

  // ─── Close fallback socket ───
  function closeFallbackStream() {
    if (fallbackWs) {
      fallbackWs.onopen = null
      fallbackWs.onmessage = null
      fallbackWs.onerror = null
      fallbackWs.onclose = null
      try { fallbackWs.close() } catch { /* ignore */ }
      fallbackWs = null
    }
  }

  // ─── Timeout checker — prevents stuck SNAPSHOT_LOADING / SYNCING ───
  function startTimeoutChecker() {
    stopTimeoutChecker()
    timeoutChecker = setInterval(() => {
      if (disposed) return
      const now = Date.now()
      const h = book.health

      // SNAPSHOT_LOADING timeout
      if (h === 'SNAPSHOT_LOADING' && snapshotLoadStartTime > 0) {
        const elapsed = now - snapshotLoadStartTime
        if (elapsed > SNAPSHOT_LOADING_MAX_MS) {
          devWarn(`SNAPSHOT_LOADING timeout after ${elapsed}ms`)
          if (snapshotAbort) {
            snapshotAbort.abort()
            snapshotAbort = null
          }
          recordSyncFailure(`Snapshot loading timeout (${Math.round(elapsed)}ms)`)
        }
      }

      // SYNCING timeout (waiting for overlap)
      if (h === 'SYNCING' && syncingStartTime > 0) {
        const elapsed = now - syncingStartTime
        if (elapsed > SYNCING_MAX_MS) {
          devWarn(`SYNCING timeout after ${elapsed}ms — no overlapping event found`)
          recordSyncFailure(`Overlap wait timeout (${Math.round(elapsed)}ms)`)
        }
      }

      // Total strict sync attempt timeout
      if ((h === 'SNAPSHOT_LOADING' || h === 'SYNCING' || h === 'BUFFERING') && syncStartTime > 0) {
        const elapsed = now - syncStartTime
        if (elapsed > STRICT_SYNC_ATTEMPT_MAX_MS) {
          devWarn(`Strict sync attempt timeout after ${elapsed}ms`)
          recordSyncFailure(`Strict sync timeout (${Math.round(elapsed)}ms)`)
        }
      }
    }, 2_000) // check every 2 seconds
  }

  function stopTimeoutChecker() {
    if (timeoutChecker) {
      clearInterval(timeoutChecker)
      timeoutChecker = null
    }
  }

  // ─── Fetch snapshot and initialize ───
  async function loadSnapshot(gen: number) {
    snapshotLoadStartTime = Date.now()
    setHealth('SNAPSHOT_LOADING')

    debugBookEmit({
      type: 'strict_sync_start',
      symbol,
      generation: gen,
      streamUrl: `${symbol.toLowerCase()}@depth@100ms`,
      snapshotUrl: `${REST_SNAPSHOT_URL}?symbol=${symbol.toUpperCase()}&limit=${SNAPSHOT_LIMIT}`,
    })

    // Abort controller for this snapshot
    if (snapshotAbort) snapshotAbort.abort()
    const ac = new AbortController()
    snapshotAbort = ac

    // Snapshot request timeout
    const snapshotTimeout = setTimeout(() => {
      if (!ac.signal.aborted) {
        ac.abort()
      }
    }, SNAPSHOT_REQUEST_TIMEOUT_MS)

    try {
      const snapshotStart = Date.now()
      const snapshot = await fetchDepthSnapshot(symbol, ac.signal)
      clearTimeout(snapshotTimeout)
      if (disposed || gen !== generation || ac.signal.aborted) return

      const durationMs = Date.now() - snapshotStart
      const bufferedCount = pendingEvents.length

      debugBookEmit({
        type: 'snapshot_success',
        symbol,
        generation: gen,
        lastUpdateId: snapshot.lastUpdateId,
        bidsCount: snapshot.bids.length,
        asksCount: snapshot.asks.length,
        durationMs,
        bufferedEventsCount: bufferedCount,
      })

      applySnapshot(snapshot)
      const ok = processBufferedEvents(gen)
      if (!ok && gen === generation && !disposed) {
        // No valid overlapping event — keep buffering from live stream
        // Health is already set to SYNCING by processBufferedEvents
        devLog('snapshot loaded but no overlapping event yet, waiting for live stream')
      }
    } catch (err) {
      clearTimeout(snapshotTimeout)
      if (disposed || gen !== generation) return
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Could be our timeout or user abort
        if (!disposed && gen === generation) {
          devWarn('snapshot request aborted (timeout or generation change)')
          recordSyncFailure('Snapshot request aborted')
        }
        return
      }
      const msg = err instanceof Error ? err.message : 'Snapshot fetch failed'
      devWarn(`snapshot error: ${msg}`)
      setHealth('ERROR', msg)
      const delay = getBackoffDelay(book.reconnectAttempts)
      book.reconnectAttempts++
      scheduleReconnect(() => {
        if (!disposed && gen === generation) {
          if (isDegraded) {
            enterDegraded()
          } else {
            loadSnapshot(gen)
          }
        }
      }, delay)
    }
  }

  // ─── Connect diff stream, THEN load snapshot (stream buffers during fetch) ───
  function connectStreamThenSnapshot() {
    if (disposed) return

    cancelReconnectTimer()
    closeSocket()

    const myGen = ++generation
    syncStartTime = Date.now()

    // Open stream FIRST — it will buffer events while snapshot loads
    const wsSymbol = symbol.toLowerCase() + '@depth@100ms'
    const url = `${WS_BASE}/${wsSymbol}`
    devLog(`connecting diff stream: ${url}`)
    registryAdd(STREAM_NAME, symbol, myGen, url)

    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      devLog(`diff stream connected (readyState=${socket.readyState})`)
      if (!snapshotLoaded) {
        setHealth('BUFFERING', 'Buffering diff events while snapshot loads…')
      }
    }

    socket.onmessage = (event) => {
      if (disposed || generation !== myGen) return
      try {
        const msg = JSON.parse(event.data as string)
        const diffEvent: DiffDepthEvent = {
          U: msg.U,
          u: msg.u,
          pu: msg.pu,
          b: msg.b ?? [],
          a: msg.a ?? [],
          T: msg.T,
        }
        handleDiffEvent(diffEvent, myGen)
      } catch (err) {
        devWarn('parse error:', err)
      }
    }

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) return
      devLog(`diff stream closed: code=${ev.code} wasClean=${ev.wasClean}`)
      ws = null

      if (book.health === 'HEALTHY' || book.health === 'DEGRADED') {
        debugBookEmit({
          type: 'book_stale',
          symbol,
          previousState: book.health,
          lastMessageAgeMs: Date.now() - book.lastMessageTime,
          socketReadyState: socket.readyState,
        })
        setHealth('STALE', 'Diff stream disconnected')
      }

      const delay = getBackoffDelay(book.reconnectAttempts)
      book.reconnectAttempts++
      scheduleReconnect(() => {
        if (!disposed && generation === myGen) {
          if (isDegraded) {
            enterDegraded()
          } else if (snapshotLoaded && firstEventValidated) {
            connectStreamThenSnapshot()
          } else {
            triggerResync('reconnect after disconnect — book not healthy')
          }
        }
      }, delay)
    }

    socket.onerror = (ev) => {
      if (disposed || generation !== myGen) return
      devWarn('diff stream error:', ev)
      socket.close()
    }

    // Now fetch snapshot — stream is already buffering
    loadSnapshot(myGen)
    startTimeoutChecker()
  }

  // ─── Connect depth20 fallback stream ───
  function connectFallbackStream() {
    if (disposed) return

    closeFallbackStream()

    const myGen = generation // share generation with strict mode
    const wsSymbol = symbol.toLowerCase() + '@depth20@100ms'
    const url = `${WS_BASE}/${wsSymbol}`
    devLog(`connecting depth20 fallback: ${url}`)
    registryAdd(FALLBACK_STREAM_NAME, symbol, myGen, url)

    const socket = new WebSocket(url)
    fallbackWs = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      devLog('depth20 fallback connected')
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
      devLog(`depth20 fallback closed: code=${ev.code}`)
      fallbackWs = null
      // Reconnect fallback if still in degraded mode
      if (isDegraded && !disposed) {
        const delay = getBackoffDelay(book.reconnectAttempts)
        book.reconnectAttempts++
        scheduleReconnect(() => {
          if (!disposed && generation === myGen && isDegraded) {
            connectFallbackStream()
          }
        }, delay)
      }
    }

    socket.onerror = () => {
      if (disposed || generation !== myGen) return
      socket.close()
    }
  }

  // ─── Full resync (rate-limited) ───
  function triggerResync(reason: string) {
    if (disposed) return

    const now = Date.now()
    const timeSinceLastResync = now - lastResyncTime
    if (timeSinceLastResync < RESYNC_COOLDOWN_MS && lastResyncTime > 0) {
      const waitMs = RESYNC_COOLDOWN_MS - timeSinceLastResync
      devLog(`resync rate-limited: "${reason}" — waiting ${Math.round(waitMs)}ms`)
      scheduleReconnect(() => triggerResync(reason), waitMs)
      return
    }

    debugBookEmit({
      type: 'manual_resync',
      symbol,
      previousState: book.health,
      reason,
    })

    devLog(`triggering resync: ${reason}`)
    lastResyncTime = now

    cancelReconnectTimer()
    stopTimeoutChecker()

    // Abort old snapshot
    if (snapshotAbort) {
      snapshotAbort.abort()
      snapshotAbort = null
    }

    // Close old socket with detached handlers
    closeSocket()

    // Bump generation so stale events are ignored
    generation++

    // Clear strict sync state but preserve book
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []

    // DO NOT clear book.bids/book.asks — preserve last known good
    setHealth('RESYNCING', reason)

    // Stream-first: connect stream (buffers), then fetch snapshot
    connectStreamThenSnapshot()
  }

  // ─── Stale monitor ───
  function startStaleMonitor() {
    stopStaleMonitor()
    staleTimer = setInterval(() => {
      if (disposed) return
      const now = Date.now()

      // Grace period during initial connection
      if (now - createdAt < INITIAL_GRACE_PERIOD_MS) return

      // Don't mark stale during sync/resync states
      const h = book.health
      if (h === 'CONNECTING' || h === 'BUFFERING' || h === 'SNAPSHOT_LOADING' ||
          h === 'SYNCING' || h === 'RESYNCING' || h === 'DISCONNECTED' || h === 'ERROR') {
        return
      }

      // Only mark stale from HEALTHY or DEGRADED
      if (h !== 'HEALTHY' && h !== 'DEGRADED') return

      if (book.lastMessageTime <= 0) return

      const elapsed = now - book.lastMessageTime
      if (elapsed > STALE_THRESHOLD_MS) {
        // Verify socket is actually open
        const activeSocket = isDegraded ? fallbackWs : ws
        if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
          const reason = `No updates for ${Math.round(elapsed / 1000)}s (socket open)`
          devWarn(`stale detected: ${reason}`)
          debugBookEmit({
            type: 'book_stale',
            symbol,
            previousState: h,
            lastMessageAgeMs: elapsed,
            socketReadyState: activeSocket.readyState,
          })
          callbacks.onStale(reason)
          setHealth('STALE', 'No depth updates — book stale')
        } else if (!activeSocket) {
          devLog('stale check: no socket (reconnect in progress)')
        }
      }
    }, STALE_CHECK_INTERVAL_MS)
  }

  function stopStaleMonitor() {
    if (staleTimer) {
      clearInterval(staleTimer)
      staleTimer = null
    }
  }

  // ─── Recovery timer (DEGRADED → HEALTHY) ───
  function startRecoveryTimer() {
    stopRecoveryTimer()
    recoveryTimer = setInterval(() => {
      if (disposed || !isDegraded) return
      degradedRecoveryAttempt++
      devLog(`degraded recovery attempt #${degradedRecoveryAttempt}`)
      // Attempt strict resync
      exitDegraded()
    }, DEGRADED_RECOVERY_INTERVAL_MS)
  }

  function stopRecoveryTimer() {
    if (recoveryTimer) {
      clearInterval(recoveryTimer)
      recoveryTimer = null
    }
  }

  // ═══════════════════════════════════════════
  // START
  // ═══════════════════════════════════════════

  createdAt = Date.now()
  setHealth('CONNECTING')
  startStaleMonitor()

  // Stream-first: connect diff stream (buffers events), then fetch snapshot
  connectStreamThenSnapshot()

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
    if (snapshotAbort) {
      snapshotAbort.abort()
      snapshotAbort = null
    }
    closeSocket()
    closeFallbackStream()
  }

  function manualResync() {
    if (!disposed) {
      debugBookEmit({
        type: 'manual_resync',
        symbol,
        previousState: book.health,
        reason: 'User clicked Resync Book',
      })
      triggerResync('manual resync requested')
    }
  }

  return { resync: manualResync, dispose }
}
