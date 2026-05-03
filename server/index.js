// Orderflow Cockpit — Main Server
// Professional perp-only orderflow cockpit
// Hyperliquid = PRIMARY live read source
// Binance USD-M = manual execution/reference venue
// Binance Spot = debug only, disabled by default

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

// Active symbol tracking (PHASE 0 — truth model)
let activeSymbol = null;
let activeInterval = '40s';
let activeSource = 'hyperliquid';
let lastError = null;

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
    emit('source_status', buildStatus());
  }
  if (type === 'hl_coins') {
    symbolMap.setHLCoins(data);
    emit('hl_coins', data);
    // After HL coins arrive, mark scanner as hydrated
    scanner.setHydrated('hyperliquid');
  }
  if (type === 'book') {
    emit('book', data);
  }
});

const binanceSource = new BinanceSource((type, data) => {
  if (type === 'trade') {
    data.symbol = symbolMap.normalize(data.symbol, data.source);
    // Binance trades are for reference/scanner only — HL is primary read
    candleEngine.processTrade(data);
    scanner.processTrade(data);
  }
  if (type === 'source_status') {
    emit('source_status', buildStatus());
  }
  if (type === 'binance_futures_symbols') {
    symbolMap.setBinanceSymbols(data);
    emit('binance_symbols', [...data]);
    scanner.setHydrated('binance');
  }
});

// --- Status truth model (PHASE 0) ---
function buildStatus() {
  const hlStatus = hlSource.getStatus();
  const bnStatus = binanceSource.getStatus();
  const candleCount = activeSymbol ? candleEngine.getCandles(activeSymbol, 2000).length : 0;
  const currentCandle = activeSymbol ? candleEngine.getCurrentCandle(activeSymbol) : null;
  const zones = activeSymbol ? (activeZones.get(activeSymbol) || []) : [];

  return {
    selectedSource: activeSource,
    selectedSymbol: activeSymbol,
    selectedInterval: activeInterval,
    hyperliquid: hlStatus,
    binanceUsdm: bnStatus,
    spotDebug: {
      enabled: binanceSource.spotDebugEnabled,
      active: binanceSource.spotDebugActive
    },
    candles: candleCount,
    currentCandle: !!currentCandle,
    bubbles: currentCandle ? currentCandle.bubbleCount : 0,
    zones: zones.length,
    scannerRows: scanner.stats.size,
    lastError: lastError
  };
}

// --- Candle engine events ---
candleEngine.onCandle((candle) => {
  emit('candle', candle);
  if (candle.bubbles && candle.bubbles.length > 0) {
    emit('bubbles', {
      symbol: candle.symbol,
      bubbles: candle.bubbles,
      candleTime: candle.openTime
    });
  }
});

// --- Zone detection ---
const activeZones = new Map();

