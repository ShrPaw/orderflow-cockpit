// Binance USD-M Futures + Spot fallback WebSocket
const WebSocket = require('ws');
const https = require('https');

class BinanceSource {
  constructor(emit) {
    this.emit = emit;
    this.wsFutures = null;
    this.wsSpot = null;
    this.connected = { futures: false, spot: false };
    this.reconnectTimers = {};
    this.futuresSymbols = new Set();
    this.spotSymbols = new Set();
  }

  connectFutures() {
    if (this.wsFutures) return;
    console.log('[Binance-Futures] Connecting...');
    // Combined stream for aggTrades
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
          const trade = {
            source: 'binance_futures',
            symbol: msg.s.replace('USDT', ''),
            rawSymbol: msg.s,
            price: parseFloat(msg.p),
            qty: parseFloat(msg.q),
            side: msg.m ? 'sell' : 'buy', // m=true means buyer is maker = sell aggressor
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

  connectSpot() {
    if (this.wsSpot) return;
    console.log('[Binance-Spot] Connecting (debug fallback)...');
    this.wsSpot = new WebSocket('wss://stream.binance.com:9443/ws/!aggTrade@arr');

    this.wsSpot.on('open', () => {
      console.log('[Binance-Spot] Connected');
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
            isSpotFallback: true
          };
          this.emit('trade', trade);
        }
      } catch (e) {}
    });

    this.wsSpot.on('close', () => {
      console.log('[Binance-Spot] Disconnected');
      this.connected.spot = false;
      this.wsSpot = null;
      this.emit('source_status', { source: 'binance_spot', status: 'disconnected' });
      this._scheduleReconnect('spot');
    });

    this.wsSpot.on('error', (err) => {
      console.error('[Binance-Spot] Error:', err.message);
    });
  }

  subscribeSymbol(symbol) {
    // For individual symbol streams if needed
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
            console.log(`[Binance-Futures] Found ${this.futuresSymbols.size} perps`);
            resolve(this.futuresSymbols);
          } catch (e) { resolve(new Set()); }
        });
      }).on('error', () => resolve(new Set()));
    });
  }

  _scheduleReconnect(type) {
    const key = `reconnect_${type}`;
    if (this.reconnectTimers[key]) return;
    this.reconnectTimers[key] = setTimeout(() => {
      delete this.reconnectTimers[key];
      if (type === 'futures') this.connectFutures();
      else this.connectSpot();
    }, 3000);
  }

  disconnect() {
    Object.values(this.reconnectTimers).forEach(t => clearTimeout(t));
    if (this.wsFutures) this.wsFutures.close();
    if (this.wsSpot) this.wsSpot.close();
  }
}

module.exports = BinanceSource;
