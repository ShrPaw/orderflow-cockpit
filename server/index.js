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
    // Hyperliquid — primary read source
    hyperliquidConnected: hlStatus.connected,
    hyperliquidTradesSubscribed: hlStatus.connected && hlStatus.tradesSubscribed,
    hyperliquidBookSubscribed: hlStatus.bookSubscribed,
    hyperliquidActiveSymbol: hlStatus.activeSymbol,
    hyperliquidTradeCount: hlStatus.tradeCount,
    hyperliquidBookUpdateCount: hlStatus.bookUpdateCount,
    hyperliquidSubscribedCoins: hlStatus.subscribedCoins,
    hyperliquidTradeCountForSymbol: hlStatus.tradeCountForSymbol,
    lastTradeTs: hlStatus.lastTradeTs,
    lastBookTs: hlStatus.lastBookTs,
    // Binance USD-M — reference only
    binanceUsdmReferenceConnected: bnStatus.restConnected,
    binanceUsdmLiveTradeReceiving: bnStatus.futuresWsConnected,
    binanceUsdmForceOrderReceiving: false,
    binanceUsdmBookTickerReceiving: false,
    binanceUsdmMarkPriceReceiving: false,
    // Spot debug
    spotDebugEnabled: binanceSource.spotDebugEnabled,
    spotDebugActive: binanceSource.spotDebugActive,
    // Cockpit state
    candles: candleCount,
    currentCandle: !!currentCandle,
    bubbles: currentCandle ? currentCandle.bubbleCount : 0,
    zones: zones.length,
    scannerRows: scanner.stats.size,
    scannerHydrated: scanner.hydrated,
    lastError: lastError,
    // Legacy fields for backward compat
    hyperliquid: hlStatus,
    binanceUsdm: bnStatus,
    spotDebug: {
      enabled: binanceSource.spotDebugEnabled,
      active: binanceSource.spotDebugActive
    }
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
  const avgVol = recent.reduce((s, r) => s + r.volume, 0) / recent.length;

  // Absorption zones (tight range + high volume)
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    const range = c.high - c.low;
    const mid = (c.high + c.low) / 2;
    if (mid === 0) continue;

    if (range / mid < 0.003 && c.volume > 0) {
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

  // Acceptance zones (consecutive same-side delta candles)
  let buyStreak = 0, sellStreak = 0;
  let buyRange = { high: -Infinity, low: Infinity };
  let sellRange = { high: -Infinity, low: Infinity };
  for (const c of recent) {
    if (c.delta > 0) {
      buyStreak++;
      buyRange.high = Math.max(buyRange.high, c.high);
      buyRange.low = Math.min(buyRange.low, c.low);
      sellStreak = 0;
      if (buyStreak >= 3) {
        zones.push({
          type: 'BUY_ACCEPTANCE_ZONE',
          priceLow: buyRange.low,
          priceHigh: buyRange.high,
          strength: buyStreak,
          candleTime: c.openTime
        });
      }
    } else if (c.delta < 0) {
      sellStreak++;
      sellRange.high = Math.max(sellRange.high, c.high);
      sellRange.low = Math.min(sellRange.low, c.low);
      buyStreak = 0;
      if (sellStreak >= 3) {
        zones.push({
          type: 'SELL_ACCEPTANCE_ZONE',
          priceLow: sellRange.low,
          priceHigh: sellRange.high,
          strength: sellStreak,
          candleTime: c.openTime
        });
      }
    } else {
      buyStreak = 0; sellStreak = 0;
      buyRange = { high: -Infinity, low: Infinity };
      sellRange = { high: -Infinity, low: Infinity };
    }
  }

  // Defense zones (high volume at price level held against aggression)
  if (recent.length >= 5) {
    const last5 = recent.slice(-5);
    const last5Avg = last5.reduce((s, c) => s + c.volume, 0) / 5;
    for (let i = 1; i < last5.length - 1; i++) {
      const c = last5[i];
      if (c.volume > last5Avg * 2) {
        const range = c.high - c.low;
        const mid = (c.high + c.low) / 2;
        if (mid > 0 && range / mid < 0.005) {
          if (c.delta > 0) {
            zones.push({
              type: 'BUYER_DEFENSE_ZONE',
              priceLow: c.low,
              priceHigh: c.high,
              strength: c.volume / last5Avg,
              candleTime: c.openTime
            });
          } else {
            zones.push({
              type: 'SELLER_DEFENSE_ZONE',
              priceLow: c.low,
              priceHigh: c.high,
              strength: c.volume / last5Avg,
              candleTime: c.openTime
            });
          }
        }
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

  // PHASE 3: GET /api/history — fetch historical candles from Hyperliquid
  if (pathname === '/api/history') {
    const symbol = url.searchParams.get('symbol');
    const interval = url.searchParams.get('interval') || '1m';
    const count = parseInt(url.searchParams.get('count') || '300');

    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'symbol required' }));
      return;
    }

    // Hyperliquid has 1m, 3m, 5m, 15m, 1h etc — no 40s. Fetch 1m for context.
    const hlInterval = '1m';
    const endTime = Date.now();
    const startTime = endTime - count * 60000; // 1m candles

    const postData = JSON.stringify({
      type: 'candleSnapshot',
      req: { coin: symbol.toUpperCase(), interval: hlInterval, startTime, endTime }
    });

    const options = {
      hostname: 'api.hyperliquid.xyz',
      port: 443,
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };

    const https = require('https');
    const proxyReq = https.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try {
          const raw = JSON.parse(data);
          if (!Array.isArray(raw)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'unexpected response', raw: data.slice(0, 200) }));
            return;
          }

          // Convert HL candle format to internal format
          const candles = raw.map(c => ({
            openTime: c.t,
            closeTime: c.t + 60000,
            open: parseFloat(c.o),
            high: parseFloat(c.h),
            low: parseFloat(c.l),
            close: parseFloat(c.c),
            volume: parseFloat(c.v) || 0,
            buyVolume: parseFloat(c.v || 0) * 0.5,
            sellVolume: parseFloat(c.v || 0) * 0.5,
            delta: 0,
            tradeCount: 0,
            maxTradeSize: 0,
            largeTradeCount: 0,
            bubbleCount: 0,
            absorptionCount: 0,
            rejectionCount: 0,
            bubbles: [],
            priceMap: {},
            _historical: true,
            _sourceInterval: hlInterval
          }));

          // Also inject into candle engine so symbol switches preserve data
          for (const c of candles) {
            candleEngine.injectHistorical(symbol.toUpperCase(), c);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            symbol: symbol.toUpperCase(),
            interval: hlInterval,
            requestedInterval: interval,
            count: candles.length,
            candles
          }));
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'parse error: ' + e.message }));
        }
      });
    });
    proxyReq.on('error', (e) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'request failed: ' + e.message }));
    });
    proxyReq.write(postData);
    proxyReq.end();
    return;
  }

  // PHASE 3: GET /api/scanner — full scanner response
  if (pathname === '/api/scanner') {
    const mode = url.searchParams.get('mode') || 'top_attention';
    const result = scanner.getScannerResponse(mode);
    // Update zone counts for each row
    if (result.ok && result.rows) {
      for (const row of result.rows) {
        const zones = activeZones.get(row.hlSymbol);
        row.zoneCount = zones ? zones.length : 0;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
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

  if (pathname === '/api/symbols/check') {
    const sym = url.searchParams.get('symbol');
    if (!sym) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'symbol required' }));
      return;
    }
    const coin = sym.toUpperCase().replace('USDT', '').replace('1000', '');
    const existsOnHL = hlSource.coins.includes(coin);
    const bnSymbol = symbolMap.toBinance(coin);
    const existsOnBN = symbolMap.binanceFuturesSymbols.has(bnSymbol);
    const matchType = symbolMap.specialMappings[coin] ? 'special' : 'standard';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      symbol: coin,
      existsOnHyperliquid: existsOnHL,
      existsOnBinanceUsdm: existsOnBN,
      mappedSymbol: bnSymbol,
      matchType,
      confidence: existsOnHL && existsOnBN ? 'high' : existsOnHL ? 'hl_only' : existsOnBN ? 'bn_only' : 'none'
    }));
    return;
  }

  if (pathname === '/api/symbols/overlap') {
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

// --- Symbol selection logic ---
function selectSymbol(symbol, source, interval) {
  const sym = symbol.toUpperCase().trim();
  if (!sym) return { ok: false, error: 'empty symbol' };

  // Validate source — only hyperliquid is a valid read source
  const src = 'hyperliquid'; // Force hyperliquid regardless of what was passed

  activeSymbol = sym;
  activeSource = src;
  activeInterval = interval || '40s';
  lastError = null;

  // Set candle interval
  const intervals = { '10s': 10000, '20s': 20000, '40s': 40000, '1m': 60000, '3m': 180000, '5m': 300000 };
  if (intervals[activeInterval]) {
    candleEngine.setInterval(intervals[activeInterval]);
  }

  // Subscribe on Hyperliquid (primary read source)
  hlSource.subscribeSymbol(sym);

  // Subscribe on Binance for reference mapping only
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
  } else if (!hlStatus.connected) {
    lastError = 'Hyperliquid WebSocket not connected — retrying...';
  }

  // Check how many candles already exist for this symbol
  const existingCandles = candleEngine.getCandles(sym, 2000).length;
  const currentCandle = candleEngine.getCurrentCandle(sym);
  const historicalCandlesLoaded = existingCandles > 0 || !!currentCandle;

  const result = {
    ok: true,
    source: activeSource,
    symbol: sym,
    interval: activeInterval,
    tradesSubscribed: subscribedTrades,
    bookSubscribed: subscribedBook,
    binanceSymbol: bnSymbol,
    availableOnBinance: symbolMap.binanceFuturesSymbols.has(bnSymbol),
    existsOnHL,
    historicalCandlesLoaded,
    candleCount: existingCandles,
    hasCurrentCandle: !!currentCandle,
    lastError
  };

  // Broadcast to all UI clients
  emit('symbol_selected', result);
  emit('source_status', buildStatus());

  console.log(`[SELECT] ${sym} | source=${activeSource} | interval=${activeInterval} | HL=${existsOnHL} | candles=${existingCandles} | Binance=${bnSymbol}`);
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
