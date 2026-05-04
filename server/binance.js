// Binance USD-M Futures — reference/execution venue. Spot = debug only, disabled.
const WebSocket = require('ws');
const https = require('https');

class BinanceSource {
  constructor(emit) {
    this.emit = emit;
    this.wsFutures = null;
    this.connected = { futures: false, spot: false };
    this.reconnectTimers = {};
    this.futuresSymbols = new Set();
    this.spotDebugEnabled = false;
    this.spotDebugActive = false;
  }

  connectFutures() {
    if (this.wsFutures) return;
    console.log('[Binance-Futures] Connecting to USD-M aggTrade stream...');
    this.wsFutures = new WebSocket('wss://fstream.binance.com/ws/!aggTrade@arr');

    this.wsFutures.on('open', () => {
      console.log('[Binance-Futures] Connected');
      this.connected.futures = true;
      this.emit('source_status', { source: 'binance_futures', status: 'connected' });
    });

    this.wsFutures.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.e === 'aggTrade') {
          this.emit('trade', {
            source: 'binance_futures',
            symbol: msg.s.replace('USDT', ''),
            rawSymbol: msg.s,
            price: parseFloat(msg.p),
            qty: parseFloat(msg.q),
            side: msg.m ? 'sell' : 'buy',
            time: msg.T,
            tradeId: msg.a
          });
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

    this.wsFutures.on('error', (err) => console.error('[Binance-Futures] Error:', err.message));
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
              info.symbols.filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING').map(s => s.symbol)
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
      spotDebug: { enabled: this.spotDebugEnabled, active: this.spotDebugActive }
    };
  }

  _scheduleReconnect(type) {
    if (type === 'spot' && !this.spotDebugEnabled) return;
    const key = `reconnect_${type}`;
    if (this.reconnectTimers[key]) return;
    this.reconnectTimers[key] = setTimeout(() => {
      delete this.reconnectTimers[key];
      if (type === 'futures') this.connectFutures();
    }, 3000);
  }

  disconnect() {
    Object.values(this.reconnectTimers).forEach(t => clearTimeout(t));
    if (this.wsFutures) this.wsFutures.close();
  }
}

module.exports = BinanceSource;
