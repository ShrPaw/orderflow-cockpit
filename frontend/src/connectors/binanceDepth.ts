import {
  DepthConnector,
  NormalizedBookUpdate,
  DepthSnapshot,
  DepthEvent,
  ConnectionStatus,
  OrderBookStatus,
  OrderBookDiagnostics,
} from '../types/connector';

/**
 * Binance Futures USDⓈ-M depth stream connector with snapshot-based initialization.
 *
 * Official process:
 * 1. Open WS stream (btcusdt@depth@100ms)
 * 2. Buffer events
 * 3. Fetch REST snapshot (https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000)
 * 4. Drop buffered events where event.u < snapshot.lastUpdateId
 * 5. First valid event: event.U <= lastUpdateId AND event.u >= lastUpdateId
 * 6. Apply remaining buffered events
 * 7. After init: validate event.pu === previousEvent.u
 * 8. On sequence break: resync
 */
export class BinanceDepthConnector implements DepthConnector {
  private ws: WebSocket | null = null;
  private bookCallbacks: ((update: NormalizedBookUpdate) => void)[] = [];
  private snapshotCallbacks: ((snapshot: DepthSnapshot) => void)[] = [];
  private statusCallbacks: ((status: ConnectionStatus) => void)[] = [];
  private diagnosticsCallbacks: ((diag: Partial<OrderBookDiagnostics>) => void)[] = [];

  private status: ConnectionStatus = 'disconnected';
  private bookStatus: OrderBookStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  // Sync state
  private eventBuffer: DepthEvent[] = [];
  private lastAppliedUpdateId = 0;
  private prevFinalUpdateId = 0;
  private sequenceBreakCount = 0;
  private lastDepthEventTime = 0;
  private streamSpeed: '100ms' | '500ms' | 'default' = '100ms';
  private isInitialized = false;
  private snapshotFetchInFlight = false;

  private get streamUrl(): string {
    if (this.streamSpeed === 'default') {
      return 'wss://fstream.binance.com/ws/btcusdt@depth';
    }
    return `wss://fstream.binance.com/ws/btcusdt@depth@${this.streamSpeed}`;
  }

  private readonly snapshotUrl = 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000';

