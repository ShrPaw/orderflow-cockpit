// Orderflow Cockpit — Deepchart Scalper Rebuild
// Canvas chart with right-padding viewport, bubble circles, range profile

(function() {
'use strict';

// ============ CONSTANTS ============
const RIGHT_PADDING_CANDLES = 12;
const MIN_SCALE_X = 3;
const MAX_SCALE_X = 80;
const BUBBLE_MIN_R = 3;
const BUBBLE_MAX_R = 18;
const CLUSTER_BAND_PX = 14;

// ============ TOAST ============
function showToast(msg, type) {
  type = type || 'error';
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.style.cssText = 'position:fixed;top:42px;right:8px;z-index:9999;display:flex;flex-direction:column;gap:4px;pointer-events:none'; document.body.appendChild(c); }
  const t = document.createElement('div');
  const bg = type === 'error' ? 'rgba(239,68,68,0.9)' : type === 'warn' ? 'rgba(245,158,11,0.9)' : 'rgba(34,197,94,0.9)';
  t.style.cssText = `background:${bg};color:#fff;padding:6px 12px;border-radius:4px;font:11px monospace;pointer-events:auto;cursor:pointer;max-width:360px;box-shadow:0 2px 12px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.2s`;
  t.textContent = msg; t.onclick = () => t.remove();
  c.appendChild(t);
  requestAnimationFrame(() => t.style.opacity = '1');
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 5000);
}

// Global error boundary
window.onerror = function(msg) { try { showToast('Error: ' + (msg || 'unknown'), 'error'); } catch(_) {} return true; };
window.addEventListener('unhandledrejection', function(e) { try { showToast('Async error: ' + (e.reason?.message || e.reason || 'unknown'), 'error'); } catch(_) {} });

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

  candles: [],
  currentCandle: null,
  bubbles: [],
  zones: [],

  // Viewport
  view: {
    candleWidth: 8,       // pixels per candle
    pricePerPixel: 0.05,
    scrollX: 0,           // horizontal scroll (candle units from right)
    scrollY: 0,           // vertical scroll (pixels)
    userModified: false,
  },

  mouse: { x: 0, y: 0, price: 0, isDown: false, button: 0, dragStartX: 0, dragStartScrollX: 0 },
  hoveredCandle: null,
  hoveredBubble: null,

  drawings: [],
  drawingState: null,
  selectedRange: null,

  scannerData: [],
  scannerMode: 'top_attention',

  ws: null,
  wsReady: false,
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  dpr: 1,

  autoScale: true,
  historyLoaded: false,
  historyCount: 0,
  historySource: '',
  labelDensity: 'compact',
  _lastFrontendError: null,
  _priceScaleDirty: true,
  _loadingSymbol: false,

  // Price scale right-side width
  priceScaleWidth: 60,
};

// ============ COLORS ============
const COL = {
  bg: '#0a0e17', grid: '#141c2b', gridText: '#3d4a5e',
  candleUp: '#22c55e', candleDown: '#ef4444', candleHistorical: '#374151',
  bubblePending: '#f59e0b',
  bubbleAcceptedBuy: '#22c55e', bubbleAcceptedSell: '#ef4444',
  bubbleRejectedBuy: '#ef4444', bubbleRejectedSell: '#22c55e',
  bubbleAbsorbed: '#06b6d4',
  bubbleExhausted: '#6b7280',
  bubbleInvalidated: '#1e293b',
  crosshair: 'rgba(148,163,184,0.3)',
  selection: 'rgba(245,158,11,0.12)', selectionBorder: '#f59e0b',
  drawing: '#3b82f6', poc: '#f59e0b', vah: '#3b82f6', val: '#3b82f6', deltaPoc: '#a855f7',
};

// ============ HELPERS ============
function fmtPrice(p) { if (p == null || isNaN(p)) return '—'; if (Math.abs(p) >= 1000) return p.toFixed(1); if (Math.abs(p) >= 100) return p.toFixed(2); if (Math.abs(p) >= 1) return p.toFixed(3); if (Math.abs(p) >= 0.01) return p.toFixed(4); return p.toFixed(6); }
function fmtNum(n) { if (n == null || isNaN(n)) return '—'; if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(1)+'B'; if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+'M'; if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toFixed(0); }
function symbolToBinance(s) { const sp = {PEPE:'1000PEPEUSDT',LUNC:'1000LUNCUSDT',SHIB:'1000SHIBUSDT',BONK:'1000BONKUSDT',FLOKI:'1000FLOKIUSDT',XEC:'1000XECUSDT',CAT:'1000CATSUSDT',RATS:'1000RATSUSDT'}; return sp[s] || `${s}USDT`; }
function estimatePriceStep(ppp, h) { const totalRange = h * ppp; const steps = [0.0001,0.0002,0.0005,0.001,0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000]; const target = totalRange / 8; for (const s of steps) { if (s >= target) return s; } return steps[steps.length - 1]; }