function detectZones(symbol, candles) {
  if (candles.length < 5) return;

  const zones = [];
  const recent = candles.slice(-20);

  // Absorption zones (tight range + high volume)
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

  // Rejection zones (wick-heavy candles)
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // --- API Routes ---

  // PHASE 2: POST /api/select-symbol — subscribe to a symbol
  if (pathname === '/api/select-symbol' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { source, symbol, interval } = JSON.parse(body);
        const result = selectSymbol(symbol, source || 'hyperliquid', interval || '40s');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // PHASE 2: GET /api/status — full truth model
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildStatus()));
    return;
  }

  // Existing endpoints
  if (pathname === '/sources/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildStatus()));
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
    const symbol = url.searchParams.get('symbol') || activeSymbol || 'BTC';
    const count = parseInt(url.searchParams.get('count') || '500');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(candleEngine.getCandles(symbol, count)));
    return;
  }

  if (pathname === '/orderflow/bubbles') {
    const symbol = url.searchParams.get('symbol') || activeSymbol || 'BTC';
    const candles = candleEngine.getCandles(symbol, 100);
    const bubbles = candles.flatMap(c => (c.bubbles || []).map(b => ({ ...b, candleTime: c.openTime })));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bubbles));
    return;
  }

  if (pathname === '/orderflow/zones') {
    const symbol = url.searchParams.get('symbol') || activeSymbol || 'BTC';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activeZones.get(symbol) || []));
    return;
  }

  if (pathname === '/orderflow/profile/selected') {
    const symbol = url.searchParams.get('symbol') || activeSymbol || 'BTC';
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
    const symbol = url.searchParams.get('symbol') || activeSymbol || 'BTC';
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
    const symbol = url.searchParams.get('symbol') || activeSymbol || 'BTC';
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

// --- Symbol selection logic (PHASE 2) ---
function selectSymbol(symbol, source, interval) {
  const sym = symbol.toUpperCase().trim();
  if (!sym) return { ok: false, error: 'empty symbol' };

  activeSymbol = sym;
  activeSource = source || 'hyperliquid';
  activeInterval = interval || '40s';
  lastError = null;

  // Set candle interval
  const intervals = { '10s': 10000, '20s': 20000, '40s': 40000, '1m': 60000, '3m': 180000, '5m': 300000 };
  if (intervals[activeInterval]) {
    candleEngine.setInterval(intervals[activeInterval]);
  }

  // Subscribe on Hyperliquid
  hlSource.subscribeSymbol(sym);

  // Subscribe on Binance for reference
  const bnSymbol = symbolMap.toBinance(sym);
  binanceSource.subscribeSymbol(bnSymbol.replace('USDT', ''));

  // Check HL status
  const hlStatus = hlSource.getStatus();
  const subscribedTrades = hlStatus.connected && hlStatus.tradesSubscribed;
  const subscribedBook = hlStatus.connected;

  // Check if symbol exists on HL
  const existsOnHL = hlSource.coins.includes(sym);
  if (!existsOnHL && hlSource.coins.length > 0) {
    lastError = `Symbol ${sym} not found on Hyperliquid (${hlSource.coins.length} perps available)`;
  }

  const result = {
    ok: true,
    source: activeSource,
    symbol: sym,
    interval: activeInterval,
    subscribedTrades,
    subscribedBook,
    binanceSymbol: bnSymbol,
    availableOnBinance: symbolMap.binanceFuturesSymbols.has(bnSymbol),
    existsOnHL,
    lastError
  };

  // Broadcast to all UI clients
  emit('symbol_selected', result);
  emit('source_status', buildStatus());

  console.log(`[SELECT] ${sym} | source=${activeSource} | interval=${activeInterval} | HL=${existsOnHL} | Binance=${bnSymbol}`);
  return result;
}

// --- WebSocket Server (for UI clients) ---
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  uiClients.add(ws);
  console.log(`[UI] Client connected (${uiClients.size} total)`);

  // Send current state
  ws.send(JSON.stringify({ type: 'source_status', data: buildStatus() }));
  ws.send(JSON.stringify({ type: 'hl_coins', data: symbolMap.hlCoins ? [...symbolMap.hlCoins] : [] }));
  ws.send(JSON.stringify({ type: 'binance_symbols', data: symbolMap.binanceFuturesSymbols ? [...symbolMap.binanceFuturesSymbols] : [] }));

  // If there's an active symbol, send its data immediately
  if (activeSymbol) {
    const snapshot = candleEngine.getSnapshot(activeSymbol);
    ws.send(JSON.stringify({ type: 'snapshot', data: { symbol: activeSymbol, ...snapshot } }));
    ws.send(JSON.stringify({ type: 'zones', data: { symbol: activeSymbol, zones: activeZones.get(activeSymbol) || [] } }));
    ws.send(JSON.stringify({ type: 'symbol_selected', data: {
      source: activeSource, symbol: activeSymbol, interval: activeInterval,
      binanceSymbol: symbolMap.toBinance(activeSymbol),
      availableOnBinance: symbolMap.binanceFuturesSymbols.has(symbolMap.toBinance(activeSymbol))
    }}));
  }

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
    case 'subscribe_symbol': {
      const result = selectSymbol(msg.symbol, msg.source || activeSource, msg.interval || activeInterval);
      // Send snapshot to this specific client
      const snapshot = candleEngine.getSnapshot(msg.symbol);
      ws.send(JSON.stringify({ type: 'snapshot', data: { symbol: msg.symbol, ...snapshot } }));
      ws.send(JSON.stringify({ type: 'zones', data: { symbol: msg.symbol, zones: activeZones.get(msg.symbol) || [] } }));
      break;
    }

    case 'set_interval': {
      const intervals = { '10s': 10000, '20s': 20000, '40s': 40000, '1m': 60000, '3m': 180000, '5m': 300000 };
      if (intervals[msg.interval]) {
        candleEngine.setInterval(intervals[msg.interval]);
        activeInterval = msg.interval;
      }
      break;
    }

    case 'get_profile': {
      const allCandles = candleEngine.getCandles(msg.symbol, 2000);
      const filtered = allCandles.filter(c => c.openTime >= msg.start && c.openTime <= msg.end);
      const profile = ProfileEngine.compute(filtered, {
        priceLow: msg.priceLow,
        priceHigh: msg.priceHigh
      });
      profile.interpretation = ProfileEngine.interpret(profile);
      ws.send(JSON.stringify({ type: 'profile', data: { symbol: msg.symbol, profile } }));
      break;
    }

    case 'get_footprint': {
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
}

// --- Start ---
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ORDERFLOW COCKPIT — Professional Perp-Only`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Server:    http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Read src:  Hyperliquid (PRIMARY)`);
  console.log(`  Exec ref:  Binance USD-M (reference only)`);
  console.log(`  Spot:      DEBUG ONLY (disabled)`);
  console.log(`  Candles:   40s default`);
  console.log(`${'='.repeat(50)}\n`);

  // Connect Hyperliquid (PRIMARY)
  hlSource.connect();
  hlSource.fetchMeta();

  // Connect Binance USD-M for universe + reference
  binanceSource.fetchFuturesSymbols().then(() => {
    binanceSource.connectFutures();
  });

  // Start scanner
  scanner.start();

  // PHASE 2: Auto-load BTC after sources connect
  // Give sources 2 seconds to connect, then auto-load BTC
  setTimeout(() => {
    if (!activeSymbol) {
      console.log('[AUTO] Loading default symbol: BTC');
      selectSymbol('BTC', 'hyperliquid', '40s');
    }
  }, 2000);
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
