// Hyperliquid WebSocket — PRIMARY live read source
// Subscribes to trades for ALL perp coins (per-coin subscription required by HL API)

const WebSocket = require('ws');
const https = require('https');

class HyperliquidSource {
  constructor(emit) {
    this.emit = emit;
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.coins = []; // available perps
    this.subscribedTradeCoins = new Set(); // coins with trade subscription
    this.subscribedBooks = new Set(); // coins with l2Book active
    this.activeSymbol = null;

    // Stats
    this.tradeCount = 0;
    this.bookUpdateCount = 0;
    this.lastTradeTs = 0;
    this.lastBookTs = 0;
    this.tradesBySymbol = new Map();
  }

  connect() {
    if (this.ws) return;
    console.log('[HL] Connecting to Hyperliquid WebSocket...');
    this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

    this.ws.on('open', () => {
      console.log('[HL] Connected');
      this.connected = true;
      this.emit('source_status', { source: 'hyperliquid', status: 'connected' });

      // Subscribe to ALL coins (if we have the universe)
      if (this.coins.length > 0) {
        this._subscribeAllTrades();
      }

      // Re-subscribe to active book
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
      this.subscribedTradeCoins.clear();
      this.subscribedBooks.clear();
      this.emit('source_status', { source: 'hyperliquid', status: 'disconnected' });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[HL] WebSocket error:', err.message);
    });
  }

  /**
   * Subscribe to trades for all coins in the universe
   */
  _subscribeAllTrades() {
    if (!this.connected || !this.ws) return;
    let count = 0;
    for (const coin of this.coins) {
      if (!this.subscribedTradeCoins.has(coin)) {
        this.ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'trades', coin }
        }));
        this.subscribedTradeCoins.add(coin);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[HL] Subscribed to trades for ${count} coins (total: ${this.subscribedTradeCoins.size})`);
    }
  }

  subscribeSymbol(coin) {
    this.activeSymbol = coin;
    if (!this.connected) return;

    // Ensure trade subscription for this coin
    if (!this.subscribedTradeCoins.has(coin)) {
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'trades', coin }
      }));
      this.subscribedTradeCoins.add(coin);
    }

    // Subscribe to l2Book
    this._subscribeBook(coin);
  }

  _subscribeBook(coin) {
    if (!this.connected || !this.ws) return;
    // Unsubscribe previous books
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
    // Subscription responses — ignore
    if (msg.channel === 'subscriptionResponse') return;
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
            const newCoins = info.universe.map(u => u.name);
            const added = newCoins.filter(c => !this.coins.includes(c));
            this.coins = newCoins;
            this.emit('hl_coins', this.coins);
            console.log(`[HL] Found ${this.coins.length} perpetual contracts`);

            // Subscribe to trades for any new coins
            if (this.connected && added.length > 0) {
              for (const coin of added) {
                if (!this.subscribedTradeCoins.has(coin)) {
                  this.ws.send(JSON.stringify({
                    method: 'subscribe',
                    subscription: { type: 'trades', coin }
                  }));
                  this.subscribedTradeCoins.add(coin);
                }
              }
              console.log(`[HL] Subscribed to ${added.length} new coins`);
            }

            // If we just got the universe and are already connected, subscribe all
            if (this.connected && this.subscribedTradeCoins.size === 0) {
              this._subscribeAllTrades();
            }
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
      tradesSubscribed: this.connected && this.subscribedTradeCoins.size > 0,
      bookSubscribed: this.connected && this.subscribedBooks.has(this.activeSymbol),
      activeSymbol: this.activeSymbol,
      lastTradeTs: this.lastTradeTs,
      lastBookTs: this.lastBookTs,
      tradeCount: this.tradeCount,
      bookUpdateCount: this.bookUpdateCount,
      tradeCountForSymbol: this.tradesBySymbol.get(this.activeSymbol) || 0,
      subscribedCoins: this.subscribedTradeCoins.size
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
