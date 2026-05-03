// Hyperliquid WebSocket connection — read source
const WebSocket = require('ws');

class HyperliquidSource {
  constructor(emit) {
    this.emit = emit;
    this.ws = null;
    this.subscriptions = [];
    this.connected = false;
    this.reconnectTimer = null;
    this.coins = []; // available coins
  }

  connect() {
    if (this.ws) return;
    console.log('[HL] Connecting to Hyperliquid...');
    this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

    this.ws.on('open', () => {
      console.log('[HL] Connected');
      this.connected = true;
      this.emit('source_status', { source: 'hyperliquid', status: 'connected' });
      // Subscribe to all trades
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'trades' }
      }));
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        this._handleMessage(msg);
      } catch (e) {
        // ignore parse errors
      }
    });

    this.ws.on('close', () => {
      console.log('[HL] Disconnected');
      this.connected = false;
      this.ws = null;
      this.emit('source_status', { source: 'hyperliquid', status: 'disconnected' });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[HL] Error:', err.message);
    });
  }

  subscribeSymbol(coin) {
    if (!this.connected) return;
    // Subscribe to l2Book for a specific coin
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'l2Book', coin }
    }));
    if (!this.subscriptions.includes(coin)) {
      this.subscriptions.push(coin);
    }
  }

  _handleMessage(msg) {
    if (msg.channel === 'trades' && msg.data) {
      for (const t of msg.data) {
        const trade = {
          source: 'hyperliquid',
          symbol: t.coin,
          price: parseFloat(t.px),
          qty: parseFloat(t.sz),
          side: t.side === 'B' ? 'buy' : 'sell',
          time: t.time || Date.now(),
          hash: t.hash
        };
        this.emit('trade', trade);
      }
    }
    if (msg.channel === 'l2Book' && msg.data) {
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
    // REST call to get available perps
    const https = require('https');
    const options = {
      hostname: 'api.hyperliquid.xyz',
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.universe) {
            this.coins = info.universe.map(u => u.name);
            this.emit('hl_coins', this.coins);
            console.log(`[HL] Found ${this.coins.length} perps`);
          }
        } catch (e) {}
      });
    });
    req.write(JSON.stringify({ type: 'meta' }));
    req.end();
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
