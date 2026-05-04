// Orderflow Cockpit — Full Rebuild
// Sections 3-18: Source architecture, symbol loading, 40s candles, zoom, bubbles, zones,
//               range profile, drawing tools, footprint, scanner, error handling, performance

(function() {
'use strict';

// ============ TOAST SYSTEM ============
function showToast(msg, type) {
  type = type || 'error';
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:42px;right:8px;z-index:9999;display:flex;flex-direction:column;gap:4px;pointer-events:none';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  const bg = type === 'error' ? 'rgba(239,68,68,0.9)' : type === 'warn' ? 'rgba(245,158,11,0.9)' : 'rgba(34,197,94,0.9)';
  t.style.cssText = `background:${bg};color:#fff;padding:6px 12px;border-radius:4px;font:11px monospace;pointer-events:auto;cursor:pointer;max-width:360px;box-shadow:0 2px 12px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.2s`;
  t.textContent = msg;
  t.onclick = function() { t.remove(); };
  container.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 5000);
  state._lastFrontendError = msg;
}

// ============ GLOBAL ERROR BOUNDARY ============
window.onerror = function(msg, src, line, col, err) {
  try { showToast('Error: ' + (msg || 'unknown') + '. Recovered.', 'error'); } catch(_) {}
  return true;
};
window.addEventListener('unhandledrejection', function(e) {
  try { showToast('Async error: ' + (e.reason?.message || e.reason || 'unknown') + '. Recovered.', 'error'); } catch(_) {}
});

// ============ STATE ============
const state = {
  symbol: null,
  interval: '40s',
  followLive: true,
  activeTool: 'cursor',
  source: 'hyperliquid',
  sourceStatus: {},
  symbolLoaded: false,
  symbolError: null,

  // Chart data
  candles: [],
  currentCandle: null,
  bubbles: [],
  zones: [],

  // View transform — professional zoom/pan
  view: {
    offsetX: 0,
    scaleX: 8,
    pricePerPixel: 0.05,
    scrollY: 0,
    userModified: false,
  },

  // Mouse
  mouse: { x: 0, y: 0, price: 0, isDown: false, button: 0, startX: 0, startY: 0 },
  hoveredCandle: null,
  hoveredBubble: null,

  // Drawing tools with localStorage
  drawings: [],
  drawingState: null,

  // Selected range
  selectedRange: null,

  // Scanner
  scannerData: [],
  scannerMode: 'top_attention',

  // WS
  ws: null,
  wsReady: false,

  // Canvas
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  dpr: 1,

  // Label deconfliction
  labelRects: [],

  // Auto scale
  autoScale: true,

  // Historical candle tracking
  historyLoaded: false,
  historyCount: 0,
  historySource: '',

  // Label density
  labelDensity: 'compact',

  // Error tracking
  _lastFrontendError: null,

  // Render dirty flag
  _priceScaleDirty: true,

  // Diagnostics
  _lastTradeTs: null,
  _totalTradeCount: 0,

  // Symbol loading state
  _loadingSymbol: false,
  _loadRetries: 0,
};

// ============ COLORS ============
const COL = {
  bg: '#0a0e17',
  grid: '#141c2b',
  gridText: '#3d4a5e',
  candleUp: '#22c55e',
  candleDown: '#ef4444',
  candleHistorical: '#374151',
  bubbleAcceptedBuy: '#22c55e',
  bubbleAcceptedSell: '#ef4444',
  bubbleRejected: '#ef4444',
  bubbleAbsorbed: '#f59e0b',
  bubbleExhausted: '#6b7280',
  zone: 'rgba(245,158,11,0.06)',
  zoneBorder: 'rgba(245,158,11,0.25)',
  poc: '#f59e0b',
  vah: '#3b82f6',
  val: '#3b82f6',
  deltaPoc: '#a855f7',
  hvn: 'rgba(59,130,246,0.12)',
  lvn: 'rgba(168,85,247,0.08)',
  crosshair: 'rgba(148,163,184,0.3)',
  selection: 'rgba(245,158,11,0.12)',
  selectionBorder: '#f59e0b',
  drawing: '#3b82f6',
  drawingActive: '#f59e0b',
};

// ============ HELPERS ============
function estimatePriceStep(ppp, h) {
  const totalRange = h * ppp;
  const steps = [0.0001,0.0002,0.0005,0.001,0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000];
  const target = totalRange / 8;
  for (const s of steps) { if (s >= target) return s; }
  return steps[steps.length - 1];
}

function fmtPrice(p) {
  if (p == null || isNaN(p)) return '—';
  if (Math.abs(p) >= 1000) return p.toFixed(1);
  if (Math.abs(p) >= 100) return p.toFixed(2);
  if (Math.abs(p) >= 1) return p.toFixed(3);
  if (Math.abs(p) >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
}

function symbolToBinance(s) {
  const sp = {PEPE:'1000PEPEUSDT',LUNC:'1000LUNCUSDT',SHIB:'1000SHIBUSDT',BONK:'1000BONKUSDT',FLOKI:'1000FLOKIUSDT',XEC:'1000XECUSDT',CAT:'1000CATSUSDT',RATS:'1000RATSUSDT'};
  return sp[s] || `${s}USDT`;
}

function safeNum(v, fallback) { return (v != null && isFinite(v)) ? v : (fallback || 0); }

// ============ HISTORICAL CANDLES ============
function fetchHistoricalCandles(symbol) {
  if (!symbol) return;
  const interval = state.interval || '1m';
  fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&count=300`)
    .then(r => r.json())
    .then(data => {
      if (data.ok && data.candles && data.candles.length > 0) {
        const existingTimes = new Set(state.candles.map(c => c.openTime));
        const newCandles = data.candles.filter(c => !existingTimes.has(c.openTime));
        state.candles = [...newCandles, ...state.candles];
        if (state.candles.length > 500) state.candles = state.candles.slice(-500);
        state.historyLoaded = true;
        state.historyCount = data.count;
        state.historySource = data.interval + ' historical';
        state._priceScaleDirty = true;
        state.symbolLoaded = true;
        updateRightPanel();
      } else {
        state.historySource = 'Building live history — no historical backfill available yet';
        state.symbolLoaded = true;
        updateRightPanel();
      }
    })
    .catch(() => {
      state.historySource = 'Building live history — no historical backfill available yet';
      state.symbolLoaded = true;
      updateRightPanel();
    });
}

// ============ WEBSOCKET ============
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);

  state.ws.onopen = () => {
    state.wsReady = true;
    if (state.symbol) {
      state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: state.symbol }));
    }
  };

  state.ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch(err) { showToast('WS message error: ' + err.message, 'error'); }
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    setTimeout(connectWS, 2000);
  };

  state.ws.onerror = () => {};
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'source_status':
      state.sourceStatus = msg.data;
      updateSourceUI();
      break;

    case 'candle':
      if (msg.data.symbol !== state.symbol) break;
      handleCandle(msg.data);
      break;

    case 'bubbles':
      if (msg.data.symbol !== state.symbol) break;
      for (const b of msg.data.bubbles) {
        b.candleTime = msg.data.candleTime;
        state.bubbles.push(b);
      }
      if (state.bubbles.length > 500) state.bubbles = state.bubbles.slice(-500);
      break;

    case 'snapshot':
      if (msg.data.symbol !== state.symbol) break;
      state.candles = (msg.data.historical || []).map(c => ({ ...c, priceMap: c.priceMap || {} }));
      state.currentCandle = msg.data.current || null;
      state.bubbles = [];
      for (const c of state.candles) {
        if (c.bubbles) {
          for (const b of c.bubbles) { b.candleTime = c.openTime; state.bubbles.push(b); }
        }
      }
      state.symbolLoaded = true;
      state._priceScaleDirty = true;
      updateRightPanel();
      if (state.followLive && !state.view.userModified) fitAll();
      break;

    case 'zones':
      if (msg.data.symbol !== state.symbol) break;
      state.zones = msg.data.zones || [];
      break;

    case 'profile':
      if (state.selectedRange) {
        state.selectedRange.profile = msg.data.profile;
        updateRangePanel();
      }
      break;

    case 'hl_coins':
      window.__hlCoins = msg.data || [];
      break;

    case 'symbol_selected':
      if (msg.data.symbol) {
        // This is the WS confirmation — state.symbol was already set from REST
        state.symbolLoaded = true;
        state._loadingSymbol = false;
        state._loadRetries = 0;
        state.symbolError = null;
        document.getElementById('symbol-input').value = msg.data.symbol;
        document.getElementById('fp-symbol').textContent = msg.data.symbol;
        updateRightPanel();
        updateSourceUI();
        loadDrawings();
      }
      break;
  }
}

function handleCandle(candle) {
  state._lastTradeTs = Date.now();
  state._totalTradeCount += candle.tradeCount || 0;
  const existing = state.candles.find(c => c.openTime === candle.openTime);
  if (existing) {
    Object.assign(existing, candle);
  } else {
    state.candles.push(candle);
  }
  if (state.candles.length > 500) state.candles = state.candles.slice(-500);
  state.currentCandle = null; // Will be set by next snapshot or live candle
  state._priceScaleDirty = true;

  // Extract bubbles from new candle
  if (candle.bubbles && candle.bubbles.length > 0) {
    for (const b of candle.bubbles) {
      b.candleTime = candle.openTime;
      state.bubbles.push(b);
    }
    if (state.bubbles.length > 500) state.bubbles = state.bubbles.slice(-500);
  }
}

// ============ CHART RENDERING ============
function initCanvas() {
  state.canvas = document.getElementById('chart-canvas');
  state.ctx = state.canvas.getContext('2d');
  state.dpr = window.devicePixelRatio || 1;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const rect = state.canvas.parentElement.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;
  state.canvas.width = state.width * state.dpr;
  state.canvas.height = state.height * state.dpr;
  state.canvas.style.width = state.width + 'px';
  state.canvas.style.height = state.height + 'px';
  state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

function render() {
  const ctx = state.ctx;
  const w = state.width;
  const h = state.height;

  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, h);

  // Status messages
  if (!state.symbol) {
    ctx.fillStyle = COL.gridText;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting to Hyperliquid...', w/2, h/2);
    ctx.font = '11px sans-serif';
    ctx.fillText('BTC will auto-load shortly', w/2, h/2 + 20);
    requestAnimationFrame(render);
    return;
  }

  if (!state.candles.length && !state.currentCandle) {
    ctx.fillStyle = COL.gridText;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Loading ${state.symbol}...`, w/2, h/2);
    ctx.font = '11px sans-serif';
    if (state.symbolError) {
      ctx.fillStyle = '#ef4444';
      ctx.fillText(state.symbolError, w/2, h/2 + 20);
    } else {
      ctx.fillText('Building 40s candles — waiting for trades...', w/2, h/2 + 20);
    }
    requestAnimationFrame(render);
    return;
  }

  const allCandles = [...state.candles];
  if (state.currentCandle) allCandles.push(state.currentCandle);
  if (!allCandles.length) { requestAnimationFrame(render); return; }

  const { offsetX, scaleX, pricePerPixel, scrollY } = state.view;
  const candleW = scaleX;
  const gap = Math.max(1, candleW * 0.15);
  const bodyW = candleW - gap;

  const priceCenter = scrollY + h / 2;
  const priceToY = (price) => priceCenter - (price / pricePerPixel);
  const yToPrice = (y) => (priceCenter - y) * pricePerPixel;

  const rightEdge = w - 60;
  const visibleCount = Math.ceil(w / candleW) + 2;
  const startIdx = Math.max(0, allCandles.length - visibleCount - Math.floor(offsetX / candleW));
  const endIdx = Math.min(allCandles.length, startIdx + visibleCount + 4);
  const visible = allCandles.slice(startIdx, endIdx);

  if (!visible.length) { requestAnimationFrame(render); return; }

  // Auto scale — only when dirty + follow live
  if (state.autoScale && state.followLive && !state.view.userModified && state._priceScaleDirty) {
    let minP = Infinity, maxP = -Infinity;
    for (const c of visible) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }
    const range = maxP - minP || 1;
    const targetPPP = range / (h * 0.85);
    state.view.pricePerPixel += (targetPPP - state.view.pricePerPixel) * 0.15;
    state.view.scrollY += (((minP + maxP) / 2) / state.view.pricePerPixel - h / 2 - state.view.scrollY) * 0.15;
    state._priceScaleDirty = false;
  }

  // Reset label deconfliction
  state.labelRects = [];

  drawGrid(ctx, w, h, priceToY, yToPrice, rightEdge);
  drawZones(ctx, w, h, priceToY, rightEdge);
  drawVolumeBars(ctx, visible, candleW, gap, priceToY, h, rightEdge);
  drawCandles(ctx, visible, candleW, gap, bodyW, priceToY, rightEdge);
  drawBubbles(ctx, visible, candleW, priceToY, rightEdge, scaleX);

  if (state.selectedRange) {
    drawSelectedRange(ctx, priceToY, yToPrice, rightEdge, allCandles);
  }

  drawDrawings(ctx, priceToY, rightEdge, allCandles);
  if (state.drawingState) drawActiveDrawing(ctx, priceToY, rightEdge, allCandles);

  drawPriceScale(ctx, w, h, yToPrice, rightEdge);
  drawCrosshair(ctx, w, h, rightEdge, yToPrice, priceToY, candleW, allCandles);
  drawTimeLabels(ctx, visible, candleW, h, rightEdge);

  requestAnimationFrame(render);
}

