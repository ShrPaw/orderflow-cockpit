import { DepthConnector, NormalizedBookUpdate, ConnectionStatus } from '../types/connector';

/**
 * Binance Futures BTCUSDT depth@100ms WebSocket connector.
 *
 * Endpoint: wss://fstream.binance.com/ws/btcusdt@depth@100ms
 *
 * Message format:
 * {
 *   "e": "depthUpdate",
 *   "E": 1234567890,       // Event time
 *   "T": 1234567890,       // Transaction time
 *   "s": "BTCUSDT",
 *   "U": 100,              // First update ID
 *   "u": 120,              // Final update ID
 *   "b": [["price", "qty"], ...],  // Bids
 *   "a": [["price", "qty"], ...]   // Asks
 * }
 *
 * Note: qty = "0.000" means remove the price level.
 */
export class BinanceDepthConnector implements DepthConnector {
  private ws: WebSocket | null = null;
  private bookCallbacks: ((update: NormalizedBookUpdate) => void)[] = [];
  private statusCallbacks: ((status: ConnectionStatus) => void)[] = [];
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;

  private readonly url = 'wss://fstream.binance.com/ws/btcusdt@depth@100ms';

  connect(): void {
    if (this.ws) this.disconnect();
    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.e !== 'depthUpdate') return;

          const bids: [number, number][] = data.b.map(([p, q]: [string, string]) => [
            parseFloat(p),
            parseFloat(q),
          ]);
          const asks: [number, number][] = data.a.map(([p, q]: [string, string]) => [
            parseFloat(p),
            parseFloat(q),
          ]);

          const update: NormalizedBookUpdate = {
            bids,
            asks,
            timestamp: data.T || data.E,
            updateId: data.u,
          };

          for (const cb of this.bookCallbacks) cb(update);
        } catch {
          // bad message, skip
        }
      };

      this.ws.onerror = () => {
        this.setStatus('error');
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
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
    this.setStatus('disconnected');
  }

  onBookUpdate(callback: (update: NormalizedBookUpdate) => void): void {
    this.bookCallbacks.push(callback);
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.statusCallbacks.push(callback);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getName(): string {
    return 'Binance Depth';
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const cb of this.statusCallbacks) cb(status);
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
