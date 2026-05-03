// Orderflow Cockpit — Main Server
// HTTP API + WebSocket server for real-time data to frontend

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const HyperliquidSource = require('./hyperliquid');
const BinanceSource = require('./binance');
const CandleEngine = require('./candle-engine');
const ProfileEngine = require('./profile-engine');
const SymbolMap = require('./symbol-map');
const Scanner = require('./scanner');

const PORT = process.env.PORT || 3777;

// --- Core state ---
const symbolMap = new SymbolMap();
const candleEngine = new CandleEngine(40000); // 40s default
const scanner = new Scanner(candleEngine, symbolMap);

// Active source tracking
let activeReadSource = 'hyperliquid'; // primary
let sourceStatus = {
  hyperliquid: 'disconnected',
  binance_futures: 'disconnected',
  binance_spot: 'disconnected'
};
let isSpotFallback = false;

// --- Emit function (broadcasts to all connected UI clients) ---
const uiClients = new Set();

function emit(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const ws of uiClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// --- Data sources ---
const hlSource = new HyperliquidSource((type, data) => {
  if (type === 'trade') {
    data.symbol = symbolMap.normalize(data.symbol, 'hyperliquid');
    candleEngine.processTrade(data);
    scanner.processTrade(data);
  }
  if (type === 'source_status') {
    sourceStatus[data.source] = data.status;
    emit('source_status', sourceStatus);
  }
  if (type === 'hl_coins') {
    symbolMap.setHLCoins(data);
    emit('hl_coins', data);
  }
  if (type === 'book') {
    emit('book', data);
  }
});

const binanceSource = new BinanceSource((type, data) => {
  if (type === 'trade') {
    data.symbol = symbolMap.normalize(data.symbol, data.source);
    // Only use Binance trades if HL is not primary or as supplement
    if (activeReadSource !== 'hyperliquid' || isSpotFallback) {
      candleEngine.processTrade(data);
      scanner.processTrade(data);
    }
  }
  if (type === 'source_status') {
    sourceStatus[data.source] = data.status;
    // Auto-fallback logic
    if (data.source === 'binance_futures' && data.status === 'disconnected' && sourceStatus.binance_spot === 'connected') {
      isSpotFallback = true;
    }
    emit('source_status', { ...sourceStatus, isSpotFallback });
  }
  if (type === 'binance_futures_symbols') {
    symbolMap.setBinanceSymbols(data);
    emit('binance_symbols', [...data]);
  }
});

// --- Candle engine events ---
candleEngine.onCandle((candle) => {
  emit('candle', candle);
  // Also emit bubble events for the UI
  if (candle.bubbles && candle.bubbles.length > 0) {
    emit('bubbles', {
      symbol: candle.symbol,
      bubbles: candle.bubbles,
      candleTime: candle.openTime
    });
  }
});

// --- Zone detection ---
const activeZones = new Map(); // symbol -> zones[]

function detectZones(symbol, candles) {
  if (candles.length < 5) return;

  const zones = [];
  const recent = candles.slice(-20);

  // Find absorption zones (tight range + high volume)
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    const range = c.high - c.low;
    const mid = (c.high + c.low) / 2;
    if (mid === 0) continue;

    if (range / mid < 0.003 && c.volume > 0) {
      const avgVol = recent.reduce((s, r) => s + r.volume, 0) / recent.length;
      if (c.volume > avgVol * 1.5) {
        const side = c.delta > 0 ? 'BUY' : 'SELL';
        zones.push({
          type: `${side}_ABSORPTION_ZONE`,
          priceLow: c.low,
          priceHigh: c.high,
          strength: c.volume / avgVol,
          candleTime: c.openTime
        });
      }
    }
  }

  // Find rejection zones (wick-heavy candles)
  for (const c of recent) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range === 0) continue;

    if (body / range < 0.3 && range / ((c.high + c.low) / 2) > 0.005) {
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;

      if (upperWick > lowerWick * 2) {
        zones.push({
          type: 'SELL_REJECTION_ZONE',
          priceLow: Math.max(c.open, c.close),
          priceHigh: c.high,
          strength: upperWick / range,
          candleTime: c.openTime
        });
      } else if (lowerWick > upperWick * 2) {
        zones.push({
          type: 'BUY_REJECTION_ZONE',
          priceLow: c.low,
          priceHigh: Math.min(c.open, c.close),
          strength: lowerWick / range,
          candleTime: c.openTime
        });
      }
    }
  }

  activeZones.set(symbol, zones);
  emit('zones', { symbol, zones });
}