function drawGrid(ctx, w, h, priceToY, yToPrice, rightEdge) {
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 0.5;

  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topPrice = yToPrice(0);
  const botPrice = yToPrice(h);
  const startPrice = Math.floor(Math.min(topPrice, botPrice) / priceStep) * priceStep;

  ctx.beginPath();
  for (let p = startPrice; p <= Math.max(topPrice, botPrice); p += priceStep) {
    const y = priceToY(p);
    if (y < 0 || y > h) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(rightEdge, y);
  }
  ctx.stroke();

  ctx.beginPath();
  const candleCount = Math.floor(rightEdge / state.view.scaleX);
  for (let i = 0; i < candleCount; i += 5) {
    const x = rightEdge - i * state.view.scaleX;
    if (x < 0) break;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
}

function drawCandles(ctx, visible, candleW, gap, bodyW, priceToY, rightEdge) {
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const x = rightEdge - (visible.length - 1 - i) * candleW - candleW / 2;
    if (x < -candleW || x > rightEdge + candleW) continue;

    const isUp = c.close >= c.open;
    const isHistorical = c._historical || c._sourceInterval;
    let color = isUp ? COL.candleUp : COL.candleDown;
    if (isHistorical) color = COL.candleHistorical;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, priceToY(c.high));
    ctx.lineTo(x, priceToY(c.low));
    ctx.stroke();

    // Body
    const bodyTop = priceToY(Math.max(c.open, c.close));
    const bodyBot = priceToY(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    if (isHistorical) {
      ctx.fillStyle = 'rgba(55,65,81,0.6)';
      ctx.fillRect(x - bodyW/2, bodyTop, bodyW, bodyH);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW/2, bodyTop, bodyW, bodyH);
    }
  }
}

function drawVolumeBars(ctx, visible, candleW, gap, priceToY, h, rightEdge) {
  if (!visible.length) return;
  const maxVol = Math.max(...visible.map(c => c.volume || 0), 1);
  const barMaxH = h * 0.12;

  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const x = rightEdge - (visible.length - 1 - i) * candleW - candleW / 2;
    if (x < -candleW || x > rightEdge + candleW) continue;

    const barH = ((c.volume || 0) / maxVol) * barMaxH;
    const isUp = c.close >= c.open;
    const isHistorical = c._historical || c._sourceInterval;

    ctx.fillStyle = isHistorical ? 'rgba(55,65,81,0.2)' : (isUp ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)');
    ctx.fillRect(x - (candleW - gap)/2, h - barH, candleW - gap, barH);
  }
}