  connect(): void {
    if (this.ws) this.disconnect();
    this.setStatus('connecting');
    this.setBookStatus('connecting');
    this.isInitialized = false;
    this.eventBuffer = [];
    this.lastAppliedUpdateId = 0;
    this.prevFinalUpdateId = 0;
    this.sequenceBreakCount = 0;

    try {
      this.ws = new WebSocket(this.streamUrl);

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.setBookStatus('buffering');
        this.reconnectAttempts = 0;
        this.emitDiagnostics();
        // Start fetching snapshot
        this.fetchSnapshot();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.e !== 'depthUpdate') return;

          const depthEvent: DepthEvent = {
            eventType: 'depthUpdate',
            eventTime: data.E,
            transactionTime: data.T,
            symbol: data.s,
            firstUpdateId: data.U,
            finalUpdateId: data.u,
            prevFinalUpdateId: data.pu ?? 0,
            bids: data.b.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
            asks: data.a.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
          };

          this.lastDepthEventTime = Date.now();

          if (!this.isInitialized) {
            // Buffer events until snapshot is loaded
            this.eventBuffer.push(depthEvent);
            this.emitDiagnostics();
          } else {
            // Validate sequence
            this.processEvent(depthEvent);
          }
        } catch {
          // bad message, skip
        }
      };

      this.ws.onerror = () => {
        this.setStatus('error');
      };

      this.ws.onclose = () => {
        this.stopStaleCheck();
        if (this.status !== 'disconnected') {
          this.setStatus('disconnected');
          this.setBookStatus('disconnected');
          this.scheduleReconnect();
        }
      };
    } catch {
      this.setStatus('error');
      this.setBookStatus('error');
      this.scheduleReconnect();
    }

    this.startStaleCheck();
  }

  disconnect(): void {
    this.stopStaleCheck();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.isInitialized = false;
    this.eventBuffer = [];
    this.snapshotFetchInFlight = false;
    this.setStatus('disconnected');
    this.setBookStatus('disconnected');
  }

  onBookUpdate(callback: (update: NormalizedBookUpdate) => void): void {
    this.bookCallbacks.push(callback);
  }

  onSnapshot(callback: (snapshot: DepthSnapshot) => void): void {
    this.snapshotCallbacks.push(callback);
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.statusCallbacks.push(callback);
  }

  onDiagnostics(callback: (diag: Partial<OrderBookDiagnostics>) => void): void {
    this.diagnosticsCallbacks.push(callback);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getBookStatus(): OrderBookStatus {
    return this.bookStatus;
  }

  getName(): string {
    return 'Binance Depth';
  }

  setStreamSpeed(speed: '100ms' | '500ms' | 'default'): void {
    if (speed === this.streamSpeed) return;
    this.streamSpeed = speed;
    // Reconnect with new speed if currently connected
    if (this.status === 'connected' || this.status === 'connecting') {
      this.disconnect();
      this.connect();
    }
  }

  private async fetchSnapshot(): Promise<void> {
    if (this.snapshotFetchInFlight) return;
    this.snapshotFetchInFlight = true;
    this.setBookStatus('snapshot_loading');
    this.emitDiagnostics();

    try {
      const response = await fetch(this.snapshotUrl);
      if (!response.ok) {
        throw new Error(`Snapshot fetch failed: ${response.status}`);
      }

      const snapshot: DepthSnapshot = await response.json();

      // Notify snapshot listeners
      for (const cb of this.snapshotCallbacks) cb(snapshot);

      // Initialize book from snapshot
      const snapshotUpdate: NormalizedBookUpdate = {
        bids: snapshot.bids.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
        asks: snapshot.asks.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
        timestamp: Date.now(),
        updateId: snapshot.lastUpdateId,
        firstUpdateId: snapshot.lastUpdateId,
        prevFinalUpdateId: 0,
      };

      // Emit snapshot as initial book state
      for (const cb of this.bookCallbacks) cb(snapshotUpdate);

      this.lastAppliedUpdateId = snapshot.lastUpdateId;
      this.isInitialized = true;

      // Process buffered events
      this.processBufferedEvents(snapshot.lastUpdateId);
      this.setBookStatus('synced');
      this.emitDiagnostics();
    } catch (err) {
      console.error('[DepthConnector] Snapshot fetch error:', err);
      this.setBookStatus('error');
      // Retry snapshot after delay
      setTimeout(() => {
        if (this.status === 'connected') {
          this.snapshotFetchInFlight = false;
          this.fetchSnapshot();
        }
      }, 2000);
    } finally {
      this.snapshotFetchInFlight = false;
    }
  }

  private processBufferedEvents(lastUpdateId: number): void {
    // Drop events where event.u < lastUpdateId
    const validEvents = this.eventBuffer.filter(e => e.finalUpdateId > lastUpdateId);

    // Find first valid event: event.U <= lastUpdateId AND event.u >= lastUpdateId
    let startIndex = validEvents.findIndex(
      e => e.firstUpdateId <= lastUpdateId && e.finalUpdateId >= lastUpdateId
    );

    if (startIndex === -1) {
      // No valid events found, book is current
      this.eventBuffer = [];
      return;
    }

    // Apply all events from startIndex
    for (let i = startIndex; i < validEvents.length; i++) {
      this.applyEvent(validEvents[i]);
    }

    this.eventBuffer = [];
  }

  private processEvent(event: DepthEvent): void {
    // Validate sequence: event.pu should equal previous event.u
    if (this.prevFinalUpdateId > 0 && event.prevFinalUpdateId !== this.prevFinalUpdateId) {
      // Sequence break detected
      this.sequenceBreakCount++;
      console.warn(
        `[DepthConnector] Sequence break: expected pu=${this.prevFinalUpdateId}, got pu=${event.prevFinalUpdateId}`
      );
      this.triggerResync();
      return;
    }

    this.applyEvent(event);
  }

  private applyEvent(event: DepthEvent): void {
    // Apply bid updates (absolute quantities)
    const update: NormalizedBookUpdate = {
      bids: event.bids,
      asks: event.asks,
      timestamp: event.transactionTime || event.eventTime,
      updateId: event.finalUpdateId,
      firstUpdateId: event.firstUpdateId,
      prevFinalUpdateId: event.prevFinalUpdateId,
    };

    this.lastAppliedUpdateId = event.finalUpdateId;
    this.prevFinalUpdateId = event.finalUpdateId;

    for (const cb of this.bookCallbacks) cb(update);
    this.emitDiagnostics();
  }

  private triggerResync(): void {
    this.isInitialized = false;
    this.eventBuffer = [];
    this.lastAppliedUpdateId = 0;
    this.prevFinalUpdateId = 0;
    this.setBookStatus('resyncing');
    this.emitDiagnostics();

    // Fetch new snapshot
    this.fetchSnapshot();
  }

  private startStaleCheck(): void {
    this.stopStaleCheck();
    this.staleTimer = setInterval(() => {
      if (this.bookStatus === 'synced' && this.lastDepthEventTime > 0) {
        const age = Date.now() - this.lastDepthEventTime;
        if (age > 3000) {
          this.setBookStatus('stale');
        }
      }
    }, 1000);
  }

  private stopStaleCheck(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private emitDiagnostics(): void {
    const diag: Partial<OrderBookDiagnostics> = {
      status: this.bookStatus,
      lastUpdateId: this.lastAppliedUpdateId,
      lastAppliedUpdateId: this.lastAppliedUpdateId,
      prevFinalUpdateId: this.prevFinalUpdateId,
      bufferedEventCount: this.eventBuffer.length,
      sequenceBreakCount: this.sequenceBreakCount,
      lastDepthEventTime: this.lastDepthEventTime,
      bookAgeMs: this.lastDepthEventTime > 0 ? Date.now() - this.lastDepthEventTime : -1,
      streamSpeed: this.streamSpeed,
    };
    for (const cb of this.diagnosticsCallbacks) cb(diag);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const cb of this.statusCallbacks) cb(status);
  }

  private setBookStatus(status: OrderBookStatus): void {
    this.bookStatus = status;
    this.emitDiagnostics();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