// Periodically update zones
setInterval(() => {
  for (const [symbol, candles] of candleEngine.candles) {
    detectZones(symbol, candles.slice(-50));
  }
}, 10000);

// --- HTTP Server ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // --- API Routes ---
  if (pathname === '/sources/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...sourceStatus, activeReadSource, isSpotFallback }));
    return;
  }

  if (pathname === '/scanner/overview') {
    const mode = url.searchParams.get('mode') || 'full';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scanner.getOverview(mode)));
    return;
  }

  if (pathname === '/symbols/overlap') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(symbolMap.getOverlap()));
    return;
  }

  if (pathname === '/orderflow/candles') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    const interval = url.searchParams.get('interval') || '40s';
    const count = parseInt(url.searchParams.get('count') || '500');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(candleEngine.getCandles(symbol, count)));
    return;
  }

  if (pathname === '/orderflow/bubbles') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    const candles = candleEngine.getCandles(symbol, 100);
    const bubbles = candles.flatMap(c => (c.bubbles || []).map(b => ({ ...b, candleTime: c.openTime })));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bubbles));
    return;
  }

  if (pathname === '/orderflow/zones') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activeZones.get(symbol) || []));
    return;
  }

  if (pathname === '/orderflow/profile/selected') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    const start = parseInt(url.searchParams.get('start'));
    const end = parseInt(url.searchParams.get('end'));
    const priceLow = parseFloat(url.searchParams.get('price_low'));
    const priceHigh = parseFloat(url.searchParams.get('price_high'));

    const allCandles = candleEngine.getCandles(symbol, 2000);
    const filtered = allCandles.filter(c => c.openTime >= start && c.openTime <= end);
    const profile = ProfileEngine.compute(filtered, { priceLow, priceHigh });
    profile.interpretation = ProfileEngine.interpret(profile);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profile));
    return;
  }

  if (pathname === '/orderflow/profile/visible') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    const from = parseInt(url.searchParams.get('from'));
    const to = parseInt(url.searchParams.get('to'));

    const allCandles = candleEngine.getCandles(symbol, 2000);
    const filtered = allCandles.filter(c => c.openTime >= from && c.openTime <= to);
    const profile = ProfileEngine.compute(filtered);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profile));
    return;
  }

  if (pathname === '/orderflow/footprint') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    const candle = candleEngine.getCurrentCandle(symbol);
    const priceMap = candle ? candle.priceMap || {} : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ symbol, candle: candle ? {
      openTime: candle.openTime, open: candle.open, high: candle.high,
      low: candle.low, close: candle.close, volume: candle.volume,
      delta: candle.delta
    } : null, levels: priceMap }));
    return;
  }

  if (pathname === '/orderflow/book') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Use WebSocket for real-time book data' }));
    return;
  }

  if (pathname === '/orderflow/asset-context') {
    const symbol = url.searchParams.get('symbol') || 'BTC';
    const snapshot = candleEngine.getSnapshot(symbol);
    const zones = activeZones.get(symbol) || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      symbol,
      readSource: activeReadSource,
      executionReference: symbolMap.existsOnBoth(symbol) ? 'binance_usdm' : 'unavailable',
      binanceSymbol: symbolMap.toBinance(symbol),
      availableOnBinance: symbolMap.binanceFuturesSymbols.has(symbolMap.toBinance(symbol)),
      isSpotFallback,
      candleCount: snapshot.historical.length,
      hasCurrentCandle: !!snapshot.current,
      zones: zones.length,
      dataQuality: isSpotFallback ? 'spot_fallback' : sourceStatus.hyperliquid === 'connected' ? 'good' : 'degraded'
    }));
    return;
  }

  // --- Static files ---
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, '..', 'public', filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// --- WebSocket Server (for UI clients) ---
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  uiClients.add(ws);
  console.log(`[UI] Client connected (${uiClients.size} total)`);

  // Send current state
  ws.send(JSON.stringify({ type: 'source_status', data: { ...sourceStatus, isSpotFallback } }));
  ws.send(JSON.stringify({ type: 'hl_coins', data: symbolMap.hlCoins ? [...symbolMap.hlCoins] : [] }));
  ws.send(JSON.stringify({ type: 'binance_symbols', data: symbolMap.binanceFuturesSymbols ? [...symbolMap.binanceFuturesSymbols] : [] }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleClientMessage(ws, msg);
    } catch (e) {}
  });

  ws.on('close', () => {
    uiClients.delete(ws);
    console.log(`[UI] Client disconnected (${uiClients.size} total)`);
  });
});

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe_symbol':
      // Client wants to focus on a symbol
      hlSource.subscribeSymbol(msg.symbol);
      // Send existing candles
      const snapshot = candleEngine.getSnapshot(msg.symbol);
      ws.send(JSON.stringify({ type: 'snapshot', data: { symbol: msg.symbol, ...snapshot } }));
      // Send zones
      ws.send(JSON.stringify({ type: 'zones', data: { symbol: msg.symbol, zones: activeZones.get(msg.symbol) || [] } }));
      break;

    case 'set_interval':
      const intervals = { '10s': 10000, '20s': 20000, '40s': 40000, '1m': 60000, '3m': 180000, '5m': 300000 };
      if (intervals[msg.interval]) {
        candleEngine.setInterval(intervals[msg.interval]);
      }
      break;

    case 'get_profile':
      // Compute profile for a selected range
      const allCandles = candleEngine.getCandles(msg.symbol, 2000);
      const filtered = allCandles.filter(c => c.openTime >= msg.start && c.openTime <= msg.end);
      const profile = ProfileEngine.compute(filtered, {
        priceLow: msg.priceLow,
        priceHigh: msg.priceHigh
      });
      profile.interpretation = ProfileEngine.interpret(profile);
      ws.send(JSON.stringify({ type: 'profile', data: { symbol: msg.symbol, profile } }));
      break;

    case 'get_footprint':
      const fp = candleEngine.getCurrentCandle(msg.symbol);
      ws.send(JSON.stringify({ type: 'footprint', data: {
        symbol: msg.symbol,
        candle: fp ? {
          openTime: fp.openTime, open: fp.open, high: fp.high,
          low: fp.low, close: fp.close, volume: fp.volume,
          buyVolume: fp.buyVolume, sellVolume: fp.sellVolume,
          delta: fp.delta, tradeCount: fp.tradeCount
        } : null,
        levels: fp ? fp.priceMap || {} : {}
      }}));
      break;
  }
}

// --- Start ---
server.listen(PORT, () => {
  console.log(`\n=== Orderflow Cockpit ===`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Read source: Hyperliquid (primary), Binance (fallback)`);
  console.log(`Candle interval: 40s default`);
  console.log(`========================\n`);

  // Connect data sources
  hlSource.connect();
  hlSource.fetchMeta();

  // Connect Binance for symbol universe + fallback
  binanceSource.fetchFuturesSymbols().then(() => {
    binanceSource.connectFutures();
  });

  // Start scanner
  scanner.start();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  hlSource.disconnect();
  binanceSource.disconnect();
  scanner.stop();
  server.close();
  process.exit(0);
});