// ============ HISTORICAL CANDLES ============
function fetchHistoricalCandles(symbol) {
  if (!symbol) return;
  fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${state.interval}&count=300`)
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
        state.historySource = 'Building live history — no backfill available yet';
        state.symbolLoaded = true;
        updateRightPanel();
      }
    })
    .catch(() => {
      state.historySource = 'Building live history — no backfill available yet';
      state.symbolLoaded = true;
      updateRightPanel();
    });
}

// ============ WEBSOCKET ============
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);
  state.ws.onopen = () => { state.wsReady = true; if (state.symbol) state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: state.symbol })); };
  state.ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch(err) { showToast('WS error: ' + err.message, 'error'); } };
  state.ws.onclose = () => { state.wsReady = false; setTimeout(connectWS, 2000); };
  state.ws.onerror = () => {};
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'source_status': state.sourceStatus = msg.data; updateSourceUI(); break;
    case 'candle': if (msg.data.symbol === state.symbol) handleCandle(msg.data); break;
    case 'bubbles':
      if (msg.data.symbol === state.symbol) {
        for (const b of msg.data.bubbles) { b.candleTime = msg.data.candleTime; state.bubbles.push(b); }
        if (state.bubbles.length > 3000) state.bubbles = state.bubbles.slice(-3000);
      }
      break;
    case 'snapshot':
      if (msg.data.symbol === state.symbol) {
        state.candles = (msg.data.historical || []).map(c => ({ ...c, priceMap: c.priceMap || {} }));
        state.currentCandle = msg.data.current || null;
        state.bubbles = [];
        for (const c of state.candles) { if (c.bubbles) for (const b of c.bubbles) { b.candleTime = c.openTime; state.bubbles.push(b); } }
        state.symbolLoaded = true;
        state._priceScaleDirty = true;
        updateRightPanel();
        if (state.followLive && !state.view.userModified) fitAll();
      }
      break;
    case 'zones': if (msg.data.symbol === state.symbol) state.zones = msg.data.zones || []; break;
    case 'profile': if (state.selectedRange) { state.selectedRange.profile = msg.data.profile; updateRangePanel(); } break;
    case 'hl_coins': window.__hlCoins = msg.data || []; break;
    case 'symbol_selected':
      if (msg.data.symbol) {
        state.symbolLoaded = true; state._loadingSymbol = false; state.symbolError = null;
        document.getElementById('symbol-input').value = msg.data.symbol;
        document.getElementById('fp-symbol').textContent = msg.data.symbol;
        updateRightPanel(); updateSourceUI(); loadDrawings();
      }
      break;
  }
}

function handleCandle(candle) {
  const existing = state.candles.find(c => c.openTime === candle.openTime);
  if (existing) Object.assign(existing, candle);
  else state.candles.push(candle);
  if (state.candles.length > 500) state.candles = state.candles.slice(-500);
  state.currentCandle = null;
  state._priceScaleDirty = true;
  if (candle.bubbles && candle.bubbles.length > 0) {
    for (const b of candle.bubbles) { b.candleTime = candle.openTime; state.bubbles.push(b); }
    if (state.bubbles.length > 3000) state.bubbles = state.bubbles.slice(-3000);
  }
}

// ============ VIEWPORT SYSTEM ============
// All candle indices are from the RIGHT. Index 0 = newest candle.
// The chart draws candles right-to-left, with RIGHT_PADDING_CANDLES of empty space after the newest.

function getVisibleRange() {
  const cw = state.view.candleWidth;
  const rightEdge = state.width - state.priceScaleWidth;
  const visibleCandleCount = Math.ceil(rightEdge / cw) + 2;
  const paddingOffset = state.view.scrollX; // how many candles scrolled from live

  const allCandles = getAllCandles();
  const totalCandles = allCandles.length;

  // Rightmost visible candle index (from right, 0=newest)
  const rightmostFromRight = paddingOffset + RIGHT_PADDING_CANDLES;
  // Leftmost visible candle index from right
  const leftmostFromRight = rightmostFromRight + visibleCandleCount;

  // Convert to array indices
  const endIdx = Math.max(0, totalCandles - 1 - Math.floor(rightmostFromRight));
  const startIdx = Math.max(0, totalCandles - 1 - Math.ceil(leftmostFromRight));

  return { startIdx, endIdx, visibleCandleCount, allCandles, rightEdge };
}

function getAllCandles() {
  const all = [...state.candles];
  if (state.currentCandle) all.push(state.currentCandle);
  return all;
}

function candleX(index, totalCandles, rightEdge, candleWidth, scrollX) {
  // X position: newest candle is at (rightEdge - RIGHT_PADDING_CANDLES * candleWidth - scrollX * candleWidth)
  const newestX = rightEdge - RIGHT_PADDING_CANDLES * candleWidth - scrollX * candleWidth;
  const offset = (totalCandles - 1 - index) * candleWidth;
  return newestX - offset;
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

  const allCandles = getAllCandles();

  if (!state.symbol || !allCandles.length) {
    ctx.fillStyle = COL.gridText;
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    if (!state.symbol) {
      ctx.fillText('Connecting to Hyperliquid...', w/2, h/2);
      ctx.font = '11px monospace';
      ctx.fillText('BTC will auto-load', w/2, h/2 + 20);
    } else {
      ctx.fillText(`Loading ${state.symbol}...`, w/2, h/2);
      ctx.font = '11px monospace';
      ctx.fillStyle = state.symbolError ? '#ef4444' : COL.gridText;
      ctx.fillText(state.symbolError || 'Building live 40s history…', w/2, h/2 + 20);
    }
    requestAnimationFrame(render);
    return;
  }

  const { startIdx, endIdx, rightEdge } = getVisibleRange();
  const cw = state.view.candleWidth;
  const gap = Math.max(1, cw * 0.15);
  const bodyW = cw - gap;

  // Price scale
  const priceCenter = state.view.scrollY + h / 2;
  const priceToY = (price) => priceCenter - (price / state.view.pricePerPixel);
  const yToPrice = (y) => (priceCenter - y) * state.view.pricePerPixel;

  // Visible candles
  const visible = allCandles.slice(startIdx, endIdx + 1);
  if (!visible.length) { requestAnimationFrame(render); return; }

  // Auto scale
  if (state.autoScale && state.followLive && !state.view.userModified && state._priceScaleDirty) {
    let minP = Infinity, maxP = -Infinity;
    for (const c of visible) { if (c.low < minP) minP = c.low; if (c.high > maxP) maxP = c.high; }
    // Include bubble extremes
    const visibleTimes = new Set(visible.map(c => c.openTime));
    for (const b of state.bubbles) { if (visibleTimes.has(b.candleTime)) { if (b.price < minP) minP = b.price; if (b.price > maxP) maxP = b.price; } }
    const range = maxP - minP || 1;
    const targetPPP = range / (h * 0.8);
    state.view.pricePerPixel += (targetPPP - state.view.pricePerPixel) * 0.15;
    state.view.scrollY += (((minP + maxP) / 2) / state.view.pricePerPixel - h / 2 - state.view.scrollY) * 0.15;
    state._priceScaleDirty = false;
  }

  // Draw layers
  drawGrid(ctx, w, h, rightEdge, priceToY, yToPrice);
  drawZones(ctx, h, rightEdge, priceToY, allCandles.length, cw);
  drawVolumeBars(ctx, visible, startIdx, allCandles.length, cw, gap, priceToY, h, rightEdge);
  drawCandles(ctx, visible, startIdx, allCandles.length, cw, gap, bodyW, priceToY, rightEdge);
  drawBubbles(ctx, allCandles, startIdx, endIdx, cw, priceToY, rightEdge);

  if (state.selectedRange) drawSelectedRange(ctx, priceToY, rightEdge, allCandles, cw);
  drawDrawings(ctx, priceToY, rightEdge, allCandles, cw);
  if (state.drawingState) drawActiveDrawing(ctx, priceToY, rightEdge);

  drawPriceScale(ctx, w, h, yToPrice, rightEdge);
  drawCrosshair(ctx, w, h, rightEdge, yToPrice, priceToY, cw, allCandles);
  drawTimeLabels(ctx, visible, startIdx, allCandles.length, cw, h, rightEdge);

  requestAnimationFrame(render);
}

function drawGrid(ctx, w, h, rightEdge, priceToY, yToPrice) {
  ctx.strokeStyle = COL.grid; ctx.lineWidth = 0.5;
  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topPrice = yToPrice(0); const botPrice = yToPrice(h);
  const startPrice = Math.floor(Math.min(topPrice, botPrice) / priceStep) * priceStep;

  ctx.beginPath();
  for (let p = startPrice; p <= Math.max(topPrice, botPrice); p += priceStep) {
    const y = priceToY(p); if (y < 0 || y > h) continue;
    ctx.moveTo(0, y); ctx.lineTo(rightEdge, y);
  }
  ctx.stroke();

  // Vertical grid
  const candleCount = Math.floor(rightEdge / state.view.candleWidth);
  ctx.beginPath();
  for (let i = 0; i < candleCount; i += 5) {
    const x = rightEdge - RIGHT_PADDING_CANDLES * state.view.candleWidth - i * state.view.candleWidth - state.view.scrollX * state.view.candleWidth;
    if (x < 0 || x > rightEdge) continue;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  ctx.stroke();
}

function drawCandles(ctx, visible, startIdx, total, cw, gap, bodyW, priceToY, rightEdge) {
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const idx = startIdx + i;
    const x = candleX(idx, total, rightEdge, cw, state.view.scrollX);
    if (x < -cw || x > rightEdge + cw) continue;

    const isUp = c.close >= c.open;
    const isHist = c._historical || c._sourceInterval;
    let color = isUp ? COL.candleUp : COL.candleDown;
    if (isHist) color = COL.candleHistorical;

    // Wick
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, priceToY(c.high)); ctx.lineTo(x, priceToY(c.low)); ctx.stroke();

    // Body
    const bodyTop = priceToY(Math.max(c.open, c.close));
    const bodyBot = priceToY(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    if (isHist) {
      ctx.fillStyle = 'rgba(55,65,81,0.6)';
      ctx.fillRect(x - bodyW/2, bodyTop, bodyW, bodyH);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW/2, bodyTop, bodyW, bodyH);
    }
  }
}

function drawVolumeBars(ctx, visible, startIdx, total, cw, gap, priceToY, h, rightEdge) {
  if (!visible.length) return;
  const maxVol = Math.max(...visible.map(c => c.volume || 0), 1);
  const barMaxH = h * 0.1;

  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const idx = startIdx + i;
    const x = candleX(idx, total, rightEdge, cw, state.view.scrollX);
    if (x < -cw || x > rightEdge + cw) continue;

    const barH = ((c.volume || 0) / maxVol) * barMaxH;
    const isUp = c.close >= c.open;
    const isHist = c._historical || c._sourceInterval;
    ctx.fillStyle = isHist ? 'rgba(55,65,81,0.2)' : (isUp ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)');
    ctx.fillRect(x - (cw - gap)/2, h - barH, cw - gap, barH);
  }
}

// ============ BUBBLE RENDERING — DEEPCHART STYLE ============
function drawBubbles(ctx, allCandles, startIdx, endIdx, cw, priceToY, rightEdge) {
  const total = allCandles.length;
  const visibleTimes = new Set();
  for (let i = startIdx; i <= endIdx && i < total; i++) visibleTimes.add(allCandles[i].openTime);

  // Collect visible bubbles
  const visBubbles = state.bubbles.filter(b => visibleTimes.has(b.candleTime) && b.state !== 'INVALIDATED');
  if (!visBubbles.length) return;

  // Build clusters
  const clusters = [];
  const bandPx = Math.max(CLUSTER_BAND_PX, cw * 0.8);

  for (const bubble of visBubbles) {
    const cIdx = allCandles.findIndex(c => c.openTime === bubble.candleTime);
    if (cIdx < 0) continue;
    const x = candleX(cIdx, total, rightEdge, cw, state.view.scrollX);
    const y = priceToY(bubble.price);

    // Find matching cluster (same side, same state, nearby price+time)
    let merged = false;
    for (const cl of clusters) {
      if (Math.abs(cl.x - x) < cw * 0.7 && Math.abs(cl.y - y) < bandPx && cl.side === bubble.side && cl.state === bubble.state) {
        cl.bubbles.push(bubble);
        cl.totalNotional += bubble.notional || 0;
        cl.totalVolume += bubble.volume || 0;
        cl.y = (cl.y * (cl.bubbles.length - 1) + y) / cl.bubbles.length;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ x, y, bubbles: [bubble], totalNotional: bubble.notional || 0, totalVolume: bubble.volume || 0, side: bubble.side, state: bubble.state });
  }

  // Draw clusters
  for (const cl of clusters) {
    const { x, y, bubbles: bubs, side, state: st } = cl;
    const count = bubs.length;
    const radius = Math.min(BUBBLE_MAX_R, Math.max(BUBBLE_MIN_R, Math.sqrt(cl.totalNotional / 1000)));

    // Determine color based on state + side
    let mainColor, isHollow = false;
    switch (st) {
      case 'PENDING':
        mainColor = COL.bubblePending; break;
      case 'ACCEPTED':
        mainColor = side === 'buy' ? COL.bubbleAcceptedBuy : COL.bubbleAcceptedSell; break;
      case 'REJECTED':
        // Rejection flips color — buy rejection turns red, sell rejection turns green
        mainColor = side === 'buy' ? COL.bubbleRejectedBuy : COL.bubbleRejectedSell;
        isHollow = true;
        break;
      case 'ABSORBED':
        mainColor = COL.bubbleAbsorbed; break;
      case 'EXHAUSTED':
        mainColor = COL.bubbleExhausted; break;
      default:
        mainColor = side === 'buy' ? COL.bubbleAcceptedBuy : COL.bubbleAcceptedSell;
    }

    // --- State-specific rendering ---
    switch (st) {
      case 'PENDING': {
        // Bright outline with pulse
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 300);
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2;
        ctx.globalAlpha = pulse;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'ACCEPTED': {
        // Filled circle with glow
        const grad = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius * 1.5);
        grad.addColorStop(0, mainColor + 'cc');
        grad.addColorStop(0.5, mainColor + '44');
        grad.addColorStop(1, mainColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2); ctx.fill();

        // Main filled
        ctx.fillStyle = mainColor + 'bb';
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();

        // Bright core
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2); ctx.fill();

        // Border
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'REJECTED': {
        // Hollow ring — warning style, color flipped
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();

        // Outer warning ring
        ctx.strokeStyle = mainColor + '55';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, radius + 3, 0, Math.PI * 2); ctx.stroke();

        // Very faint fill
        ctx.fillStyle = mainColor + '18';
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();

        // X mark for rejection
        ctx.strokeStyle = mainColor + '88';
        ctx.lineWidth = 1.5;
        const s = radius * 0.4;
        ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
        break;
      }
      case 'ABSORBED': {
        // Translucent with soft halo
        const grad = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius * 2);
        grad.addColorStop(0, mainColor + '44');
        grad.addColorStop(0.5, mainColor + '15');
        grad.addColorStop(1, mainColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, radius * 2, 0, Math.PI * 2); ctx.fill();

        // Inner translucent circle
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Secondary ring
        ctx.strokeStyle = mainColor + '55';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        // Outer halo ring
        ctx.strokeStyle = mainColor + '33';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'EXHAUSTED': {
        // Faded, low opacity
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        ctx.strokeStyle = mainColor + '44';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
    }

    // Cluster count label
    if (count > 1 && state.labelDensity !== 'minimal') {
      const icon = side === 'buy' ? '▲' : '▼';
      const stateAbbr = st === 'PENDING' ? '' : st === 'ACCEPTED' ? '' : st === 'REJECTED' ? 'R' : st === 'ABSORBED' ? 'Ab' : 'Ex';
      const label = count > 2 ? `${count}${stateAbbr}` : `${icon}${count}`;
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
      state.hoveredBubble = { x, y, cluster: cl, mainBubble: bubs.reduce((a, b) => (b.notional || 0) > (a.notional || 0) ? b : a, bubs[0]) };
    }
  }
}

// ============ ZONE RENDERING ============
function drawZones(ctx, h, rightEdge, priceToY, totalCandles, cw) {
  for (const zone of state.zones) {
    const y1 = priceToY(zone.priceHigh);
    const y2 = priceToY(zone.priceLow);
    if (y2 < 0 || y1 > h) continue;

    let fillCol, borderCol;
    const isBuy = zone.type.includes('BUY');
    const isSell = zone.type.includes('SELL');

    if (zone.type.includes('DEFENSE')) {
      fillCol = isBuy ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)';
      borderCol = isBuy ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
    } else if (zone.type.includes('ABSORPTION')) {
      fillCol = 'rgba(6,182,212,0.05)';
      borderCol = 'rgba(6,182,212,0.2)';
    } else if (zone.type.includes('REJECTION')) {
      fillCol = isBuy ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)';
      borderCol = isBuy ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)';
    } else {
      fillCol = 'rgba(245,158,11,0.04)';
      borderCol = 'rgba(245,158,11,0.15)';
    }

    ctx.fillStyle = fillCol;
    ctx.fillRect(0, y1, rightEdge, y2 - y1);

    ctx.strokeStyle = borderCol; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(rightEdge, y1);
    ctx.moveTo(0, y2); ctx.lineTo(rightEdge, y2); ctx.stroke();
    ctx.setLineDash([]);

    // Compact right-side label
    if (state.labelDensity !== 'minimal') {
      const shortType = zone.type.replace(/_/g, ' ').replace('BUYER ', 'B.').replace('SELLER ', 'S.').replace('BUY ', 'B.').replace('SELL ', 'S.');
      ctx.fillStyle = borderCol; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(shortType, rightEdge - 4, (y1 + y2) / 2 + 3);
    }
  }
}

// ============ SELECTED RANGE ============
function drawSelectedRange(ctx, priceToY, rightEdge, allCandles, cw) {
  const sr = state.selectedRange;
  if (!sr) return;

  let startIdx = allCandles.findIndex(c => c.openTime >= sr.start);
  let endIdx = allCandles.findIndex(c => c.openTime > sr.end);
  if (startIdx < 0) startIdx = 0;
  if (endIdx < 0) endIdx = allCandles.length - 1;

  const total = allCandles.length;
  const x1 = candleX(startIdx, total, rightEdge, cw, state.view.scrollX);
  const x2 = candleX(endIdx, total, rightEdge, cw, state.view.scrollX);
  const y1 = priceToY(sr.priceHigh);
  const y2 = priceToY(sr.priceLow);

  ctx.fillStyle = COL.selection;
  ctx.fillRect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);
  ctx.strokeStyle = COL.selectionBorder; ctx.lineWidth = 1.5; ctx.setLineDash([4, 2]);
  ctx.strokeRect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);
  ctx.setLineDash([]);

  if (sr.profile) drawProfileOverlay(ctx, sr.profile, Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1, priceToY);
}

function drawProfileOverlay(ctx, profile, boxX, boxY, boxW, boxH, priceToY) {
  if (!profile.levels || !profile.levels.length) return;
  const maxVol = Math.max(...profile.levels.map(l => l.total), 1);
  const maxDelta = Math.max(...profile.levels.map(l => Math.abs(l.delta)), 1);
  const profileW = boxW * 0.35;

  for (const level of profile.levels) {
    const y = priceToY(level.price);
    const barW = (level.total / maxVol) * profileW;
    const binH = Math.max(1, boxH / profile.levels.length);
    ctx.fillStyle = 'rgba(59,130,246,0.2)';
    ctx.fillRect(boxX, y - binH/2, barW, binH);
    const deltaW = (Math.abs(level.delta) / maxDelta) * profileW * 0.3;
    ctx.fillStyle = level.delta > 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
    ctx.fillRect(level.delta > 0 ? boxX + barW : boxX + barW - deltaW, y - binH/2, deltaW, binH);
  }

  // POC
  if (profile.poc) {
    const pocY = priceToY(profile.poc);
    ctx.strokeStyle = COL.poc; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(boxX, pocY); ctx.lineTo(boxX + boxW, pocY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = COL.poc; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`POC ${fmtPrice(profile.poc)}`, boxX + 4, pocY - 4);
  }
  // VAH/VAL
  if (profile.vah) { const y = priceToY(profile.vah); ctx.strokeStyle = COL.vah; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(boxX, y); ctx.lineTo(boxX + boxW, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.vah; ctx.font = '8px monospace'; ctx.fillText(`VAH ${fmtPrice(profile.vah)}`, boxX + 4, y - 3); }
  if (profile.val) { const y = priceToY(profile.val); ctx.strokeStyle = COL.val; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(boxX, y); ctx.lineTo(boxX + boxW, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.val; ctx.font = '8px monospace'; ctx.fillText(`VAL ${fmtPrice(profile.val)}`, boxX + 4, y + 10); }
  if (profile.deltaPoc) { const y = priceToY(profile.deltaPoc); ctx.strokeStyle = COL.deltaPoc; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(boxX, y); ctx.lineTo(boxX + boxW, y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.deltaPoc; ctx.font = '8px monospace'; ctx.textAlign = 'right'; ctx.fillText(`ΔPOC ${fmtPrice(profile.deltaPoc)}`, boxX + boxW - 4, y - 3); }

  // HVN/LVN
  for (const hvn of (profile.hvns || [])) { const y = priceToY(hvn); ctx.fillStyle = 'rgba(59,130,246,0.1)'; ctx.fillRect(boxX, y - 3, boxW, 6); }
  for (const lvn of (profile.lvns || [])) { const y = priceToY(lvn); ctx.fillStyle = 'rgba(168,85,247,0.07)'; ctx.fillRect(boxX, y - 2, boxW, 4); }
}

// ============ DRAWING TOOLS ============
function drawDrawings(ctx, priceToY, rightEdge, allCandles, cw) {
  for (const d of state.drawings) drawSingleDrawing(ctx, d, priceToY, rightEdge);
}

function drawActiveDrawing(ctx, priceToY, rightEdge) {
  drawSingleDrawing(ctx, state.drawingState, priceToY, rightEdge);
}

function drawSingleDrawing(ctx, d, priceToY, rightEdge) {
  if (!d) return;
  ctx.strokeStyle = d.color || COL.drawing; ctx.lineWidth = 1.5;
  switch (d.type) {
    case 'hline': {
      const y = priceToY(d.price);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rightEdge, y); ctx.stroke();
      ctx.fillStyle = d.color || COL.drawing; ctx.font = '8px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`— ${fmtPrice(d.price)}`, 4, y - 4);
      break;
    }
    case 'trendline': {
      const y1 = priceToY(d.price1); const y2 = priceToY(d.price2);
      ctx.beginPath(); ctx.moveTo(d.x1, y1); ctx.lineTo(d.x2, y2); ctx.stroke();
      break;
    }
    case 'rect': {
      const y1 = priceToY(d.priceHigh); const y2 = priceToY(d.priceLow);
      ctx.fillStyle = 'rgba(59,130,246,0.06)';
      ctx.fillRect(d.x1, y1, d.x2 - d.x1, y2 - y1);
      ctx.strokeRect(d.x1, y1, d.x2 - d.x1, y2 - y1);
      break;
    }
    case 'text': {
      const y = priceToY(d.price);
      ctx.fillStyle = d.color || COL.drawing; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(d.text, d.x, y);
      break;
    }
  }
}

// ============ PRICE SCALE & CROSSHAIR ============
function drawPriceScale(ctx, w, h, yToPrice, rightEdge) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(rightEdge, 0, w - rightEdge, h);
  ctx.fillStyle = COL.gridText; ctx.font = '9px monospace'; ctx.textAlign = 'left';

  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topPrice = yToPrice(0); const botPrice = yToPrice(h);
  const startPrice = Math.floor(Math.min(topPrice, botPrice) / priceStep) * priceStep;

  for (let p = startPrice; p <= Math.max(topPrice, botPrice); p += priceStep) {
    const y = (state.view.scrollY + h/2) - (p / state.view.pricePerPixel);
    if (y < 10 || y > h - 10) continue;
    ctx.fillText(fmtPrice(p), rightEdge + 4, y + 3);
  }

  if (state.currentCandle) {
    const cy = (state.view.scrollY + h/2) - (state.currentCandle.close / state.view.pricePerPixel);
    const isUp = state.currentCandle.close >= state.currentCandle.open;
    ctx.fillStyle = isUp ? COL.candleUp : COL.candleDown;
    ctx.fillRect(rightEdge, cy - 8, w - rightEdge, 16);
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace';
    ctx.fillText(fmtPrice(state.currentCandle.close), rightEdge + 4, cy + 4);
  }
}

function drawCrosshair(ctx, w, h, rightEdge, yToPrice, priceToY, cw, allCandles) {
  if (state.mouse.x < 0 || state.mouse.x > w || state.mouse.y < 0 || state.mouse.y > h) return;
  if (state.mouse.x > rightEdge) return;

  ctx.strokeStyle = COL.crosshair; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(0, state.mouse.y); ctx.lineTo(rightEdge, state.mouse.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(state.mouse.x, 0); ctx.lineTo(state.mouse.x, h); ctx.stroke();
  ctx.setLineDash([]);

  const price = yToPrice(state.mouse.y);
  const label = document.getElementById('crosshair-label');
  if (label) { label.classList.remove('hidden'); label.style.left = (rightEdge + 2) + 'px'; label.style.top = (state.mouse.y - 10) + 'px'; label.textContent = fmtPrice(price); }

  updateTooltip(allCandles, cw, rightEdge);
}

function drawTimeLabels(ctx, visible, startIdx, total, cw, h, rightEdge) {
  ctx.fillStyle = COL.gridText; ctx.font = '8px monospace'; ctx.textAlign = 'center';
  for (let i = 0; i < visible.length; i += 10) {
    const c = visible[i];
    const idx = startIdx + i;
    const x = candleX(idx, total, rightEdge, cw, state.view.scrollX);
    if (x < 0 || x > rightEdge) continue;
    const t = new Date(c.openTime);
    ctx.fillText(`${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`, x, h - 4);
  }
}

// ============ TOOLTIP ============
function updateTooltip(allCandles, cw, rightEdge) {
  const tooltip = document.getElementById('hover-tooltip');
  if (!tooltip) return;

  // Reset hovered bubble
  state.hoveredBubble = null;

  // Find hovered candle
  const total = allCandles.length;
  const mouseFromRight = (rightEdge - RIGHT_PADDING_CANDLES * cw - state.view.scrollX * cw - state.mouse.x) / cw;
  const candleIdx = Math.round(total - 1 - mouseFromRight);

  if (candleIdx >= 0 && candleIdx < allCandles.length) {
    const c = allCandles[candleIdx];
    state.hoveredCandle = c;
    const t = new Date(c.openTime);
    const timeStr = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`;

    tooltip.classList.remove('hidden');
    tooltip.style.left = (state.mouse.x + 15) + 'px';
    tooltip.style.top = (state.mouse.y - 10) + 'px';
    tooltip.innerHTML = `
      <div style="color:#94a3b8;margin-bottom:3px">${timeStr}</div>
      <div>O: ${fmtPrice(c.open)} H: ${fmtPrice(c.high)} L: ${fmtPrice(c.low)} C: ${fmtPrice(c.close)}</div>
      <div>Vol: ${fmtNum(c.volume)} | Δ: ${c.delta > 0 ? '+' : ''}${fmtNum(c.delta)}</div>
      <div>Trades: ${c.tradeCount} | Bubbles: ${c.bubbleCount || 0}</div>
      <div style="color:#94a3b8;font-size:9px">Absorbed: ${c.absorptionCount || 0} | Rejected: ${c.rejectionCount || 0}</div>
    `;
  } else {
    tooltip.classList.add('hidden');
  }

  // Bubble hover (overrides candle tooltip)
  if (state.hoveredBubble) {
    const b = state.hoveredBubble;
    tooltip.classList.remove('hidden');
    tooltip.style.left = (b.x + 20) + 'px';
    tooltip.style.top = (b.y - 20) + 'px';
    const bub = b.mainBubble;
    const cl = b.cluster;
    const bubs = cl.bubbles;
    const isCluster = bubs.length > 1;

    const buyCount = bubs.filter(bb => bb.side === 'buy').length;
    const sellCount = bubs.filter(bb => bb.side === 'sell').length;
    const stateCounts = {};
    for (const bb of bubs) { const s = bb.state || 'PENDING'; stateCounts[s] = (stateCounts[s] || 0) + 1; }
    const stateBreakdown = Object.entries(stateCounts).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ');

    const stateColor = cl.state === 'ACCEPTED' ? (cl.side === 'buy' ? '#22c55e' : '#ef4444')
      : cl.state === 'REJECTED' ? (cl.side === 'buy' ? '#ef4444' : '#22c55e')
      : cl.state === 'ABSORBED' ? '#06b6d4'
      : cl.state === 'EXHAUSTED' ? '#6b7280' : '#f59e0b';

    let interp = '';
    if (cl.state === 'ACCEPTED') interp = cl.side === 'buy' ? 'Buy aggression accepted — auction higher' : 'Sell aggression accepted — auction lower';
    else if (cl.state === 'REJECTED') interp = cl.side === 'buy' ? 'Buying rejected — sellers defended' : 'Selling rejected — buyers defended';
    else if (cl.state === 'ABSORBED') interp = 'Volume absorbed — passive defense at this level';
    else if (cl.state === 'EXHAUSTED') interp = 'Aggression exhausted — momentum fading';

    tooltip.innerHTML = `
      <div style="color:${stateColor};font-weight:bold;margin-bottom:3px">${isCluster ? `${bubs.length} ${cl.side} bubbles — ${cl.state.toLowerCase()}` : `${cl.side.toUpperCase()} ${cl.state}`}</div>
      <div style="color:#94a3b8">Price: ${fmtPrice(bub.price)} | Size: ${fmtNum(bub.volume)} | $${fmtNum(bub.notional)}</div>
      ${isCluster ? `<div style="color:#94a3b8">Total: $${fmtNum(cl.totalNotional)} | Range: ${fmtPrice(Math.min(...bubs.map(bb=>bb.price)))} — ${fmtPrice(Math.max(...bubs.map(bb=>bb.price)))}</div>` : ''}
      <div style="border-top:1px solid #1e293b;margin:4px 0;padding-top:3px">
        <div>${buyCount} buy / ${sellCount} sell</div>
        <div>${stateBreakdown}</div>
      </div>
      <div style="color:#94a3b8;font-style:italic;font-size:9px;margin-top:2px">${interp}</div>
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

      // Drag pan (horizontal)
      if (state.mouse.isDown && state.mouse.button === 0 && state.activeTool === 'cursor') {
        const dx = e.clientX - state.mouse.dragStartX;
        state.view.scrollX = state.mouse.dragStartScrollX - dx / state.view.candleWidth;
        state.view.userModified = true;
        state.followLive = false;
        document.getElementById('btn-follow-live').classList.remove('active');
      }

      if (state.drawingState && state.mouse.isDown) updateDrawingState(state.mouse.x, state.mouse.price);
    } catch(err) { /* silent */ }
  });

  canvas.addEventListener('mousedown', (e) => {
    try {
      state.mouse.isDown = true;
      state.mouse.button = e.button;
      state.mouse.dragStartX = e.clientX;
      state.mouse.dragStartScrollX = state.view.scrollX;
      if (e.button === 0) handleToolClick(e);
    } catch(err) { showToast('Click error: ' + err.message, 'error'); }
  });

  canvas.addEventListener('mouseup', (e) => {
    try {
      if (state.drawingState && state.mouse.isDown) finalizeDrawing();
      state.mouse.isDown = false;
    } catch(err) { /* silent */ }
  });

  // Zoom: Ctrl+wheel = horizontal time zoom, normal wheel = vertical price scroll
  canvas.addEventListener('wheel', (e) => {
    try {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+wheel: horizontal time zoom around cursor
        const oldCW = state.view.candleWidth;
        const newCW = Math.max(MIN_SCALE_X, Math.min(MAX_SCALE_X, oldCW * factor));
        // Zoom around cursor: adjust scrollX so the candle under cursor stays in place
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const rightEdge = state.width - state.priceScaleWidth;
        const allCandles = getAllCandles();
        const total = allCandles.length;
        // Candle index at cursor position
        const cursorFromRight = (rightEdge - RIGHT_PADDING_CANDLES * oldCW - state.view.scrollX * oldCW - mouseX) / oldCW;
        // After zoom, keep same candle at same pixel
        const newScrollX = (rightEdge - RIGHT_PADDING_CANDLES * newCW - mouseX) / newCW - (total - 1 - Math.round(total - 1 - cursorFromRight));
        state.view.candleWidth = newCW;
        state.view.scrollX = -newScrollX;
      } else if (e.shiftKey) {
        // Shift+wheel: horizontal pan
        state.view.scrollX -= e.deltaY / state.view.candleWidth;
      } else {
        // Normal wheel: vertical price scroll
        state.view.scrollY += e.deltaY * 0.5;
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
          if (state.drawingState) { state.drawingState = null; }
          else if (state.activeTool !== 'cursor') { setActiveTool('cursor'); state.selectedRange = null; updateRangePanel(); }
          else { state.selectedRange = null; updateRangePanel(); }
          break;
        case 'r': case 'R': setActiveTool('range'); break;
        case 'Delete': case 'Backspace': deleteSelectedDrawing(); break;
        case 'f': case 'F': fitAll(); break;
      }
    } catch(err) { /* silent */ }
  });
}

function handleToolClick(e) {
  const x = state.mouse.x;
  const price = state.mouse.price;
  switch (state.activeTool) {
    case 'cursor': break;
    case 'hline':
      state.drawings.push({ type: 'hline', price, color: COL.drawing });
      saveDrawings(); setActiveTool('cursor'); break;
    case 'trendline':
      if (!state.drawingState) state.drawingState = { type: 'trendline', x1: x, price1: price, x2: x, price2: price, color: COL.drawing };
      break;
    case 'rect':
      if (!state.drawingState) state.drawingState = { type: 'rect', x1: x, price1: price, x2: x, price2: price, color: COL.drawing };
      break;
    case 'text':
      const text = prompt('Enter label:');
      if (text) { state.drawings.push({ type: 'text', x, price, text, color: COL.drawing }); saveDrawings(); }
      setActiveTool('cursor'); break;
    case 'range':
      if (!state.drawingState) state.drawingState = { type: 'range', x1: x, price1: price, x2: x, price2: price };
      break;
  }
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
    const allCandles = getAllCandles();
    const priceHigh = Math.max(d.price1, d.price2);
    const priceLow = Math.min(d.price1, d.price2);
    const matching = allCandles.filter(c => { const mid = (c.high + c.low) / 2; return mid >= priceLow && mid <= priceHigh; });
    if (matching.length > 0) {
      state.selectedRange = { start: matching[0].openTime, end: matching[matching.length - 1].openTime, priceLow, priceHigh, profile: null };
      if (state.wsReady && state.symbol) {
        state.ws.send(JSON.stringify({ type: 'get_profile', symbol: state.symbol, start: state.selectedRange.start, end: state.selectedRange.end, priceLow, priceHigh }));
      }
      // Also fetch via REST
      fetch(`/api/range-profile?symbol=${state.symbol}&start=${state.selectedRange.start}&end=${state.selectedRange.end}&price_low=${priceLow}&price_high=${priceHigh}`)
        .then(r => r.json()).then(data => { if (data.ok && data.profile) { state.selectedRange.profile = data.profile; updateRangePanel(); } }).catch(() => {});
    }
  } else if (d.type === 'trendline' || d.type === 'rect') {
    state.drawings.push({ ...d }); saveDrawings();
  }
  state.drawingState = null;
}

function deleteSelectedDrawing() { if (state.drawings.length > 0) { state.drawings.pop(); saveDrawings(); } }
function saveDrawings() { if (!state.symbol) return; try { localStorage.setItem(`drawings_${state.symbol}`, JSON.stringify(state.drawings)); } catch(e) {} }
function loadDrawings() { if (!state.symbol) return; try { const s = localStorage.getItem(`drawings_${state.symbol}`); state.drawings = s ? JSON.parse(s) : []; } catch(e) { state.drawings = []; } }

// ============ UI UPDATES ============
function fitAll() {
  state.view.scrollX = 0;
  state.view.userModified = false;
  state.followLive = true;
  state._priceScaleDirty = true;
  document.getElementById('btn-follow-live').classList.add('active');
}

function setActiveTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
  const cursorMap = { cursor: 'grab', hline: 'crosshair', trendline: 'crosshair', rect: 'crosshair', range: 'crosshair', text: 'text', delete: 'not-allowed' };
  state.canvas.style.cursor = cursorMap[tool] || 'crosshair';
  const bar = document.getElementById('tool-status-bar');
  const names = { cursor: 'Cursor', hline: 'Horizontal Line', trendline: 'Trend Line', rect: 'Rectangle', range: 'Range Profile (R)', text: 'Text Label', delete: 'Delete' };
  if (bar) bar.textContent = 'Tool: ' + (names[tool] || tool);
}

function updateSourceUI() {
  const ss = state.sourceStatus;
  const pill = document.getElementById('active-source');
  const quality = document.getElementById('data-quality');
  const execRef = document.getElementById('exec-ref');

  const hlConn = ss.hyperliquidConnected || (ss.hyperliquid && ss.hyperliquid.connected) || false;
  const lastTrade = ss.lastTradeTs || (ss.hyperliquid && ss.hyperliquid.lastTradeTs) || null;

  if (hlConn && state.symbolLoaded) {
    pill.textContent = 'HL'; pill.classList.add('active');
    const age = lastTrade ? Date.now() - lastTrade : Infinity;
    quality.textContent = age < 30000 ? 'Quality: Good' : age < 120000 ? 'Quality: Stale' : 'Quality: Waiting';
  } else if (hlConn) {
    pill.textContent = 'HL'; pill.classList.add('active');
    quality.textContent = 'Quality: Loading...';
  } else {
    pill.textContent = '—'; pill.classList.remove('active');
    quality.textContent = 'Quality: Disconnected';
  }

  if (state.symbol) { execRef.textContent = `Exec: ${symbolToBinance(state.symbol)}`; execRef.classList.remove('dim'); }
  else { execRef.textContent = 'Exec: —'; execRef.classList.add('dim'); }

  // Right panel source info
  const sc = document.getElementById('source-content');
  if (!sc) return;
  const hlTradesSub = ss.hyperliquidTradesSubscribed || false;
  const bnWsConn = ss.binanceUsdmLiveTradeReceiving || false;
  const bnRefConn = ss.binanceUsdmReferenceConnected || false;

  sc.innerHTML = `
    <div class="row"><span class="label">Read:</span><span class="val green">Hyperliquid</span></div>
    <div class="row"><span class="label">HL connected:</span><span class="val ${hlConn?'green':'red'}">${hlConn?'yes':'no'}</span></div>
    <div class="row"><span class="label">HL trades:</span><span class="val ${hlTradesSub?'green':'red'}">${hlTradesSub?'active':'no'}</span></div>
    <div class="row"><span class="label">Exec ref:</span><span class="val">Binance USD-M</span></div>
    <div class="row"><span class="label">BN connected:</span><span class="val ${bnRefConn?'green':'yellow'}">${bnRefConn?'yes':'reference only'}</span></div>
    <div class="row"><span class="label">BN aggTrade:</span><span class="val ${bnWsConn?'green':'yellow'}">${bnWsConn?'active':'not active'}</span></div>
    <div class="row"><span class="label">Spot:</span><span class="val" style="color:#475569">disabled</span></div>
  `;
}

function updateRightPanel() {
  const el = document.getElementById('auction-content');
  if (!el) return;
  if (state.symbol && state.symbolLoaded) {
    el.innerHTML = `
      <div class="row"><span class="label">Symbol:</span><span class="val">${state.symbol}</span></div>
      <div class="row"><span class="label">Interval:</span><span class="val">${state.interval}</span></div>
      <div class="row"><span class="label">Candles:</span><span class="val">${state.candles.length}</span></div>
      <div class="row"><span class="label">History:</span><span class="val ${state.historyLoaded?'green':''}">${state.historyLoaded ? state.historyCount + ' backfill' : state.historySource || 'loading...'}</span></div>
      <div class="row"><span class="label">Bubbles:</span><span class="val">${state.bubbles.length}</span></div>
      <div class="row"><span class="label">Zones:</span><span class="val">${state.zones.length}</span></div>
    `;
  } else if (state.symbol) {
    el.innerHTML = `<div style="color:#f59e0b">Loading ${state.symbol}...</div>`;
  } else {
    el.innerHTML = '<div style="color:#475569">No symbol selected</div>';
  }
}

function updateRangePanel() {
  const el = document.getElementById('range-content');
  if (!el) return;
  const sr = state.selectedRange;
  if (!sr) { el.innerHTML = 'Select a range on chart'; return; }
  if (!sr.profile) { el.innerHTML = '<div style="color:#f59e0b">Computing profile...</div>'; return; }

  const p = sr.profile;
  const tStart = new Date(sr.start); const tEnd = new Date(sr.end);
  const duration = ((sr.end - sr.start) / 1000).toFixed(0);

  el.innerHTML = `
    <div class="row"><span class="label">Duration:</span><span class="val">${duration}s</span></div>
    <div class="row"><span class="label">Range:</span><span class="val">${fmtPrice(sr.priceLow)} — ${fmtPrice(sr.priceHigh)}</span></div>
    <div class="row"><span class="label">Volume:</span><span class="val">${fmtNum(p.totalVolume)}</span></div>
    <div class="row"><span class="label">Buy Vol:</span><span class="val green">${fmtNum(p.buyVolume)}</span></div>
    <div class="row"><span class="label">Sell Vol:</span><span class="val red">${fmtNum(p.sellVolume)}</span></div>
    <div class="row"><span class="label">Delta:</span><span class="val ${p.delta>0?'green':'red'}">${p.delta>0?'+':''}${fmtNum(p.delta)}</span></div>
    <div class="row"><span class="label">POC:</span><span class="val" style="color:#f59e0b">${fmtPrice(p.poc)}</span></div>
    <div class="row"><span class="label">VAH:</span><span class="val" style="color:#3b82f6">${fmtPrice(p.vah)}</span></div>
    <div class="row"><span class="label">VAL:</span><span class="val" style="color:#3b82f6">${fmtPrice(p.val)}</span></div>
    <div class="row"><span class="label">ΔPOC:</span><span class="val" style="color:#a855f7">${fmtPrice(p.deltaPoc)}</span></div>
    <div class="row"><span class="label">Side:</span><span class="val ${p.dominantSide==='buy'?'green':p.dominantSide==='sell'?'red':''}">${p.dominantSide}</span></div>
    <div style="margin-top:6px;padding:4px;background:rgba(245,158,11,0.08);border-radius:3px;font-size:9px;color:#94a3b8">${p.interpretation||'—'}</div>
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
    let msg = reason === 'universe_not_loaded' ? `Hydrating... HL=${hydrated.hyperliquid?'✓':'...'} BN=${hydrated.binance?'✓':'...'}` : reason === 'no_price_data' ? 'Universes loaded — waiting for trades...' : 'Loading scanner...';
    body.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#475569">${msg}</td></tr>`;
    return;
  }
  body.innerHTML = data.rows.map(s => `
    <tr class="${s.hlSymbol===state.symbol?'selected':''}" onclick="window.__selectSymbol('${s.hlSymbol}')">
      <td><strong>${s.hlSymbol}</strong>${s.isPinned?' ★':''}</td>
      <td><span class="tag-status tag-${s.statusTag}">${s.statusTag}</span></td>
      <td>${fmtPrice(s.price)}</td>
      <td style="color:${s.change24h>0?'#22c55e':'#ef4444'}">${s.change24h>0?'+':''}${s.change24h.toFixed(2)}%</td>
      <td>${fmtNum(s.volume)}</td>
      <td style="color:${s.delta>0?'#22c55e':'#ef4444'}">${s.delta>0?'+':''}${fmtNum(s.delta)}</td>
      <td>${s.tradeFrequency.toFixed(1)}/s</td>
      <td>${s.bubbleCount}</td>
      <td>${s.absorptionCount+s.rejectionCount}</td>
      <td>${s.availableOnBinance?s.binanceSymbol:'<span style="color:#475569">—</span>'}</td>
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
    state.view = { candleWidth: 8, pricePerPixel: 0.05, scrollX: 0, scrollY: 0, userModified: false };
    state.followLive = true; state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.add('active');
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.view.candleWidth = Math.min(MAX_SCALE_X, state.view.candleWidth * 1.3);
    state.view.userModified = true; state.followLive = false; state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.view.candleWidth = Math.max(MIN_SCALE_X, state.view.candleWidth / 1.3);
    state.view.userModified = true; state.followLive = false; state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-auto-scale').addEventListener('click', () => {
    state.autoScale = !state.autoScale;
    document.getElementById('btn-auto-scale').classList.toggle('active', state.autoScale);
    if (state.autoScale) state._priceScaleDirty = true;
  });

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'delete') deleteSelectedDrawing();
      else setActiveTool(btn.dataset.tool);
    });
  });

  document.getElementById('interval-select').addEventListener('change', (e) => {
    state.interval = e.target.value;
    if (state.wsReady) state.ws.send(JSON.stringify({ type: 'set_interval', interval: state.interval }));
  });

  // Symbol input
  const symInput = document.getElementById('symbol-input');
  const symDropdown = document.getElementById('symbol-dropdown');
  symInput.addEventListener('focus', () => showSymbolDropdown(symInput.value.toUpperCase()));
  symInput.addEventListener('input', (e) => showSymbolDropdown(e.target.value.toUpperCase()));
  symInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const val = symInput.value.toUpperCase().trim(); if (val) selectSymbol(val); symDropdown.classList.add('hidden'); } });
  symInput.addEventListener('blur', () => setTimeout(() => symDropdown.classList.add('hidden'), 200));

  document.getElementById('scanner-mode').addEventListener('change', (e) => { state.scannerMode = e.target.value; fetchScannerData(); });

  document.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function showSymbolDropdown(filter) {
  const dropdown = document.getElementById('symbol-dropdown');
  const coins = window.__hlCoins || [];
  const filtered = filter ? coins.filter(c => c.startsWith(filter)).slice(0, 30) : coins.slice(0, 30);
  if (!filtered.length) { dropdown.classList.add('hidden'); return; }
  dropdown.classList.remove('hidden');
  dropdown.innerHTML = filtered.map(c => `<div class="dropdown-item" onclick="window.__selectSymbol('${c}')"><span>${c}</span><span class="tag">${symbolToBinance(c)}</span></div>`).join('');
}

// ============ SYMBOL SELECTION ============
function selectSymbol(symbol) {
  const sym = symbol.toUpperCase().trim();
  if (!sym || state._loadingSymbol) return;
  state._loadingSymbol = true;
  state.symbol = sym;
  state.symbolError = null;
  state.candles = []; state.currentCandle = null; state.bubbles = []; state.zones = [];
  state.selectedRange = null; state.symbolLoaded = false;
  state.historyLoaded = false; state.historyCount = 0; state.historySource = '';
  state._priceScaleDirty = true;
  state.view.scrollX = 0; // Reset to live view

  document.getElementById('symbol-input').value = sym;
  document.getElementById('fp-symbol').textContent = sym;
  updateRangePanel(); updateRightPanel(); updateSourceUI();

  fetch('/api/select-symbol', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hyperliquid', symbol: sym, interval: state.interval })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      if (data.lastError) { state.symbolError = data.lastError; showToast(data.lastError, 'warn'); }
      if (!data.historicalCandlesLoaded) fetchHistoricalCandles(sym);
    } else {
      state.symbolError = data.error || 'Failed to load symbol';
      showToast('Symbol error: ' + (data.error || 'unknown'), 'error');
      state._loadingSymbol = false;
    }
  })
  .catch(err => {
    state.symbolError = 'Network error — retrying';
    showToast('REST error: ' + err.message, 'warn');
    if (state.wsReady) state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: sym }));
    fetchHistoricalCandles(sym);
    state._loadingSymbol = false;
  });

  if (state.wsReady) state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: sym }));
  fetchHistoricalCandles(sym);
  fetchScannerData();
  loadDrawings();
}
window.__selectSymbol = selectSymbol;

// Scanner polling
function fetchScannerData() {
  fetch(`/api/scanner?mode=${state.scannerMode}`).then(r => r.json()).then(data => { state.scannerData = data; updateScannerUI(); }).catch(() => {});
}

// Footprint
function updateFootprint() {
  if (!state.symbol) return;
  fetch(`/orderflow/footprint?symbol=${state.symbol}`).then(r => r.json()).then(data => {
    const el = document.getElementById('footprint-content');
    if (!el) return;
    if (!data.levels || !Object.keys(data.levels).length) { el.innerHTML = '<div style="color:#475569">No footprint data</div>'; return; }
    const levels = Object.entries(data.levels).map(([price, l]) => ({ price: parseFloat(price), ...l })).sort((a, b) => b.price - a.price);
    const maxTotal = Math.max(...levels.map(l => l.total), 1);
    el.innerHTML = levels.map(l => {
      const delta = l.buy - l.sell;
      return `<div class="fp-row"><span class="price-col">${fmtPrice(l.price)}</span><span class="buy-col"><span class="bar buy" style="width:${l.buy/maxTotal*80}px"></span> ${fmtNum(l.buy)}</span><span class="sell-col">${fmtNum(l.sell)} <span class="bar sell" style="width:${l.sell/maxTotal*80}px"></span></span><span class="delta-col" style="color:${delta>0?'#22c55e':'#ef4444'}">${delta>0?'+':''}${fmtNum(delta)}</span></div>`;
    }).join('');
  }).catch(() => {});
}

// Status polling
function startStatusPolling() {
  setInterval(() => {
    fetch('/api/status').then(r => r.json()).then(status => { state.sourceStatus = status; updateSourceUI(); updateRightPanel(); }).catch(() => {});
  }, 5000);
}

// ============ INIT ============
function init() {
  initCanvas();
  initInput();
  initButtons();
  connectWS();
  fetchScannerData();
  setInterval(fetchScannerData, 5000);
  startStatusPolling();
  setInterval(updateFootprint, 3000);
  requestAnimationFrame(render);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
