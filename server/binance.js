// Binance USD-M Futures — reference/execution venue
// NO Spot fallback. Spot is debug-only, disabled by default.
const WebSocket = require('ws');
const https = require('https');

class BinanceSource {
  constructor(emit) {
    this.emit = emit;
    this.wsFutures = null;
    this.connected = { futures: false, spot: false };
    this.reconnectTimers = {};
    this.futuresSymbols = new Set();
    this.spotSymbols = new Set();

    // Debug spot — OFF by default, never auto-connects
    this.spotDebugEnabled = false;
    this.spotDebugActive = false;
  }

  connectFutures() {
    if (this.wsFutures) return;
    console.log('[Binance-Futures] Connecting to USD-M aggTrade stream...');
    this.wsFutures = new WebSocket('wss://fstream.binance.com/ws/!aggTrade@arr');

    this.wsFutures.on('open', () => {
      console.log('[Binance-Futures] Connected — aggTrade stream active');
      this.connected.futures = true;
      this.emit('source_status', { source: 'binance_futures', status: 'connected' });
    });

    this.wsFutures.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.e === 'aggTrade') {
          const trade = {
            source: 'binance_futures',
            symbol: msg.s.replace('USDT', ''),
            rawSymbol: msg.s,
            price: parseFloat(msg.p),
            qty: parseFloat(msg.q),
            side: msg.m ? 'sell' : 'buy',
            time: msg.T,
            tradeId: msg.a
          };
          this.emit('trade', trade);
        }
      } catch (e) {}
    });

    this.wsFutures.on('close', () => {
      console.log('[Binance-Futures] Disconnected');
      this.connected.futures = false;
      this.wsFutures = null;
      this.emit('source_status', { source: 'binance_futures', status: 'disconnected' });
      this._scheduleReconnect('futures');
    });

    this.wsFutures.on('error', (err) => {
      console.error('[Binance-Futures] Error:', err.message);
    });
  }

  // Spot is DEBUG ONLY — never auto-connects, never auto-fallbacks
  connectSpotDebug() {
    if (!this.spotDebugEnabled) {
      console.log('[Binance-Spot] DEBUG MODE — not enabled. Set spotDebugEnabled=true to use.');
      return;
    }
    if (this.wsSpot) return;
    console.log('[Binance-Spot] DEBUG connecting...');
    this.spotDebugActive = true;
    this.wsSpot = new WebSocket('wss://stream.binance.com:9443/ws/!aggTrade@arr');

    this.wsSpot.on('open', () => {
      console.log('[Binance-Spot] DEBUG connected');
      this.connected.spot = true;
      this.emit('source_status', { source: 'binance_spot', status: 'connected' });
    });

    this.wsSpot.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.e === 'aggTrade') {
          const trade = {
            source: 'binance_spot',
            symbol: msg.s.replace('USDT', ''),
            rawSymbol: msg.s,
            price: parseFloat(msg.p),
            qty: parseFloat(msg.q),
            side: msg.m ? 'sell' : 'buy',
            time: msg.T,
            tradeId: msg.a,
            isSpotDebug: true
          };
          this.emit('trade', trade);
        }
      } catch (e) {}
    });

    this.wsSpot.on('close', () => {
      console.log('[Binance-Spot] DEBUG disconnected');
      this.connected.spot = false;
      this.spotDebugActive = false;
      this.wsSpot = null;
      this.emit('source_status', { source: 'binance_spot', status: 'disconnected' });
      // Only reconnect if debug mode still on
      if (this.spotDebugEnabled) this._scheduleReconnect('spot');
    });

    this.wsSpot.on('error', (err) => {
      console.error('[Binance-Spot] DEBUG Error:', err.message);
    });
  }

  subscribeSymbol(symbol) {
    const stream = `${symbol.toLowerCase()}usdt@aggTrade`;
    if (this.connected.futures && this.wsFutures) {
      this.wsFutures.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [stream],
        id: Date.now()
      }));
    }
  }

  fetchFuturesSymbols() {
    return new Promise((resolve) => {
      https.get('https://fapi.binance.com/fapi/v1/exchangeInfo', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            this.futuresSymbols = new Set(
              info.symbols
                .filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
                .map(s => s.symbol)
            );
            this.emit('binance_futures_symbols', [...this.futuresSymbols]);
            console.log(`[Binance-Futures] Found ${this.futuresSymbols.size} perpetual contracts`);
            resolve(this.futuresSymbols);
          } catch (e) { resolve(new Set()); }
        });
      }).on('error', () => resolve(new Set()));
    });
  }

  getStatus() {
    return {
      restConnected: this.futuresSymbols.size > 0,
      executionReferenceOnly: true,
      futuresWsConnected: this.connected.futures,
      aggTradeReceiving: this.connected.futures,
      forceOrderReceiving: false,
      bookTickerReceiving: false,
      markPriceReceiving: false,
      spotDebug: {
        enabled: this.spotDebugEnabled,
        active: this.spotDebugActive
      }
    };
  }

  _scheduleReconnect(type) {
    // NEVER reconnect spot unless debug mode is explicitly on
    if (type === 'spot' && !this.spotDebugEnabled) return;

    const key = `reconnect_${type}`;
    if (this.reconnectTimers[key]) return;
    this.reconnectTimers[key] = setTimeout(() => {
      delete this.reconnectTimers[key];
      if (type === 'futures') this.connectFutures();
      else if (type === 'spot') this.connectSpotDebug();
    }, 3000);
  }

  disconnect() {
    Object.values(this.reconnectTimers).forEach(t => clearTimeout(t));
    if (this.wsFutures) this.wsFutures.close();
    if (this.wsSpot) this.wsSpot.close();
  }
}

module.exports = BinanceSource;
