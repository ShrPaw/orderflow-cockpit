// Hyperliquid WebSocket — PRIMARY live read source
const WebSocket = require('ws');
const https = require('https');

class HyperliquidSource {
  constructor(emit) {
    this.emit = emit;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.coins = []; // available perps

    // Per-symbol tracking
    this.subscribedTrades = true; // global trade stream
    this.subscribedBooks = new Set(); // coins with l2Book active
    this.activeSymbol = null; // currently focused symbol

    // Stats
    this.tradeCount = 0;
    this.bookUpdateCount = 0;
    this.lastTradeTs = 0;
    this.lastBookTs = 0;
    this.tradesBySymbol = new Map(); // symbol -> count
  }

  connect() {
    if (this.ws) return;
    console.log('[HL] Connecting to Hyperliquid WebSocket...');
    this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

    this.ws.on('open', () => {
      console.log('[HL] Connected — global trade stream active');
      this.connected = true;
      // Subscribe to ALL trades (global stream)
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'trades' }
      }));
      this.emit('source_status', { source: 'hyperliquid', status: 'connected' });

      // Re-subscribe to any active book
      if (this.activeSymbol) {
        this._subscribeBook(this.activeSymbol);
      }
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        this._handleMessage(msg);
      } catch (e) {}
    });

    this.ws.on('close', () => {
      console.log('[HL] Disconnected');
      this.connected = false;
      this.ws = null;
      this.subscribedBooks.clear();
      this.emit('source_status', { source: 'hyperliquid', status: 'disconnected' });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[HL] WebSocket error:', err.message);
    });
  }

  subscribeSymbol(coin) {
    this.activeSymbol = coin;
    if (!this.connected) return;
    this._subscribeBook(coin);
  }

  _subscribeBook(coin) {
    if (!this.connected || !this.ws) return;
    // Unsubscribe previous book if different
    for (const prev of this.subscribedBooks) {
      if (prev !== coin) {
        try {
          this.ws.send(JSON.stringify({
            method: 'unsubscribe',
            subscription: { type: 'l2Book', coin: prev }
          }));
        } catch (e) {}
        this.subscribedBooks.delete(prev);
      }
    }
    // Subscribe to new book
    if (!this.subscribedBooks.has(coin)) {
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'l2Book', coin }
      }));
      this.subscribedBooks.add(coin);
      console.log(`[HL] Subscribed to l2Book for ${coin}`);
    }
  }

  _handleMessage(msg) {
    if (msg.channel === 'trades' && msg.data) {
      for (const t of msg.data) {
        const coin = t.coin;
        const trade = {
          source: 'hyperliquid',
          symbol: coin,
          price: parseFloat(t.px),
          qty: parseFloat(t.sz),
          side: t.side === 'B' ? 'buy' : 'sell',
          time: t.time || Date.now(),
          hash: t.hash
        };
        this.tradeCount++;
        this.lastTradeTs = trade.time;
        const prev = this.tradesBySymbol.get(coin) || 0;
        this.tradesBySymbol.set(coin, prev + 1);
        this.emit('trade', trade);
      }
    }
    if (msg.channel === 'l2Book' && msg.data) {
      this.bookUpdateCount++;
      this.lastBookTs = Date.now();
      this.emit('book', {
        source: 'hyperliquid',
        symbol: msg.data.coin,
        levels: msg.data.levels,
        time: Date.now()
      });
    }
    // Meta info for coin list
    if (msg.channel === 'meta' && msg.data) {
      this.coins = msg.data.universe ? msg.data.universe.map(u => u.name) : [];
      this.emit('hl_coins', this.coins);
    }
  }

  fetchMeta() {
    const req = https.request({
      hostname: 'api.hyperliquid.xyz',
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.universe) {
            this.coins = info.universe.map(u => u.name);
            this.emit('hl_coins', this.coins);
            console.log(`[HL] Found ${this.coins.length} perpetual contracts`);
          }
        } catch (e) {}
      });
    });
    req.write(JSON.stringify({ type: 'meta' }));
    req.end();
  }

  getStatus() {
    return {
      connected: this.connected,
      tradesSubscribed: this.connected && this.subscribedTrades,
      bookSubscribed: this.connected && this.subscribedBooks.has(this.activeSymbol),
      activeSymbol: this.activeSymbol,
      lastTradeTs: this.lastTradeTs,
      lastBookTs: this.lastBookTs,
      tradeCount: this.tradeCount,
      bookUpdateCount: this.bookUpdateCount,
      tradeCountForSymbol: this.tradesBySymbol.get(this.activeSymbol) || 0
    };
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

module.exports = HyperliquidSource;
