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

  function setHealth(h: OrderBookHealth, err: string | null = null) {
    const prev = book.health
    if (prev === h && book.error === err) return
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

    const bids: [string, string][] = msg.bids ?? msg.b ?? []
    const asks: [string, string][] = msg.asks ?? msg.a ?? []

    // If strict is HEALTHY, strict owns the book — don't overwrite
    if (strictHealthy && book.health === 'HEALTHY') return

    // depth20 is a full top-20 snapshot — replace book
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

    // depth20 has no diff tracking — use 0
    book.lastUpdateId = 0
    book.lastEventUpdateId = 0
    book.lastTransactionTime = Date.now()

    // If strict is not HEALTHY, depth20 IS the display book
    if (!strictHealthy || book.health !== 'HEALTHY') {
      setSource('depth20')

      // If we're in a transitional state (SNAPSHOT_LOADING, SYNCING, BUFFERING, CONNECTING)
      // and depth20 is providing data, promote to TOP20
      const transitionalStates = ['CONNECTING', 'BUFFERING', 'SNAPSHOT_LOADING', 'SYNCING']
      if (transitionalStates.includes(book.health) || book.health === 'DISCONNECTED') {
        setHealth('TOP20', 'Using top-20 fallback while strict sync loads')
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
        bidsCount: bids.length,
        asksCount: asks.length,
        bestBid: bids.length > 0 ? bids[0][0] : 'N/A',
        bestAsk: asks.length > 0 ? asks[0][0] : 'N/A',
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

  function processBufferedEvents(gen: number): boolean {
    if (!snapshotLoaded) return false
    if (gen !== generation) return false

    const valid = pendingEvents.filter(e => e.u >= book.lastUpdateId)
    pendingEvents = []

    if (valid.length === 0) {
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

    valid.sort((a, b) => a.U - b.U)

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

    for (let i = startIdx; i < valid.length; i++) {
      const event = valid[i]
      if (i > startIdx && event.pu !== undefined) {
        const prevEvent = valid[i - 1]
        if (event.pu !== prevEvent.u) {
          devWarn(`sequence gap in buffered events: pu=${event.pu} !== prev.u=${prevEvent.u}`)
          return false
        }
      }
      applyDiff(event)
      lastPu = event.pu ?? null
    }

    promoteToHealthy()
    return true
  }

  function handleDiffEvent(event: DiffDepthEvent, gen: number) {
    if (gen !== generation) return
    book.lastMessageTime = Date.now()

    if (!snapshotLoaded) {
      if (pendingEvents.length < MAX_BUFFER_EVENTS) {
        pendingEvents.push(event)
      }
      return
    }

    if (event.u <= book.lastUpdateId) return

    if (!firstEventValidated) {
      const L = book.lastUpdateId
      if (event.U <= L + 1 && event.u >= L + 1) {
        firstEventValidated = true
        lastPu = event.pu ?? null
        applyDiff(event)
        promoteToHealthy()
        devLog(`first live event validated: U=${event.U} u=${event.u} L=${L}`)
        return
      } else if (event.U > L + 1) {
        devWarn(`first event gap: U=${event.U} > L+1=${L + 1}`)
        recordSyncFailure('first event gap: missing overlapping event')
        return
      }
      return
    }

    if (event.pu !== undefined) {
      if (event.pu !== lastAppliedUpdateId) {
        devWarn(`pu mismatch: event.pu=${event.pu} !== lastApplied=${lastAppliedUpdateId}`)
        recordSyncFailure(`pu mismatch: ${event.pu} !== ${lastAppliedUpdateId}`)
        return
      }
    }

    applyDiff(event)
    lastPu = event.pu ?? null

    // Strict book is authoritative — emit and set source
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

  function connectStrictStreamThenSnapshot() {
    if (disposed) return

    cancelReconnectTimer()
    closeStrictSocket()

    const myGen = ++generation
    syncStartTime = Date.now()

    const wsSymbol = symbol.toLowerCase() + '@depth@100ms'
    const url = `${WS_BASE}/${wsSymbol}`
    devLog(`connecting strict diff stream: ${url}`)
    registryAdd(STREAM_NAME, symbol, myGen, url)

    const socket = new WebSocket(url)
    strictWs = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      devLog(`strict diff stream connected`)
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
        devWarn('strict parse error:', err)
      }
    }

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) return
      devLog(`strict diff stream closed: code=${ev.code} wasClean=${ev.wasClean}`)
      strictWs = null

      if (strictHealthy) {
        // Was healthy, now disconnected — fall back to depth20
        strictHealthy = false
        setHealth('STALE', 'Strict stream disconnected')
        setSource('depth20')
      }

      const delay = getBackoffDelay(book.reconnectAttempts)
      book.reconnectAttempts++
      scheduleReconnect(() => {
        if (!disposed && generation === myGen) {
          if (isDegraded) {
            enterDegraded()
          } else {
            triggerStrictResync('reconnect after strict disconnect')
          }
        }
      }, delay)
    }

    socket.onerror = (ev) => {
      if (disposed || generation !== myGen) return
      devWarn('strict diff stream error:', ev)
      socket.close()
    }

    // Fetch snapshot — stream is already buffering
    loadSnapshot(myGen)
    startTimeoutChecker()
  }

  // ═══════════════════════════════════════════
  // STRICT SNAPSHOT LOADING
  // ═══════════════════════════════════════════

  async function loadSnapshot(gen: number) {
    snapshotLoadStartTime = Date.now()
    setHealth('SNAPSHOT_LOADING', 'Loading depth snapshot — top-20 book active')

    debugBookEmit({
      type: 'strict_sync_start',
      symbol,
      generation: gen,
      streamUrl: `${symbol.toLowerCase()}@depth@100ms`,
      snapshotUrl: `${REST_SNAPSHOT_URL}?symbol=${symbol.toUpperCase()}&limit=${SNAPSHOT_LIMIT}`,
      displayBookSource: book.source,
    })

    if (snapshotAbort) snapshotAbort.abort()
    const ac = new AbortController()
    snapshotAbort = ac

    const snapshotTimeout = setTimeout(() => {
      if (!ac.signal.aborted) ac.abort()
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
        displayBookSource: book.source,
      })

      applySnapshot(snapshot)
      const ok = processBufferedEvents(gen)
      if (!ok && gen === generation && !disposed) {
        devLog('snapshot loaded but no overlapping event yet, waiting for live stream')
      }
    } catch (err) {
      clearTimeout(snapshotTimeout)
      if (disposed || gen !== generation) return
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (!disposed && gen === generation) {
          devWarn('snapshot request aborted (timeout or generation change)')
          recordSyncFailure('Snapshot request aborted')
        }
        return
      }
      const msg = err instanceof Error ? err.message : 'Snapshot fetch failed'
      devWarn(`snapshot error: ${msg}`)
      // Don't set ERROR — depth20 is still providing display book
      recordSyncFailure(msg)
    }
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

      if (h === 'SNAPSHOT_LOADING' && snapshotLoadStartTime > 0) {
        const elapsed = now - snapshotLoadStartTime
        if (elapsed > SNAPSHOT_LOADING_MAX_MS) {
          devWarn(`SNAPSHOT_LOADING timeout after ${elapsed}ms`)
          if (snapshotAbort) { snapshotAbort.abort(); snapshotAbort = null }
          recordSyncFailure(`Snapshot loading timeout (${Math.round(elapsed)}ms)`)
        }
      }

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
