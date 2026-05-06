import { MarketDataConnector, NormalizedTrade, ConnectionStatus } from '../types/connector';

/**
 * Binance Futures BTCUSDT aggTrade WebSocket connector.
 *
 * Endpoint: wss://fstream.binance.com/ws/btcusdt@aggTrade
 *
 * Aggressor side logic:
 *   m = true  → buyer is maker (passive), seller is taker (aggressive) → aggressor = sell
 *   m = false → seller is maker (passive), buyer is taker (aggressive) → aggressor = buy
 */
export class BinanceFuturesConnector implements MarketDataConnector {
  private ws: WebSocket | null = null;
  private tradeCallbacks: ((trade: NormalizedTrade) => void)[] = [];
  private statusCallbacks: ((status: ConnectionStatus) => void)[] = [];
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private seenIds = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private readonly symbol = 'BTCUSDT';
  private readonly url = 'wss://fstream.binance.com/ws/btcusdt@aggTrade';

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
          if (data.e !== 'aggTrade') return;

          const tradeId = String(data.a);
          if (this.seenIds.has(tradeId)) return;
          this.seenIds.add(tradeId);

          const price = parseFloat(data.p);
          const qty = parseFloat(data.q);
          const trade: NormalizedTrade = {
            id: `binance_${tradeId}`,
            exchange: 'binance',
            symbol: this.symbol,
            timestamp: data.T,
            price,
            size: qty,
            aggressorSide: data.m ? 'sell' : 'buy',
            notional: price * qty,
            raw: data,
          };

          for (const cb of this.tradeCallbacks) cb(trade);
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

    // Clean up seen IDs periodically to prevent memory leak
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => {
      if (this.seenIds.size > 100000) {
        const arr = Array.from(this.seenIds);
        this.seenIds = new Set(arr.slice(-50000));
      }
    }, 30000);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  onTrade(callback: (trade: NormalizedTrade) => void): void {
    this.tradeCallbacks.push(callback);
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.statusCallbacks.push(callback);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getName(): string {
    return 'Binance Futures';
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