// ============ DEEPCHART-STYLE BUBBLE RENDERING ============
function drawBubbles(ctx, visible, candleW, priceToY, rightEdge, scaleX) {
  // Build clusters: group by candle + price band + side + state
  const clusters = [];
  const bandPx = Math.max(10, scaleX * 0.9);

  // Viewport culling — only process bubbles in visible candles
  const visibleTimes = new Set(visible.map(c => c.openTime));
  const visibleBubbles = state.bubbles.filter(b => visibleTimes.has(b.candleTime));

  for (const bubble of visibleBubbles) {
    const cIdx = visible.findIndex(c => c.openTime === bubble.candleTime);
    if (cIdx < 0) continue;
    const c = visible[cIdx];
    const x = rightEdge - (visible.length - 1 - cIdx) * candleW - candleW / 2;
    const y = priceToY(bubble.price);
    const st = bubble.state || 'accepted';

    if (st === 'invalidated') continue;

    // Find matching cluster
    let merged = false;
    for (const cl of clusters) {
      if (Math.abs(cl.x - x) < candleW * 0.8 && Math.abs(cl.y - y) < bandPx &&
          cl.side === bubble.side && cl.state === st) {
        cl.bubbles.push(bubble);
        cl.totalNotional += bubble.notional || 0;
        cl.totalQty += bubble.qty || 0;
        cl.y = (cl.y * (cl.bubbles.length - 1) + y) / cl.bubbles.length;
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        x, y, bubbles: [bubble], totalNotional: bubble.notional || 0,
        totalQty: bubble.qty || 0,
        side: bubble.side, state: st
      });
    }
  }

  // Draw clusters — Deepchart concentric ring style
  for (const cl of clusters) {
    const { x, y, bubbles: bubs, side, state: st } = cl;
    const count = bubs.length;
    // Radius scales by notional with sqrt — large prints look large
    const radius = Math.min(18, Math.max(4, Math.sqrt(cl.totalNotional / 500)));

    let mainColor;
    if (st === 'accepted') {
      mainColor = side === 'buy' ? COL.bubbleAcceptedBuy : COL.bubbleAcceptedSell;
    } else if (st === 'rejected') {
      mainColor = COL.bubbleRejected;
    } else if (st === 'absorbed') {
      mainColor = COL.bubbleAbsorbed;
    } else if (st === 'exhausted') {
      mainColor = COL.bubbleExhausted;
    } else {
      mainColor = side === 'buy' ? COL.bubbleAcceptedBuy : COL.bubbleAcceptedSell;
    }

    // --- Concentric ring rendering ---
    switch (st) {
      case 'accepted': {
        // Outer halo (fades out)
        const grad = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius * 1.4);
        grad.addColorStop(0, mainColor + 'aa');
        grad.addColorStop(0.6, mainColor + '44');
        grad.addColorStop(1, mainColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2); ctx.fill();

        // Main filled circle
        ctx.fillStyle = mainColor + 'bb';
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();

        // Inner bright core
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2); ctx.fill();

        // Solid border ring
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'rejected': {
        // Hollow with sharp outer ring
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();

        // Outer warning ring
        ctx.strokeStyle = mainColor + '44';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, radius + 3, 0, Math.PI * 2); ctx.stroke();

        // Very faint fill
        ctx.fillStyle = mainColor + '15';
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'absorbed': {
        // Halo/aura ring
        const grad = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 2);
        grad.addColorStop(0, mainColor + '66');
        grad.addColorStop(0.5, mainColor + '22');
        grad.addColorStop(1, mainColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, radius * 2, 0, Math.PI * 2); ctx.fill();

        // Inner circle
        ctx.fillStyle = mainColor + '88';
        ctx.beginPath(); ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2); ctx.fill();

        // Ring
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'exhausted': {
        // Faded
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Dashed ring
        ctx.strokeStyle = mainColor + '55';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, radius + 1, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
    }

    // --- Cluster count label ---
    if (count > 1 && state.labelDensity !== 'minimal') {
      // Show direction icon + count + state abbreviation
      const icon = side === 'buy' ? '▲' : '▼';
      const stateAbbr = st === 'accepted' ? '' : st === 'rejected' ? 'R' : st === 'absorbed' ? 'Ab' : 'Ex';
      const label = `${icon}${count}${stateAbbr}`;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y);
    }

    // Hover detection
    const dx = state.mouse.x - x;
    const dy = state.mouse.y - y;
    if (dx * dx + dy * dy < (radius + 6) * (radius + 6)) {
      state.hoveredBubble = {
        x, y, cluster: cl,
        mainBubble: bubs.reduce((a, b) => (b.notional || 0) > (a.notional || 0) ? b : a, bubs[0])
      };
    }
  }
}

// ============ ZONE RENDERING ============
function drawZones(ctx, w, h, priceToY, rightEdge) {
  for (const zone of state.zones) {
    const y1 = priceToY(zone.priceHigh);
    const y2 = priceToY(zone.priceLow);
    if (y2 < 0 || y1 > h) continue;

    const zoneH = y2 - y1;

    let fillCol, borderCol;
    if (zone.type.includes('BUY')) {
      fillCol = 'rgba(34,197,94,0.05)';
      borderCol = 'rgba(34,197,94,0.2)';
    } else if (zone.type.includes('SELL')) {
      fillCol = 'rgba(239,68,68,0.05)';
      borderCol = 'rgba(239,68,68,0.2)';
    } else {
      fillCol = COL.zone;
      borderCol = COL.zoneBorder;
    }
    if (zone.type.includes('DEFENSE')) {
      fillCol = zone.type.includes('BUY') ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';
    }
    if (zone.type.includes('ABSORPTION')) {
      fillCol = zone.type.includes('BUY') ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)';
    }

    // Fill band
    ctx.fillStyle = fillCol;
    ctx.fillRect(0, y1, rightEdge, zoneH);

    // Top/bottom borders
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(0, y1); ctx.lineTo(rightEdge, y1);
    ctx.moveTo(0, y2); ctx.lineTo(rightEdge, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Right-side compact label with deconfliction
    if (state.labelDensity !== 'minimal') {
      const shortType = zone.type
        .replace(/_ZONE/g, '')
        .replace(/BUYER_/g, 'B.')
        .replace(/SELLER_/g, 'S.')
        .replace(/BUY_/g, 'B.')
        .replace(/SELL_/g, 'S.')
        .replace(/ACCEPTANCE/g, 'ACC')
        .replace(/REJECTION/g, 'REJ')
        .replace(/ABSORPTION/g, 'ABS')
        .replace(/DEFENSE/g, 'DEF')
        .replace(/_/g, ' ');
      const labelY = (y1 + y2) / 2;
      const deconflicted = deconflictLabel(rightEdge - 4, labelY, shortType, 'right');

      ctx.fillStyle = borderCol;
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(shortType, deconflicted.x, deconflicted.y + 3);
    }
  }
}

// ============ LABEL DECONFLICTION ============
function deconflictLabel(x, y, text, anchor) {
  const estW = text.length * 5;
  const estH = 10;
  const padding = 3;

  let testY = y;
  let testX = x;
  let attempts = 0;
  const maxAttempts = 15;
  const step = 12;

  while (attempts < maxAttempts) {
    const rect = { x: testX - estW - padding, y: testY - estH/2 - padding, w: estW + padding*2, h: estH + padding*2 };
    let overlap = false;
    for (const r of state.labelRects) {
      if (rectsOverlap(rect, r)) { overlap = true; break; }
    }
    if (!overlap) {
      state.labelRects.push(rect);
      return { x: testX, y: testY };
    }
    testY += (attempts % 2 === 0 ? 1 : -1) * step * Math.ceil((attempts + 1) / 2);
    attempts++;
  }
  return { x: testX, y: testY };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ============ SELECTED RANGE ============
function drawSelectedRange(ctx, priceToY, yToPrice, rightEdge, allCandles) {
  const sr = state.selectedRange;
  if (!sr) return;

  let startIdx = allCandles.findIndex(c => c.openTime >= sr.start);
  let endIdx = allCandles.findIndex(c => c.openTime > sr.end);
  if (startIdx < 0) startIdx = 0;
  if (endIdx < 0) endIdx = allCandles.length - 1;

  const x1 = rightEdge - (allCandles.length - 1 - startIdx) * state.view.scaleX - state.view.scaleX / 2;
  const x2 = rightEdge - (allCandles.length - 1 - endIdx) * state.view.scaleX - state.view.scaleX / 2;

  const y1 = priceToY(sr.priceHigh);
  const y2 = priceToY(sr.priceLow);

  // Selection box
  ctx.fillStyle = COL.selection;
  ctx.fillRect(Math.min(x1,x2), y1, Math.abs(x2-x1), y2-y1);
  ctx.strokeStyle = COL.selectionBorder;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 2]);
  ctx.strokeRect(Math.min(x1,x2), y1, Math.abs(x2-x1), y2-y1);
  ctx.setLineDash([]);

  // Profile overlay
  if (sr.profile) {
    drawProfileOverlay(ctx, sr.profile, Math.min(x1,x2), y1, Math.abs(x2-x1), y2-y1, priceToY);
  }
}

