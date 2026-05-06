import { MarketDataConnector, NormalizedTrade, ConnectionStatus } from '../types/connector';

/**
 * Hyperliquid WebSocket connector.
 *
 * Endpoint: wss://api.hyperliquid.xyz/ws
 *
 * Subscription message:
 *   { method: "subscribe", subscription: { type: "trades", coin: "BTC" } }
 *
 * Trade message format (from public API):
 *   { channel: "trades", data: [{ coin, side, px, sz, time, ... }] }
 *
 * Aggressor side:
 *   side = "A" (aggressor buy) or "B" (aggressor sell)
 *   In Hyperliquid docs: "A" = buy aggression, "B" = sell aggression
 */
export class HyperliquidConnector implements MarketDataConnector {
  private ws: WebSocket | null = null;
  private tradeCallbacks: ((trade: NormalizedTrade) => void)[] = [];
  private statusCallbacks: ((status: ConnectionStatus) => void)[] = [];
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private seenIds = new Set<string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private readonly symbol = 'BTC';
  private readonly url = 'wss://api.hyperliquid.xyz/ws';

  connect(): void {
    if (this.ws) this.disconnect();
    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        // Subscribe to BTC trades
        const subMsg = {
          method: 'subscribe',
          subscription: { type: 'trades', coin: this.symbol },
        };
        this.ws!.send(JSON.stringify(subMsg));
        this.setStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          // Handle trade messages
          if (msg.channel === 'trades' && Array.isArray(msg.data)) {
            for (const t of msg.data) {
              const tradeId = `${t.time}_${t.px}_${t.sz}`;
              if (this.seenIds.has(tradeId)) continue;
              this.seenIds.add(tradeId);

              const price = parseFloat(t.px);
              const qty = parseFloat(t.sz);
              // Hyperliquid: side "A" = buy aggression, "B" = sell aggression
              const aggressorSide: 'buy' | 'sell' = t.side === 'A' ? 'buy' : 'sell';

              const trade: NormalizedTrade = {
                id: `hl_${t.time}_${t.px}_${t.sz}`,
                exchange: 'hyperliquid',
                symbol: this.symbol,
                timestamp: t.time,
                price,
                size: qty,
                aggressorSide,
                notional: price * qty,
                raw: t,
              };

              for (const cb of this.tradeCallbacks) cb(trade);
            }
          }

          // Handle subscription response
          if (msg.channel === 'subscriptionResponse') {
            // Successfully subscribed
          }
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

    // Clean up seen IDs periodically
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
    return 'Hyperliquid';
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
