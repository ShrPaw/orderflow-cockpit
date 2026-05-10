/**
 * localOrderBook.ts
 *
 * Binance Futures local order book engine.
 *
 * Implements the official methodology:
 * 1. Open diff depth stream → buffer events
 * 2. Fetch REST depth snapshot
 * 3. Discard stale events (u < lastUpdateId)
 * 4. Validate first event: U <= lastUpdateId && u >= lastUpdateId
 * 5. Apply updates in sequence
 * 6. Validate continuity via pu (previous final update ID)
 * 7. If sequence breaks → resync
 * 8. Mark book HEALTHY only after valid sequence
 *
 * Stream: symbol@depth@100ms (Binance Futures)
 * REST:   GET /fapi/v1/depth?symbol=SYMBOL&limit=1000
 */

import type {
  OrderLevel, OrderBookHealth, DiffDepthEvent, DepthSnapshot,
} from '../types/market'

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
const MAX_BUFFER_EVENTS = 500

const BACKOFF_STEPS = [1_000, 2_000, 5_000, 10_000]
const STALE_THRESHOLD_MS = 15_000
const HEALTHY_RESET_RECONNECT_DELAY = 1_000

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function getBackoffDelay(attempts: number): number {
  const idx = Math.min(attempts, BACKOFF_STEPS.length - 1)
  return BACKOFF_STEPS[idx]
}

function sortedBids(book: Map<string, number>): OrderLevel[] {
  return Array.from(book.entries())
    .filter(([, qty]) => qty > 0)
    .map(([price, qty]) => ({ price: parseFloat(price), qty }))
    .sort((a, b) => b.price - a.price)   // high → low
}

function sortedAsks(book: Map<string, number>): OrderLevel[] {
  return Array.from(book.entries())
    .filter(([, qty]) => qty > 0)
    .map(([price, qty]) => ({ price: parseFloat(price), qty }))
    .sort((a, b) => a.price - b.price)   // low → high
}

// ═══════════════════════════════════════════
// REST SNAPSHOT
// ═══════════════════════════════════════════