function drawProfileOverlay(ctx, profile, boxX, boxY, boxW, boxH, priceToY) {
  if (!profile.levels || !profile.levels.length) return;

  const maxVol = Math.max(...profile.levels.map(l => l.total), 1);
  const maxDelta = Math.max(...profile.levels.map(l => Math.abs(l.delta)), 1);
  const profileW = boxW * 0.35;

  // Volume profile bars
  for (const level of profile.levels) {
    const y = priceToY(level.price);
    const barW = (level.total / maxVol) * profileW;
    const binH = Math.max(1, boxH / profile.levels.length);

    ctx.fillStyle = 'rgba(59,130,246,0.2)';
    ctx.fillRect(boxX, y - binH/2, barW, binH);

    // Delta overlay
    const deltaW = (Math.abs(level.delta) / maxDelta) * profileW * 0.3;
    ctx.fillStyle = level.delta > 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
    const dX = level.delta > 0 ? boxX + barW : boxX + barW - deltaW;
    ctx.fillRect(dX, y - binH/2, deltaW, binH);
  }

  // POC
  if (profile.poc) {
    const pocY = priceToY(profile.poc);
    ctx.strokeStyle = COL.poc;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(boxX, pocY); ctx.lineTo(boxX + boxW, pocY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.poc;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    const pocLabel = `POC ${fmtPrice(profile.poc)}`;
    const pocDeconf = deconflictLabel(boxX + 4, pocY - 4, pocLabel, 'left');
    ctx.fillText(pocLabel, pocDeconf.x, pocDeconf.y);
  }

  // VAH
  if (profile.vah) {
    const vahY = priceToY(profile.vah);
    ctx.strokeStyle = COL.vah;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(boxX, vahY); ctx.lineTo(boxX + boxW, vahY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.vah;
    ctx.font = '8px monospace';
    const vahLabel = `VAH ${fmtPrice(profile.vah)}`;
    const vahDeconf = deconflictLabel(boxX + 4, vahY - 3, vahLabel, 'left');
    ctx.fillText(vahLabel, vahDeconf.x, vahDeconf.y);
  }

  // VAL
  if (profile.val) {
    const valY = priceToY(profile.val);
    ctx.strokeStyle = COL.val;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(boxX, valY); ctx.lineTo(boxX + boxW, valY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.val;
    ctx.font = '8px monospace';
    const valLabel = `VAL ${fmtPrice(profile.val)}`;
    const valDeconf = deconflictLabel(boxX + 4, valY + 10, valLabel, 'left');
    ctx.fillText(valLabel, valDeconf.x, valDeconf.y);
  }

  // Delta POC
  if (profile.deltaPoc) {
    const dpY = priceToY(profile.deltaPoc);
    ctx.strokeStyle = COL.deltaPoc;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(boxX, dpY); ctx.lineTo(boxX + boxW, dpY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.deltaPoc;
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    const dpLabel = `ΔPOC ${fmtPrice(profile.deltaPoc)}`;
    const dpDeconf = deconflictLabel(boxX + boxW - 4, dpY - 3, dpLabel, 'right');
    ctx.fillText(dpLabel, dpDeconf.x, dpDeconf.y);
  }

  // HVN/LVN
  if (profile.hvns) {
    for (const hvn of profile.hvns) {
      const y = priceToY(hvn);
      ctx.fillStyle = COL.hvn;
      ctx.fillRect(boxX, y - 3, boxW, 6);
    }
  }
  if (profile.lvns) {
    for (const lvn of profile.lvns) {
      const y = priceToY(lvn);
      ctx.fillStyle = COL.lvn;
      ctx.fillRect(boxX, y - 2, boxW, 4);
    }
  }

  // Absorption/rejection markers
  for (const al of (profile.absorptionLevels || [])) {
    const y = priceToY(al.price);
    ctx.fillStyle = 'rgba(6,182,212,0.5)';
    ctx.fillRect(boxX + boxW - 6, y - 3, 6, 6);
  }
  for (const rl of (profile.rejectionLevels || [])) {
    const y = priceToY(rl.price);
    ctx.fillStyle = 'rgba(249,115,22,0.5)';
    ctx.fillRect(boxX + boxW - 6, y - 3, 6, 6);
  }
}

// ============ DRAWING TOOLS ============
function drawDrawings(ctx, priceToY, rightEdge, allCandles) {
  for (const d of state.drawings) {
    drawSingleDrawing(ctx, d, priceToY, rightEdge);
  }
}

function drawActiveDrawing(ctx, priceToY, rightEdge, allCandles) {
  drawSingleDrawing(ctx, state.drawingState, priceToY, rightEdge);
}

function drawSingleDrawing(ctx, d, priceToY, rightEdge) {
  if (!d) return;
  ctx.strokeStyle = d.color || COL.drawing;
  ctx.lineWidth = 1.5;

  switch (d.type) {
    case 'hline': {
      const y = priceToY(d.price);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rightEdge, y); ctx.stroke();
      ctx.fillStyle = d.color || COL.drawing;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      const lbl = `— ${fmtPrice(d.price)}`;
      const dc = deconflictLabel(4, y - 4, lbl, 'left');
      ctx.fillText(lbl, dc.x, dc.y);
      break;
    }
    case 'trendline': {
      const y1 = priceToY(d.price1);
      const y2 = priceToY(d.price2);
      ctx.beginPath(); ctx.moveTo(d.x1, y1); ctx.lineTo(d.x2, y2); ctx.stroke();
      break;
    }
    case 'rect': {
      const y1 = priceToY(d.priceHigh);
      const y2 = priceToY(d.priceLow);
      ctx.fillStyle = 'rgba(59,130,246,0.06)';
      ctx.fillRect(d.x1, y1, d.x2 - d.x1, y2 - y1);
      ctx.strokeRect(d.x1, y1, d.x2 - d.x1, y2 - y1);
      break;
    }
    case 'text': {
      const y = priceToY(d.price);
      ctx.fillStyle = d.color || COL.drawing;
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(d.text, d.x, y);
      break;
    }
  }
}

// ============ PRICE SCALE & CROSSHAIR ============
function drawPriceScale(ctx, w, h, yToPrice, rightEdge) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(rightEdge, 0, w - rightEdge, h);

  ctx.fillStyle = COL.gridText;
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';

  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topPrice = yToPrice(0);
  const botPrice = yToPrice(h);
  const startPrice = Math.floor(Math.min(topPrice, botPrice) / priceStep) * priceStep;

  for (let p = startPrice; p <= Math.max(topPrice, botPrice); p += priceStep) {
    const y = (state.view.scrollY + h/2) - (p / state.view.pricePerPixel);
    if (y < 10 || y > h-10) continue;
    ctx.fillText(fmtPrice(p), rightEdge + 4, y + 3);
  }

  if (state.currentCandle) {
    const cy = (state.view.scrollY + h/2) - (state.currentCandle.close / state.view.pricePerPixel);
    const isUp = state.currentCandle.close >= state.currentCandle.open;
    ctx.fillStyle = isUp ? COL.candleUp : COL.candleDown;
    ctx.fillRect(rightEdge, cy - 8, w - rightEdge, 16);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(fmtPrice(state.currentCandle.close), rightEdge + 4, cy + 4);
  }
}

function drawCrosshair(ctx, w, h, rightEdge, yToPrice, priceToY, candleW, allCandles) {
  if (state.mouse.x < 0 || state.mouse.x > w || state.mouse.y < 0 || state.mouse.y > h) return;
  if (state.mouse.x > rightEdge) return;

  ctx.strokeStyle = COL.crosshair;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(0, state.mouse.y); ctx.lineTo(rightEdge, state.mouse.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(state.mouse.x, 0); ctx.lineTo(state.mouse.x, h); ctx.stroke();
  ctx.setLineDash([]);

  const price = yToPrice(state.mouse.y);
  const label = document.getElementById('crosshair-label');
  if (label) {
    label.classList.remove('hidden');
    label.style.left = (rightEdge + 2) + 'px';
    label.style.top = (state.mouse.y - 10) + 'px';
    label.textContent = fmtPrice(price);
  }

  updateTooltip(allCandles, candleW, rightEdge);
}

function drawTimeLabels(ctx, visible, candleW, h, rightEdge) {
  ctx.fillStyle = COL.gridText;
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';

  for (let i = 0; i < visible.length; i += 10) {
    const c = visible[i];
    const x = rightEdge - (visible.length - 1 - i) * candleW - candleW / 2;
    const t = new Date(c.openTime);
    ctx.fillText(`${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`, x, h - 4);
  }
}

// ============ TOOLTIP ============
function updateTooltip(allCandles, candleW, rightEdge) {
  const tooltip = document.getElementById('hover-tooltip');
  if (!tooltip) return;

  // Candle hover
  const visibleCount = Math.floor(state.width / candleW) + 2;
  const si = Math.max(0, allCandles.length - visibleCount - Math.floor(state.view.offsetX / candleW));
  const idx = Math.floor((rightEdge - state.mouse.x) / candleW);
  const candleIdx = allCandles.length - 1 - (si + (visibleCount - 1 - idx));

  if (candleIdx >= 0 && candleIdx < allCandles.length) {
    const c = allCandles[candleIdx];
    state.hoveredCandle = c;
    const t = new Date(c.openTime);
    const timeStr = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`;

    tooltip.classList.remove('hidden');
    tooltip.style.left = (state.mouse.x + 15) + 'px';
    tooltip.style.top = (state.mouse.y - 10) + 'px';
    tooltip.innerHTML = `
      <div style="color:#94a3b8;margin-bottom:4px">${timeStr}</div>
      <div>O: ${fmtPrice(c.open)} H: ${fmtPrice(c.high)}</div>
      <div>L: ${fmtPrice(c.low)} C: ${fmtPrice(c.close)}</div>
      <div>Vol: ${fmtNum(c.volume)} | Δ: ${c.delta>0?'+':''}${fmtNum(c.delta)}</div>
      <div>Trades: ${c.tradeCount} | Bubbles: ${c.bubbleCount||0}</div>
      <div>Absorb: ${c.absorptionCount||0} | Reject: ${c.rejectionCount||0}</div>
    `;
  } else {
    tooltip.classList.add('hidden');
  }

  // Bubble hover
  if (state.hoveredBubble) {
    const b = state.hoveredBubble;
    tooltip.classList.remove('hidden');
    tooltip.style.left = (b.x + 20) + 'px';
    tooltip.style.top = (b.y - 20) + 'px';
    const bub = b.mainBubble;
    const cl = b.cluster;
    const bubs = cl.bubbles;

    const prices = bubs.map(bb => bb.price);
    const priceRange = prices.length > 1 ? `${fmtPrice(Math.min(...prices))} — ${fmtPrice(Math.max(...prices))}` : fmtPrice(prices[0]);
    const buyCount = bubs.filter(bb => bb.side === 'buy').length;
    const sellCount = bubs.filter(bb => bb.side === 'sell').length;
    const stateCounts = {};
    for (const bb of bubs) { const s = bb.state || 'accepted'; stateCounts[s] = (stateCounts[s] || 0) + 1; }
    const stateBreakdown = Object.entries(stateCounts).map(([s, n]) => `${n} ${s}`).join(' / ');

    const isCluster = bubs.length > 1;
    const title = isCluster ? `Bubble Cluster — ${bubs.length} bubbles` : `Bubble — ${bub.side.toUpperCase()} ${cl.state}`;

    let color = bub.side === 'buy' ? '#22c55e' : '#ef4444';
    if (cl.state === 'absorbed') color = '#f59e0b';
    if (cl.state === 'exhausted') color = '#6b7280';

    let interpText = '';
    if (cl.state === 'accepted' && buyCount > sellCount) interpText = 'Buy aggression accepted — upward pressure';
    else if (cl.state === 'accepted' && sellCount > buyCount) interpText = 'Sell aggression accepted — downward pressure';
    else if (cl.state === 'rejected') interpText = 'Aggression rejected — liquidity held';
    else if (cl.state === 'absorbed') interpText = 'Volume absorbed — potential reversal zone';
    else if (cl.state === 'exhausted') interpText = 'Aggression exhausted — momentum fading';

    tooltip.innerHTML = `
      <div style="color:${color};font-weight:bold;margin-bottom:4px">${title}</div>
      <div style="color:#94a3b8">Price: ${fmtPrice(bub.price)}</div>
      ${isCluster ? `<div style="color:#94a3b8">Range: ${priceRange}</div>` : ''}
      <div style="margin-top:3px">Size: ${fmtNum(bub.qty)} | $${fmtNum(bub.notional)}</div>
      ${isCluster ? `<div>Cluster total: $${fmtNum(cl.totalNotional)}</div>` : ''}
      <div style="border-top:1px solid #1e293b;margin:4px 0;padding-top:3px">
        <div>Side: <span style="color:${buyCount>0?'#22c55e':'#94a3b8'}">${buyCount} buy</span> / <span style="color:${sellCount>0?'#ef4444':'#94a3b8'}">${sellCount} sell</span></div>
        <div>State: ${stateBreakdown}</div>
      </div>
      <div style="color:#94a3b8;font-style:italic;margin-top:3px">${interpText}</div>
    `;
    state.hoveredBubble = null;
  }
}

// ============ INPUT HANDLING ============
function initInput() {
  const canvas = state.canvas;

  canvas.addEventListener('mousemove', (e) => {
    try {
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = e.clientX - rect.left;
      state.mouse.y = e.clientY - rect.top;
      state.mouse.price = (state.view.scrollY + state.height/2 - state.mouse.y) * state.view.pricePerPixel;

      // Drag pan
      if (state.mouse.isDown && state.mouse.button === 0 && state.activeTool === 'cursor') {
        state.view.offsetX += e.movementX / state.view.scaleX;
        state.view.scrollY -= e.movementY;
        state.view.userModified = true;
        state.followLive = false;
        document.getElementById('btn-follow-live').classList.remove('active');
      }

      if (state.drawingState && state.mouse.isDown) {
        updateDrawingState(state.mouse.x, state.mouse.price);
      }
    } catch(err) { showToast('Mouse error: ' + err.message, 'error'); }
  });

  canvas.addEventListener('mousedown', (e) => {
    try {
      state.mouse.isDown = true;
      state.mouse.button = e.button;
      state.mouse.startX = e.clientX;
      state.mouse.startY = e.clientY;
      if (e.button === 0) handleToolClick(e);
    } catch(err) { showToast('Click error: ' + err.message, 'error'); }
  });

  canvas.addEventListener('mouseup', (e) => {
    try {
      if (state.drawingState && state.mouse.isDown) finalizeDrawing();
      state.mouse.isDown = false;
    } catch(err) { showToast('Mouse error: ' + err.message, 'error'); }
  });

  // Professional zoom — Section 7: wheel zooms BOTH time and price
  canvas.addEventListener('wheel', (e) => {
    try {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const rightEdge = state.width - 60;

      const factor = e.deltaY > 0 ? 1.1 : 0.9;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+wheel: price-only zoom around cursor
        const cursorPrice = (state.view.scrollY + state.height / 2 - mouseY) * state.view.pricePerPixel;
        state.view.pricePerPixel *= factor;
        state.view.scrollY = cursorPrice / state.view.pricePerPixel - state.height / 2 + mouseY;
      } else if (e.shiftKey) {
        // Shift+wheel: horizontal pan
        state.view.offsetX -= e.deltaY / state.view.scaleX;
      } else {
        // Default: zoom BOTH time and price axes around cursor
        // Time axis zoom
        const oldScaleX = state.view.scaleX;
        const newScaleX = Math.max(2, Math.min(80, oldScaleX * factor));
        state.view.scaleX = newScaleX;

        // Price axis zoom
        const cursorPrice = (state.view.scrollY + state.height / 2 - mouseY) * state.view.pricePerPixel;
        state.view.pricePerPixel *= factor;
        state.view.scrollY = cursorPrice / state.view.pricePerPixel - state.height / 2 + mouseY;
      }
      state.view.userModified = true;
      state.followLive = false;
      state._priceScaleDirty = true;
      document.getElementById('btn-follow-live').classList.remove('active');
    } catch(err) { showToast('Zoom error: ' + err.message, 'error'); }
  }, { passive: false });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    try {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      switch (e.key) {
        case 'Escape':
          if (state.drawingState) {
            state.drawingState = null;
          } else if (state.activeTool !== 'cursor') {
            setActiveTool('cursor');
            state.selectedRange = null;
            updateRangePanel();
          } else {
            state.selectedRange = null;
            updateRangePanel();
          }
          break;
        case 'r': case 'R': setActiveTool('range'); break;
        case 'Delete': case 'Backspace': deleteSelectedDrawing(); break;
        case 'f': case 'F': fitAll(); break;
      }
    } catch(err) { showToast('Key error: ' + err.message, 'error'); }
  });
}

function handleToolClick(e) {
  try {
    const x = state.mouse.x;
    const price = state.mouse.price;

    switch (state.activeTool) {
      case 'cursor': break;
      case 'hline':
        state.drawings.push({ type: 'hline', price, color: COL.drawing });
        saveDrawings();
        setActiveTool('cursor');
        break;
      case 'trendline':
        if (!state.drawingState) {
          state.drawingState = { type: 'trendline', x1: x, price1: price, x2: x, price2: price, color: COL.drawing };
        }
        break;
      case 'rect':
        if (!state.drawingState) {
          state.drawingState = { type: 'rect', x1: x, price1: price, x2: x, price2: price, color: COL.drawing };
        }
        break;
      case 'text':
        const text = prompt('Enter label:');
        if (text) {
          state.drawings.push({ type: 'text', x, price, text, color: COL.drawing });
          saveDrawings();
        }
        setActiveTool('cursor');
        break;
      case 'range':
        if (!state.drawingState) {
          state.drawingState = { type: 'range', x1: x, price1: price, x2: x, price2: price };
        }
        break;
    }
  } catch(err) { showToast('Tool error: ' + err.message, 'error'); }
}

function updateDrawingState(x, price) {
  if (!state.drawingState) return;
  state.drawingState.x2 = x;
  state.drawingState.price2 = price;
  if (state.drawingState.type === 'rect' || state.drawingState.type === 'range') {
    state.drawingState.priceHigh = Math.max(state.drawingState.price1, price);
    state.drawingState.priceLow = Math.min(state.drawingState.price1, price);
  }
}

function finalizeDrawing() {
  const d = state.drawingState;
  if (!d) return;

  if (d.type === 'range') {
    const allCandles = [...state.candles];
    if (state.currentCandle) allCandles.push(state.currentCandle);
    const priceHigh = Math.max(d.price1, d.price2);
    const priceLow = Math.min(d.price1, d.price2);

    const matchingCandles = allCandles.filter(c => {
      const mid = (c.high + c.low) / 2;
      return mid >= priceLow && mid <= priceHigh;
    });

    if (matchingCandles.length > 0) {
      const start = matchingCandles[0].openTime;
      const end = matchingCandles[matchingCandles.length - 1].openTime;
      state.selectedRange = { start, end, priceLow, priceHigh, profile: null };

      if (state.wsReady && state.symbol) {
        state.ws.send(JSON.stringify({
          type: 'get_profile', symbol: state.symbol,
          start, end, priceLow, priceHigh
        }));
      }
    }
  } else if (d.type === 'trendline' || d.type === 'rect') {
    state.drawings.push({ ...d });
    saveDrawings();
  }

  state.drawingState = null;
}

function deleteSelectedDrawing() {
  if (state.drawings.length > 0) {
    state.drawings.pop();
    saveDrawings();
  }
}

function saveDrawings() {
  if (!state.symbol) return;
  const key = `drawings_${state.symbol}`;
  try { localStorage.setItem(key, JSON.stringify(state.drawings)); } catch(e) {}
}

function loadDrawings() {
  if (!state.symbol) return;
  const key = `drawings_${state.symbol}`;
  try {
    const saved = localStorage.getItem(key);
    state.drawings = saved ? JSON.parse(saved) : [];
  } catch(e) { state.drawings = []; }
}

// ============ UI UPDATES ============
function fitAll() {
  state.view.offsetX = 0;
  state.followLive = true;
  state.view.userModified = false;
  state._priceScaleDirty = true;
  document.getElementById('btn-follow-live').classList.add('active');
}

function setActiveTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  const cursorMap = {
    cursor: 'grab',
    hline: 'crosshair',
    trendline: 'crosshair',
    rect: 'crosshair',
    range: 'crosshair',
    text: 'text',
    delete: 'not-allowed'
  };
  state.canvas.style.cursor = cursorMap[tool] || 'crosshair';

  const toolNames = {
    cursor: 'Cursor',
    hline: 'Horizontal Line — click to place',
    trendline: 'Trend Line — drag to draw',
    rect: 'Rectangle — drag to draw',
    range: 'Range Profile — drag to select',
    text: 'Text Label — click to place',
    delete: 'Delete — click a drawing to remove'
  };
  const bar = document.getElementById('tool-status-bar');
  if (bar) bar.textContent = 'Active Tool: ' + (toolNames[tool] || tool);
}

// Source UI — Section 3: truthful perp-first display
function updateSourceUI() {
  const ss = state.sourceStatus;
  const pill = document.getElementById('active-source');
  const quality = document.getElementById('data-quality');
  const execRef = document.getElementById('exec-ref');
  const warning = document.getElementById('fallback-warning');

  const hlConnected = ss.hyperliquidConnected || (ss.hyperliquid && ss.hyperliquid.connected) || false;
  const hlTradesSub = ss.hyperliquidTradesSubscribed || (ss.hyperliquid && ss.hyperliquid.tradesSubscribed) || false;
  const hlBookSub = ss.hyperliquidBookSubscribed || (ss.hyperliquid && ss.hyperliquid.bookSubscribed) || false;
  const lastTrade = ss.lastTradeTs || (ss.hyperliquid && ss.hyperliquid.lastTradeTs) || null;

  if (hlConnected && state.symbolLoaded) {
    pill.textContent = 'HL';
    pill.classList.add('active');
    const tradeAge = lastTrade ? Date.now() - lastTrade : Infinity;
    if (tradeAge < 30000) quality.textContent = 'Quality: Good';
    else if (tradeAge < 120000) quality.textContent = 'Quality: Stale';
    else quality.textContent = 'Quality: Waiting';
  } else if (hlConnected && !state.symbolLoaded) {
    pill.textContent = 'HL';
    pill.classList.add('active');
    quality.textContent = 'Quality: Loading...';
  } else {
    pill.textContent = '—';
    pill.classList.remove('active');
    quality.textContent = 'Quality: Disconnected';
  }

  if (warning) warning.classList.add('hidden');

  if (state.symbol) {
    execRef.textContent = `Exec: ${symbolToBinance(state.symbol)}`;
    execRef.classList.remove('dim');
  } else {
    execRef.textContent = 'Exec: —';
    execRef.classList.add('dim');
  }

  // Source panel — detailed truth
  const bnWsConn = ss.binanceUsdmLiveTradeReceiving || (ss.binanceUsdm && ss.binanceUsdm.futuresWsConnected) || false;
  const bnRefConn = ss.binanceUsdmReferenceConnected || (ss.binanceUsdm && ss.binanceUsdm.restConnected) || false;
  const sc = document.getElementById('source-content');
  if (!sc) return;

  sc.innerHTML = `
    <div class="row"><span class="label">Read source:</span><span class="val green">Hyperliquid</span></div>
    <div class="row"><span class="label">HL connected:</span><span class="val ${hlConnected?'green':'red'}">${hlConnected?'yes':'no'}</span></div>
    <div class="row"><span class="label">HL trades sub:</span><span class="val ${hlTradesSub?'green':'red'}">${hlTradesSub?'yes':'no'}</span></div>
    <div class="row"><span class="label">HL book sub:</span><span class="val ${hlBookSub?'green':''}">${hlBookSub?'active':'off'}</span></div>
    <div class="row"><span class="label">HL last trade:</span><span class="val">${lastTrade ? new Date(lastTrade).toLocaleTimeString() : '—'}</span></div>
    <div class="row"><span class="label">HL coins:</span><span class="val">${ss.hyperliquidSubscribedCoins || (ss.hyperliquid && ss.hyperliquid.subscribedCoins) || 0}</span></div>
    <div style="border-top:1px solid #1e293b;margin:4px 0"></div>
    <div class="row"><span class="label">Exec ref:</span><span class="val">Binance USD-M</span></div>
    <div class="row"><span class="label">BN reference:</span><span class="val ${bnRefConn?'green':'yellow'}">${bnRefConn?'connected':'reference only'}</span></div>
    <div class="row"><span class="label">BN aggTrade:</span><span class="val ${bnWsConn?'green':'yellow'}">${bnWsConn?'receiving':'not active'}</span></div>
    <div class="row"><span class="label">BN forceOrder:</span><span class="val" style="color:#475569">not active</span></div>
    <div class="row"><span class="label">BN bookTicker:</span><span class="val" style="color:#475569">not active</span></div>
    <div class="row"><span class="label">BN markPrice:</span><span class="val" style="color:#475569">not active</span></div>
    <div style="border-top:1px solid #1e293b;margin:4px 0"></div>
    <div class="row"><span class="label">Spot debug:</span><span class="val" style="color:#475569">disabled</span></div>
    ${!bnWsConn && bnRefConn ? '<div style="margin-top:4px;font-size:9px;color:#f59e0b">Binance USD-M reference only — live orderflow not active.</div>' : ''}
  `;
}

function updateRightPanel() {
  const auction = document.getElementById('auction-content');
  if (!auction) return;

  const hl = state.sourceStatus.hyperliquid || {};
  const tradeCount = state.sourceStatus.hyperliquidTradeCount || hl.tradeCount || 0;

  if (state.symbol && state.symbolLoaded) {
    auction.innerHTML = `
      <div class="row"><span class="label">Symbol:</span><span class="val">${state.symbol}</span></div>
      <div class="row"><span class="label">Read:</span><span class="val green">Hyperliquid</span></div>
      <div class="row"><span class="label">Exec ref:</span><span class="val">${symbolToBinance(state.symbol)}</span></div>
      <div class="row"><span class="label">Interval:</span><span class="val">${state.interval}</span></div>
      <div class="row"><span class="label">Trades:</span><span class="val">${tradeCount}</span></div>
      <div class="row"><span class="label">Candles:</span><span class="val">${state.candles.length}</span></div>
      <div class="row"><span class="label">History:</span><span class="val ${state.historyLoaded?'green':''}">${state.historyLoaded ? state.historyCount + ' × ' + state.historySource : state.historySource || 'loading...'}</span></div>
      <div class="row"><span class="label">Bubbles:</span><span class="val">${state.bubbles.length}</span></div>
      <div class="row"><span class="label">Zones:</span><span class="val">${state.zones.length}</span></div>
    `;
  } else if (state.symbol) {
    auction.innerHTML = `<div style="color:#f59e0b">Loading ${state.symbol}...</div>`;
  } else {
    auction.innerHTML = '<div style="color:#475569">No symbol selected</div>';
  }
}

function updateRangePanel() {
  const el = document.getElementById('range-content');
  if (!el) return;
  const sr = state.selectedRange;

  if (!sr) { el.innerHTML = 'Select a range on chart'; return; }
  if (!sr.profile) { el.innerHTML = '<div style="color:#f59e0b">Computing profile...</div>'; return; }

  const p = sr.profile;
  const tStart = new Date(sr.start);
  const tEnd = new Date(sr.end);

  el.innerHTML = `
    <div class="row"><span class="label">Time:</span><span class="val">${tStart.toTimeString().slice(0,8)} → ${tEnd.toTimeString().slice(0,8)}</span></div>
    <div class="row"><span class="label">Range:</span><span class="val">${fmtPrice(sr.priceLow)} — ${fmtPrice(sr.priceHigh)}</span></div>
    <div class="row"><span class="label">Volume:</span><span class="val">${fmtNum(p.totalVolume)}</span></div>
    <div class="row"><span class="label">Buy Vol:</span><span class="val green">${fmtNum(p.buyVolume)}</span></div>
    <div class="row"><span class="label">Sell Vol:</span><span class="val red">${fmtNum(p.sellVolume)}</span></div>
    <div class="row"><span class="label">Delta:</span><span class="val ${p.delta>0?'green':'red'}">${p.delta>0?'+':''}${fmtNum(p.delta)}</span></div>
    <div class="row"><span class="label">POC:</span><span class="val" style="color:#f59e0b">${fmtPrice(p.poc)}</span></div>
    <div class="row"><span class="label">VAH:</span><span class="val" style="color:#3b82f6">${fmtPrice(p.vah)}</span></div>
    <div class="row"><span class="label">VAL:</span><span class="val" style="color:#3b82f6">${fmtPrice(p.val)}</span></div>
    <div class="row"><span class="label">ΔPOC:</span><span class="val" style="color:#a855f7">${fmtPrice(p.deltaPoc)}</span></div>
    <div class="row"><span class="label">VWAP:</span><span class="val">${fmtPrice(p.vwap)}</span></div>
    <div class="row"><span class="label">Side:</span><span class="val ${p.dominantSide==='buy'?'green':p.dominantSide==='sell'?'red':''}">${p.dominantSide}</span></div>
    <div class="row"><span class="label">Efficiency:</span><span class="val">${(p.directionalEfficiency*100).toFixed(1)}%</span></div>
    <div class="row"><span class="label">Bubbles:</span><span class="val">${p.bubbleCount} (A:${p.bubbleStates.accepted} R:${p.bubbleStates.rejected} Ab:${p.bubbleStates.absorbed})</span></div>
    <div style="margin-top:6px;padding:4px;background:rgba(245,158,11,0.08);border-radius:3px;font-size:9px;color:#94a3b8">
      ${p.interpretation||'—'}
    </div>
  `;
}

// Diagnostics panel
function updateDiagnostics() {
  const el = document.getElementById('diag-content');
  if (!el || document.getElementById('diagnostics-panel').classList.contains('hidden')) return;

  const ss = state.sourceStatus;
  const hlConnected = ss.hyperliquidConnected || (ss.hyperliquid && ss.hyperliquid.connected) || false;
  const hlTradesSub = ss.hyperliquidTradesSubscribed || false;
  const hlBookSub = ss.hyperliquidBookSubscribed || false;
  const lastTrade = ss.lastTradeTs || null;
  const lastBook = ss.lastBookTs || null;
  const bnWsConn = ss.binanceUsdmLiveTradeReceiving || false;
  const wsState = state.ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][state.ws.readyState] || 'unknown' : 'none';

  el.innerHTML = `
    <div class="diag-section">Connection</div>
    <div class="diag-row"><span class="dlabel">Symbol</span><span class="dval">${state.symbol || '—'}</span></div>
    <div class="diag-row"><span class="dlabel">Interval</span><span class="dval">${state.interval}</span></div>
    <div class="diag-row"><span class="dlabel">HL WS</span><span class="dval ${hlConnected?'green':'red'}">${hlConnected?'connected':'disconnected'}</span></div>
    <div class="diag-row"><span class="dlabel">Client WS</span><span class="dval ${wsState==='OPEN'?'green':'red'}">${wsState}</span></div>
    <div class="diag-row"><span class="dlabel">Trades sub</span><span class="dval ${hlTradesSub?'green':'red'}">${hlTradesSub?'yes':'no'}</span></div>
    <div class="diag-row"><span class="dlabel">Book sub</span><span class="dval ${hlBookSub?'green':''}">${hlBookSub?'yes':'no'}</span></div>
    <div class="diag-row"><span class="dlabel">BN aggTrade</span><span class="dval ${bnWsConn?'green':'yellow'}">${bnWsConn?'receiving':'not active'}</span></div>
    <div class="diag-section">Data</div>
    <div class="diag-row"><span class="dlabel">Last trade</span><span class="dval">${lastTrade ? new Date(lastTrade).toLocaleTimeString() : '—'}</span></div>
    <div class="diag-row"><span class="dlabel">Candles</span><span class="dval">${state.candles.length}</span></div>
    <div class="diag-row"><span class="dlabel">Bubbles</span><span class="dval">${state.bubbles.length}</span></div>
    <div class="diag-row"><span class="dlabel">History</span><span class="dval ${state.historyLoaded?'green':''}">${state.historyLoaded ? state.historyCount + ' (' + state.historySource + ')' : 'no'}</span></div>
    <div class="diag-section">View</div>
    <div class="diag-row"><span class="dlabel">Tool</span><span class="dval">${state.activeTool}</span></div>
    <div class="diag-row"><span class="dlabel">Follow live</span><span class="dval ${state.followLive?'green':'yellow'}">${state.followLive?'ON':'OFF'}</span></div>
    <div class="diag-row"><span class="dlabel">Auto scale</span><span class="dval">${state.autoScale?'ON':'OFF'}</span></div>
    <div class="diag-row"><span class="dlabel">scaleX</span><span class="dval">${state.view.scaleX.toFixed(1)}</span></div>
    <div class="diag-row"><span class="dlabel">pricePerPixel</span><span class="dval">${state.view.pricePerPixel.toFixed(4)}</span></div>
    <div class="diag-section">Errors</div>
    <div class="diag-row"><span class="dlabel">Last error</span><span class="dval red">${state._lastFrontendError || 'none'}</span></div>
    <div class="diag-row"><span class="dlabel">Backend error</span><span class="dval red">${ss.lastError || 'none'}</span></div>
  `;
}

// Scanner UI
function updateScannerUI() {
  const body = document.getElementById('scanner-body');
  if (!body) return;
  const data = state.scannerData;

  if (!data || !data.ok || !data.rows || !data.rows.length) {
    const reason = data?.reason || 'loading';
    const hydrated = data?.hydrated || {};
    let msg;
    switch (reason) {
      case 'universe_not_loaded':
        msg = `Hydrating... HL=${hydrated.hyperliquid?'✓':'...'} Binance=${hydrated.binance?'✓':'...'}`;
        break;
      case 'no_price_data':
        msg = 'Universes loaded — waiting for trade data...';
        break;
      default:
        msg = 'Loading scanner data...';
    }
    body.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#475569">${msg}</td></tr>`;
    return;
  }

  body.innerHTML = data.rows.map(s => `
    <tr class="${s.hlSymbol===state.symbol?'selected':''}" onclick="window.__selectSymbol('${s.hlSymbol}')">
      <td><strong>${s.hlSymbol}</strong>${s.isPinned?'<span class="pinned-badge">★</span>':''}${s.isWatchlist?'<span class="watchlist-badge">◆</span>':''}</td>
      <td><span class="tag-status tag-${s.statusTag}">${s.statusTag}</span></td>
      <td>${fmtPrice(s.price)}</td>
      <td style="color:${s.change24h>0?'#22c55e':'#ef4444'}">${s.change24h>0?'+':''}${s.change24h.toFixed(2)}%</td>
      <td>${fmtNum(s.volume)}</td>
      <td style="color:${s.delta>0?'#22c55e':'#ef4444'}">${s.delta>0?'+':''}${fmtNum(s.delta)}</td>
      <td>${s.tradeFrequency.toFixed(1)}/s</td>
      <td>${s.volatilityExpansion.toFixed(2)}%</td>
      <td>${s.bubbleCount}</td>
      <td>${s.absorptionCount+s.rejectionCount}</td>
      <td>${s.availableOnBinance?s.binanceSymbol:'<span style="color:#475569">—</span>'}</td>
      <td><span class="tag-status tag-${s.statusTag}" style="font-size:8px">${s.zoneCount||0}</span></td>
    </tr>
  `).join('');
}

// ============ BUTTONS ============
function initButtons() {
  document.getElementById('btn-follow-live').addEventListener('click', () => {
    state.followLive = !state.followLive;
    state.view.userModified = !state.followLive;
    document.getElementById('btn-follow-live').classList.toggle('active', state.followLive);
    if (state.followLive) fitAll();
  });

  document.getElementById('btn-fit-all').addEventListener('click', fitAll);

  document.getElementById('btn-reset').addEventListener('click', () => {
    state.view = { offsetX: 0, scaleX: 8, pricePerPixel: 0.05, scrollY: 0, userModified: false };
    state.followLive = true;
    state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.add('active');
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.view.scaleX = Math.min(80, state.view.scaleX * 1.3);
    state.view.pricePerPixel *= 0.85;
    state.view.userModified = true;
    state.followLive = false;
    state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.view.scaleX = Math.max(2, state.view.scaleX / 1.3);
    state.view.pricePerPixel *= 1.15;
    state.view.userModified = true;
    state.followLive = false;
    state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.remove('active');
  });

  document.getElementById('btn-auto-scale').addEventListener('click', () => {
    state.autoScale = !state.autoScale;
    document.getElementById('btn-auto-scale').classList.toggle('active', state.autoScale);
    if (state.autoScale) state._priceScaleDirty = true;
  });

  document.getElementById('btn-label-density').addEventListener('click', () => {
    const modes = ['compact', 'detailed', 'minimal'];
    const idx = modes.indexOf(state.labelDensity);
    state.labelDensity = modes[(idx + 1) % modes.length];
    const btn = document.getElementById('btn-label-density');
    btn.title = 'Label Density: ' + state.labelDensity;
    btn.textContent = state.labelDensity === 'minimal' ? '◻ Labels' : state.labelDensity === 'detailed' ? '◉◉ Labels' : '◉ Labels';
  });

  document.getElementById('btn-diagnostics').addEventListener('click', () => {
    const panel = document.getElementById('diagnostics-panel');
    panel.classList.toggle('hidden');
    document.getElementById('btn-diagnostics').classList.toggle('active', !panel.classList.contains('hidden'));
    if (!panel.classList.contains('hidden')) updateDiagnostics();
  });
  document.getElementById('btn-close-diag').addEventListener('click', () => {
    document.getElementById('diagnostics-panel').classList.add('hidden');
    document.getElementById('btn-diagnostics').classList.remove('active');
  });

  document.getElementById('btn-reset-ui').addEventListener('click', () => {
    try {
      state.activeTool = 'cursor';
      state.drawingState = null;
      state.hoveredCandle = null;
      state.hoveredBubble = null;
      state.selectedRange = null;
      state.view = { offsetX: 0, scaleX: 8, pricePerPixel: 0.05, scrollY: 0, userModified: false };
      state.followLive = true;
      state._priceScaleDirty = true;
      state._lastFrontendError = null;
      document.getElementById('btn-follow-live').classList.add('active');
      document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === 'cursor');
      });
      document.getElementById('hover-tooltip').classList.add('hidden');
      document.getElementById('crosshair-label').classList.add('hidden');
      showToast('UI state reset', 'info');
    } catch(err) { showToast('Reset error: ' + err.message, 'error'); }
  });

  document.getElementById('btn-reconnect').addEventListener('click', () => {
    try {
      if (state.symbol) {
        selectSymbol(state.symbol);
        showToast('Reconnecting to ' + state.symbol + '...', 'warn');
      }
    } catch(err) { showToast('Reconnect error: ' + err.message, 'error'); }
  });

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'delete') deleteSelectedDrawing();
      else setActiveTool(btn.dataset.tool);
    });
  });

  document.getElementById('interval-select').addEventListener('change', (e) => {
    state.interval = e.target.value;
    if (state.wsReady) {
      state.ws.send(JSON.stringify({ type: 'set_interval', interval: state.interval }));
    }
  });

  // Symbol input
  const symInput = document.getElementById('symbol-input');
  const symDropdown = document.getElementById('symbol-dropdown');

  symInput.addEventListener('focus', () => showSymbolDropdown(symInput.value.toUpperCase()));
  symInput.addEventListener('input', (e) => showSymbolDropdown(e.target.value.toUpperCase()));
  symInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = symInput.value.toUpperCase().trim();
      if (val) selectSymbol(val);
      symDropdown.classList.add('hidden');
    }
  });
  symInput.addEventListener('blur', () => setTimeout(() => symDropdown.classList.add('hidden'), 200));

  document.getElementById('scanner-mode').addEventListener('change', (e) => {
    state.scannerMode = e.target.value;
    fetchScannerData();
  });

  document.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // No source-select dropdown — Hyperliquid is the only read source
}

function showSymbolDropdown(filter) {
  const dropdown = document.getElementById('symbol-dropdown');
  const coins = window.__hlCoins || [];
  const filtered = filter ? coins.filter(c => c.startsWith(filter)).slice(0, 30) : coins.slice(0, 30);
  if (!filtered.length) { dropdown.classList.add('hidden'); return; }
  dropdown.classList.remove('hidden');
  dropdown.innerHTML = filtered.map(c => `
    <div class="dropdown-item" onclick="window.__selectSymbol('${c}')">
      <span>${c}</span>
      <span class="tag">${symbolToBinance(c)}</span>
    </div>
  `).join('');
}

// ============ SYMBOL SELECTION — Section 4: Bulletproof ============
function selectSymbol(symbol) {
  const sym = symbol.toUpperCase().trim();
  if (!sym) return;
  if (state._loadingSymbol) return; // Prevent double-clicks

  state._loadingSymbol = true;
  state.symbol = sym; // Set immediately — don't wait for WS
  state.symbolError = null;
  state.candles = [];
  state.currentCandle = null;
  state.bubbles = [];
  state.zones = [];
  state.selectedRange = null;
  state.symbolLoaded = false;
  state.historyLoaded = false;
  state.historyCount = 0;
  state.historySource = '';
  state._priceScaleDirty = true;

  document.getElementById('symbol-input').value = sym;
  document.getElementById('fp-symbol').textContent = sym;

  updateRangePanel();
  updateRightPanel();
  updateSourceUI();

  // REST call — primary path
  fetch('/api/select-symbol', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hyperliquid', symbol: sym, interval: state.interval })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      if (data.lastError) {
        state.symbolError = data.lastError;
        showToast(data.lastError, 'warn');
      }
      // If server already has candles, they'll come via snapshot WS message
      // If not, fetch historical
      if (!data.historicalCandlesLoaded) {
        fetchHistoricalCandles(sym);
      }
    } else {
      state.symbolError = data.error || 'Failed to load symbol';
      showToast('Symbol error: ' + (data.error || 'unknown'), 'error');
      state._loadingSymbol = false;
    }
  })
  .catch(err => {
    state.symbolError = 'Network error — retrying via WebSocket';
    showToast('REST error: ' + err.message + '. Using WS fallback.', 'warn');
    // Fallback to WS
    if (state.wsReady) {
      state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: sym }));
    }
    fetchHistoricalCandles(sym);
    state._loadingSymbol = false;
  });

  // Also send WS subscribe (parallel path — one will succeed)
  if (state.wsReady) {
    state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: sym }));
  }

  // Always try to fetch historical candles
  fetchHistoricalCandles(sym);

  fetchScannerData();
  loadDrawings();
}