async function fetchDepthSnapshot(symbol: string): Promise<DepthSnapshot> {
  const url = `${REST_SNAPSHOT_URL}?symbol=${symbol.toUpperCase()}&limit=${SNAPSHOT_LIMIT}`
  const resp = await fetch(url)
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

export function createLocalOrderBook(
  symbol: string,
  callbacks: LocalBookCallbacks,
): () => void {
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
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setInterval> | null = null
  let snapshotLoaded = false
  let pendingEvents: DiffDepthEvent[] = []
  let firstEventValidated = false
  let lastPu: number | null = null

  // ─── Generation token: ignores events from stale sockets ───
  let generation = 0

  // ─── Health management ───
  function setHealth(h: OrderBookHealth, err: string | null = null) {
    book.health = h
    book.error = err
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
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!disposed) fn()
    }, delay)
  }

  // ─── Apply diff to local book ───
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
    book.lastTransactionTime = event.T ?? Date.now()
    book.lastMessageTime = Date.now()
  }

  // ─── Emit current book state ───
  function emitBook() {
    const bids = sortedBids(book.bids)
    const asks = sortedAsks(book.asks)
    callbacks.onDiffApplied(bids, asks, book.lastEventUpdateId, book.lastTransactionTime)
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
    book.lastMessageTime = Date.now()
    snapshotLoaded = true
    firstEventValidated = false
    lastPu = null

    const bids = sortedBids(book.bids)
    const asks = sortedAsks(book.asks)
    callbacks.onSnapshot(bids, asks, snapshot.lastUpdateId)
  }

  // ─── Process buffered events after snapshot ───
  function processBufferedEvents() {
    if (!snapshotLoaded) return

    // Discard events with u < lastUpdateId
    const valid = pendingEvents.filter(e => e.u >= book.lastUpdateId)
    pendingEvents = []

    if (valid.length === 0) {
      setHealth('HEALTHY')
      book.reconnectAttempts = 0
      emitBook()
      return
    }

    // Sort by update ID
    valid.sort((a, b) => a.U - b.U)

    // Find first applicable event: U <= lastUpdateId && u >= lastUpdateId
    let startIdx = -1
    for (let i = 0; i < valid.length; i++) {
      const e = valid[i]
      if (e.U <= book.lastUpdateId && e.u >= book.lastUpdateId) {
        startIdx = i
        break
      }
    }

    if (startIdx === -1) {
      // No valid first event — need fresh snapshot
      console.warn('[LocalBook] No valid first event after snapshot, resyncing')
      triggerResync()
      return
    }

    // Apply from startIdx onward
    for (let i = startIdx; i < valid.length; i++) {
      const event = valid[i]

      // Validate continuity via pu if available
      if (i > startIdx && event.pu !== undefined) {
        const prevEvent = valid[i - 1]
        if (event.pu !== prevEvent.u) {
          console.warn(`[LocalBook] Sequence gap: event.pu=${event.pu} !== prev.u=${prevEvent.u}, resyncing`)
          triggerResync()
          return
        }
      }

      applyDiff(event)
      lastPu = event.pu ?? null
    }

    firstEventValidated = true
    setHealth('HEALTHY')
    book.reconnectAttempts = 0
    emitBook()
  }

  // ─── Handle incoming diff event ───
  function handleDiffEvent(event: DiffDepthEvent) {
    book.lastMessageTime = Date.now()

    if (!snapshotLoaded) {
      // Buffer until snapshot arrives
      if (pendingEvents.length < MAX_BUFFER_EVENTS) {
        pendingEvents.push(event)
      }
      return
    }

    // Discard stale events
    if (event.u <= book.lastUpdateId) {
      return
    }

    // First event validation
    if (!firstEventValidated) {
      if (event.U <= book.lastUpdateId && event.u >= book.lastUpdateId) {
        firstEventValidated = true
        lastPu = event.pu ?? null
        applyDiff(event)
        emitBook()
        return
      } else if (event.U > book.lastUpdateId) {
        // Gap — we missed the overlapping event
        console.warn(`[LocalBook] First event gap: U=${event.U} > lastUpdateId=${book.lastUpdateId}, resyncing`)
        triggerResync()
        return
      }
      // Otherwise discard (event.u < lastUpdateId — stale)
      return
    }

    // Validate continuity via pu
    if (event.pu !== undefined && lastPu !== null) {
      if (event.pu !== book.lastEventUpdateId) {
        console.warn(`[LocalBook] Continuity break: pu=${event.pu} !== lastEventUpdateId=${book.lastEventUpdateId}, resyncing`)
        triggerResync()
        return
      }
    }

    applyDiff(event)
    lastPu = event.pu ?? null
    emitBook()
  }

  // ─── Close the current WebSocket if open ───
  function closeSocket() {
    if (ws) {
      // Detach handlers before closing to prevent onclose from scheduling reconnects
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try { ws.close() } catch { /* ignore */ }
      ws = null
    }
  }

  // ─── Fetch snapshot and initialize ───
  async function loadSnapshot() {
    setHealth('SYNCING')
    try {
      const snapshot = await fetchDepthSnapshot(symbol)
      if (disposed) return
      applySnapshot(snapshot)
      processBufferedEvents()
    } catch (err) {
      if (disposed) return
      const msg = err instanceof Error ? err.message : 'Snapshot fetch failed'
      console.error(`[LocalBook] Snapshot error: ${msg}`)
      setHealth('ERROR', msg)
      // Retry with backoff
      const delay = getBackoffDelay(book.reconnectAttempts)
      book.reconnectAttempts++
      scheduleReconnect(() => {
        if (!disposed) loadSnapshot()
      }, delay)
    }
  }

  // ─── Full resync ───
  function triggerResync() {
    if (disposed) return
    console.log(`[LocalBook] Triggering full resync for ${symbol}`)

    // CRITICAL: cancel any pending reconnect timer BEFORE doing anything else.
    // Without this, the old timer will fire later and create a duplicate socket.
    cancelReconnectTimer()

    // Close existing socket with detached handlers so onclose cannot schedule reconnects
    closeSocket()

    // Bump generation so any stale events from old sockets are ignored
    generation++

    setHealth('RESYNCING', 'Resyncing order book…')
    snapshotLoaded = false
    firstEventValidated = false
    lastPu = null
    pendingEvents = []
    book.bids.clear()
    book.asks.clear()
    book.lastUpdateId = 0
    book.lastEventUpdateId = 0

    // Load fresh snapshot, then reconnect stream
    loadSnapshot().then(() => {
      if (!disposed && book.health === 'HEALTHY') {
        connectStream()
      }
    })
  }

  // ─── WebSocket diff depth stream ───
  function connectStream() {
    if (disposed) return

    // CRITICAL: cancel any pending reconnect timer first.
    // Without this, a timer from a previous onclose would fire and create a duplicate socket.
    cancelReconnectTimer()

    // Close existing socket with detached handlers
    closeSocket()

    // New generation for this socket
    const myGen = ++generation

    const wsSymbol = symbol.toLowerCase() + '@depth@100ms'
    const url = `${WS_BASE}/${wsSymbol}`
    console.log(`[LocalBook] Connecting diff stream: ${url} (gen=${myGen})`)

    const socket = new WebSocket(url)
    ws = socket

    socket.onopen = () => {
      if (disposed || generation !== myGen) return
      console.log(`[LocalBook] Diff stream connected: ${symbol} (gen=${myGen})`)
      if (!snapshotLoaded) {
        setHealth('SYNCING')
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
        handleDiffEvent(diffEvent)
      } catch (err) {
        console.warn('[LocalBook] Parse error:', err)
      }
    }

    socket.onclose = (ev) => {
      if (disposed || generation !== myGen) {
        // Stale socket — ignore completely
        console.log(`[LocalBook] Ignoring close from stale socket (gen=${myGen}, current=${generation})`)
        return
      }
      console.log(`[LocalBook] Diff stream closed: ${symbol} code=${ev.code} (gen=${myGen})`)
      ws = null

      if (book.health === 'HEALTHY') {
        setHealth('STALE', 'Diff stream disconnected')
      }

      const delay = getBackoffDelay(book.reconnectAttempts)
      book.reconnectAttempts++
      scheduleReconnect(() => {
        if (!disposed && generation === myGen) {
          // If we were healthy, just reconnect stream
          // If not, do full resync
          if (snapshotLoaded && firstEventValidated) {
            connectStream()
          } else {
            triggerResync()
          }
        }
      }, delay)
    }

    socket.onerror = (ev) => {
      if (disposed || generation !== myGen) return
      console.error('[LocalBook] Diff stream error:', ev)
      // onerror is always followed by onclose — let onclose handle reconnect
      socket.close()
    }
  }

  // ─── Stale monitor ───
  function startStaleMonitor() {
    stopStaleMonitor()
    staleTimer = setInterval(() => {
      if (disposed) return
      if (book.health === 'HEALTHY' && book.lastMessageTime > 0) {
        const elapsed = Date.now() - book.lastMessageTime
        if (elapsed > STALE_THRESHOLD_MS) {
          callbacks.onStale(`No depth updates for ${Math.round(elapsed / 1000)}s`)
          setHealth('STALE', 'No depth updates — book stale')
        }
      }
    }, 5_000)
  }

  function stopStaleMonitor() {
    if (staleTimer) {
      clearInterval(staleTimer)
      staleTimer = null
    }
  }

  // ─── Start ───
  setHealth('CONNECTING')
  startStaleMonitor()

  // Load snapshot first, then connect stream
  loadSnapshot().then(() => {
    if (!disposed) {
      connectStream()
    }
  })

  // ─── Cleanup ───
  return () => {
    disposed = true
    generation++ // invalidate all pending events from current sockets
    cancelReconnectTimer()
    stopStaleMonitor()
    closeSocket()
  }
}