window.__selectSymbol = selectSymbol;

// ============ SCANNER FETCH ============
let scannerTimer = null;
function fetchScannerData() {
  fetch(`/api/scanner?mode=${state.scannerMode}`)
    .then(r => r.json())
    .then(data => {
      state.scannerData = data;
      updateScannerUI();
    })
    .catch(() => {});
}

function startScannerPolling() {
  fetchScannerData();
  scannerTimer = setInterval(fetchScannerData, 5000);
}

// ============ FOOTPRINT PANEL ============
function updateFootprint() {
  if (!state.symbol) return;

  fetch(`/orderflow/footprint?symbol=${state.symbol}`)
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById('footprint-content');
      if (!el) return;
      if (!data.levels || !Object.keys(data.levels).length) {
        el.innerHTML = '<div style="color:#475569">No footprint data — taker-side footprint proxy</div>';
        return;
      }

      const levels = Object.entries(data.levels)
        .map(([price, l]) => ({ price: parseFloat(price), ...l }))
        .sort((a, b) => b.price - a.price);

      const maxTotal = Math.max(...levels.map(l => l.total), 1);
      const pocPrice = data.candle ? ((data.candle.high + data.candle.low) / 2) : 0;

      el.innerHTML = `
        <div style="color:#475569;font-size:9px;margin-bottom:4px">taker-side footprint proxy</div>
        ${levels.map(l => {
          const delta = l.buy - l.sell;
          const isPoc = Math.abs(l.price - pocPrice) < (data.candle?.high || 1) * 0.001;
          const imbalance = l.total > 0 ? Math.abs(l.delta) / l.total : 0;
          const imbColor = imbalance > 0.6 ? '#f59e0b' : '#475569';
          return `
            <div class="fp-row ${isPoc?'poc':''}">
              <span class="price-col">${fmtPrice(l.price)}</span>
              <span class="buy-col"><span class="bar buy" style="width:${l.buy/maxTotal*80}px"></span> ${fmtNum(l.buy)}</span>
              <span class="sell-col">${fmtNum(l.sell)} <span class="bar sell" style="width:${l.sell/maxTotal*80}px"></span></span>
              <span class="delta-col" style="color:${delta>0?'#22c55e':'#ef4444'}">${delta>0?'+':''}${fmtNum(delta)}</span>
              <span style="width:30px;text-align:right;font-size:8px;color:${imbColor}">${(imbalance*100).toFixed(0)}%</span>
            </div>
          `;
        }).join('')}
      `;
    })
    .catch(() => {});
}

// ============ STATUS POLLING ============
function startStatusPolling() {
  setInterval(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(status => {
        state.sourceStatus = status;
        updateSourceUI();
        updateRightPanel();
        updateDiagnostics();
      })
      .catch(() => {});
  }, 5000);
}

// ============ INIT ============
function init() {
  initCanvas();
  initInput();
  initButtons();
  connectWS();
  startScannerPolling();
  startStatusPolling();

  setInterval(updateFootprint, 3000);

  requestAnimationFrame(render);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
