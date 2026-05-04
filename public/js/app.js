// Orderflow Cockpit — Full Surgical Scalper Rebuild (Parts 1–5)
// Deepchart/dxFeed-style viewport, candle spacing, price scale, bubble rendering

(function() {
'use strict';

// ============ CONSTANTS ============
const MIN_CANDLES_VISIBLE = 3;       // Part 1: deep zoom — see just 3 candles
const MAX_CANDLES_VISIBLE = 600;     // Part 1: broad context — up to 600 candles
const DEFAULT_CANDLES_VISIBLE = 100; // Part 1: default visible candles on reset/startup
const FIT_RECENT_MAX = 250;          // Part 1: Fit All fits max 250 recent candles, not thousands
const RIGHT_PADDING_CANDLES = 12;    // Part 1: breathing room after latest candle (8–15 range)
const LIVE_CANDLE_POSITION = 0.80;   // Part 1: latest candle at 80% width when followLive ON
const BUBBLE_MIN_R = 3;              // Part 5: minimum bubble radius
const BUBBLE_MAX_R = 24;             // Part 5: maximum bubble radius
const CLUSTER_BAND_PX = 14;          // Part 5: pixel band for clustering bubbles
const ZOOM_FACTOR_WHEEL = 1.12;      // Part 2: zoom speed per wheel notch
const ZOOM_FACTOR_BTN = 1.35;        // Part 2: zoom speed per button click

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
window.onerror = function(msg) { try { showToast('Error: ' + (msg || 'unknown'), 'error'); } catch(_) {} return true; };
window.addEventListener('unhandledrejection', function(e) { try { showToast('Async error: ' + (e.reason?.message || e.reason || 'unknown'), 'error'); } catch(_) {} });

// ============ HELPERS ============
function fmtPrice(p) { if (p == null || isNaN(p)) return '—'; if (Math.abs(p) >= 1000) return p.toFixed(1); if (Math.abs(p) >= 100) return p.toFixed(2); if (Math.abs(p) >= 1) return p.toFixed(3); if (Math.abs(p) >= 0.01) return p.toFixed(4); return p.toFixed(6); }
function fmtNum(n) { if (n == null || isNaN(n)) return '—'; if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(1)+'B'; if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+'M'; if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+'K'; return n.toFixed(0); }
function symbolToBinance(s) { const sp = {PEPE:'1000PEPEUSDT',LUNC:'1000LUNCUSDT',SHIB:'1000SHIBUSDT',BONK:'1000BONKUSDT',FLOKI:'1000FLOKIUSDT',XEC:'1000XECUSDT',CAT:'1000CATSUSDT',RATS:'1000RATSUSDT'}; return sp[s] || `${s}USDT`; }
function estimatePriceStep(ppp, h) { const totalRange = h * ppp; const steps = [0.0001,0.0002,0.0005,0.001,0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000]; const target = totalRange / 8; for (const s of steps) { if (s >= target) return s; } return steps[steps.length - 1]; }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

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

  // ===== VIEWPORT — WORLD COORDINATE CAMERA (Part 1) =====
  // worldX = candle index (0..N-1), worldY = price
  // screenX = pixel on canvas, screenY = pixel on canvas
  view: {
    centerIndex: 0,           // world candle index at screen center
    candlesVisible: DEFAULT_CANDLES_VISIBLE, // how many candles on screen (zoom level)
    priceCenter: 0,           // price at vertical center
    pricePerPixel: 0.05,      // price units per pixel
    autoScalePrice: true,     // Part 3: auto-scale price axis
    followLive: true,
    userModified: false,
    manualPrice: false,       // Part 3: user manually adjusted price
  },

  // Part 4: last valid viewport for auto-recovery
  lastValidViewport: null,

  mouse: { x: 0, y: 0, price: 0, isDown: false, button: 0,
           dragStartX: 0, dragStartY: 0, dragStartCenterIndex: 0, dragStartPriceCenter: 0 },
  hoveredCandle: null,
  hoveredBubble: null,
  hoveredBubblePos: null,

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

  historyLoaded: false,
  historyCount: 0,
  historySource: '',
  _priceScaleDirty: true,
  _loadingSymbol: false,

  priceScaleWidth: 62,
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
  crosshair: 'rgba(148,163,184,0.3)',
  selection: 'rgba(245,158,11,0.12)', selectionBorder: '#f59e0b',
  drawing: '#3b82f6', poc: '#f59e0b', vah: '#3b82f6', val: '#3b82f6', deltaPoc: '#a855f7',
};

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
        if (state.candles.length > 800) state.candles = state.candles.slice(-800);
        state.historyLoaded = true;
        state.historyCount = data.count;
        state.historySource = data.interval + ' historical';
        state._priceScaleDirty = true;
        state.symbolLoaded = true;
        updateRightPanel();
      } else {
        state.historySource = 'Building live history';
        state.symbolLoaded = true;
        updateRightPanel();
      }
    })
    .catch(() => {
      state.historySource = 'Building live history';
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
        if (state.bubbles.length > 5000) state.bubbles = state.bubbles.slice(-5000);
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
        if (state.followLive && !state.view.userModified) resetToDefaultView();
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
  if (state.candles.length > 800) state.candles = state.candles.slice(-800);
  state.currentCandle = null;
  state._priceScaleDirty = true;
  if (candle.bubbles && candle.bubbles.length > 0) {
    for (const b of candle.bubbles) { b.candleTime = candle.openTime; state.bubbles.push(b); }
    if (state.bubbles.length > 5000) state.bubbles = state.bubbles.slice(-5000);
  }
  // Part 1: followLive keeps latest candle visible with breathing room
  if (state.followLive && !state.view.userModified) {
    snapToLive();
  }
}

function getAllCandles() {
  const all = [...state.candles];
  if (state.currentCandle) all.push(state.currentCandle);
  return all;
}

// ============================================================
// PART 1 — VIEWPORT MODEL: WORLD COORDINATE CAMERA
// ============================================================
// World X = candle index (0 = first, N-1 = latest)
// World Y = price
// The camera: centerIndex is the candle index at screen center.
// candlesVisible = how many candles fit across the chart width.

function worldToScreenX(worldIndex) {
  const chartW = state.width - state.priceScaleWidth;
  const pxPerCandle = chartW / state.view.candlesVisible;
  return chartW / 2 + (worldIndex - state.view.centerIndex) * pxPerCandle;
}

function screenToWorldX(screenX) {
  const chartW = state.width - state.priceScaleWidth;
  const pxPerCandle = chartW / state.view.candlesVisible;
  return state.view.centerIndex + (screenX - chartW / 2) / pxPerCandle;
}

function priceToScreenY(price) {
  return state.height / 2 - (price - state.view.priceCenter) / state.view.pricePerPixel;
}

function screenToPriceY(screenY) {
  return state.view.priceCenter + (state.height / 2 - screenY) * state.view.pricePerPixel;
}

function getCandlePixelWidth() {
  return (state.width - state.priceScaleWidth) / state.view.candlesVisible;
}

// Part 1: snap latest candle to LIVE_CANDLE_POSITION (80% from left)
function snapToLive() {
  const all = getAllCandles();
  if (all.length === 0) return;
  const chartW = state.width - state.priceScaleWidth;
  const pxPerCandle = chartW / state.view.candlesVisible;
  const targetScreenX = chartW * LIVE_CANDLE_POSITION;
  const latestIdx = all.length - 1;
  state.view.centerIndex = latestIdx - (targetScreenX - chartW / 2) / pxPerCandle;
}

// Part 4: clampViewport — ensure at least some real candles remain visible
function clampViewport() {
  const all = getAllCandles();
  if (all.length === 0) return;
  const chartW = state.width - state.priceScaleWidth;
  const pxPerCandle = chartW / state.view.candlesVisible;

  // The rightmost world index that has data
  const maxDataIndex = all.length - 1;
  // The rightmost world index allowed (data + right padding)
  const maxAllowedIndex = maxDataIndex + RIGHT_PADDING_CANDLES;
  // The leftmost world index allowed
  const minAllowedIndex = -RIGHT_PADDING_CANDLES;

  // Compute left and right world edges of the viewport
  const leftWorld = state.view.centerIndex - (state.view.candlesVisible / 2);
  const rightWorld = state.view.centerIndex + (state.view.candlesVisible / 2);

  // If viewport is entirely past the data boundary on the right, pull it back
  if (leftWorld > maxAllowedIndex) {
    state.view.centerIndex = maxAllowedIndex - state.view.candlesVisible / 2 + 1;
  }
  // If viewport is entirely past the data boundary on the left, push forward
  if (rightWorld < minAllowedIndex) {
    state.view.centerIndex = minAllowedIndex + state.view.candlesVisible / 2 - 1;
  }
  // Clamp centerIndex to reasonable bounds
  state.view.centerIndex = clamp(state.view.centerIndex,
    minAllowedIndex - state.view.candlesVisible,
    maxAllowedIndex + state.view.candlesVisible
  );
}

// Part 1: Fit All — fits recent FIT_RECENT_MAX candles with breathing room
function fitAll() {
  const all = getAllCandles();
  if (all.length === 0) return;
  // Fit recent candles, not all 800+ — prevents microscopic bars
  const fitCount = Math.min(all.length, FIT_RECENT_MAX);
  state.view.candlesVisible = Math.max(MIN_CANDLES_VISIBLE, fitCount + RIGHT_PADDING_CANDLES);
  // Center on the fitted candles
  const startIdx = all.length - fitCount;
  state.view.centerIndex = startIdx + (fitCount - 1) / 2;
  state.view.userModified = false;
  state.followLive = true;
  state._priceScaleDirty = true;
  snapToLive();
  document.getElementById('btn-follow-live').classList.add('active');
}

// Part 1: Fit All History — fits every loaded candle
function fitAllHistory() {
  const all = getAllCandles();
  if (all.length === 0) return;
  state.view.candlesVisible = Math.max(MIN_CANDLES_VISIBLE, all.length + RIGHT_PADDING_CANDLES);
  state.view.centerIndex = (all.length - 1) / 2;
  state.view.userModified = false;
  state.followLive = false;
  state._priceScaleDirty = true;
  document.getElementById('btn-follow-live').classList.remove('active');
}

// Part 1: Reset View — default zoom, latest at 80%, auto-scale, followLive ON
function resetToDefaultView() {
  const all = getAllCandles();
  state.view.candlesVisible = DEFAULT_CANDLES_VISIBLE;
  if (all.length > 0) {
    snapToLive();
    state.view.centerIndex = all.length - 1 - (LIVE_CANDLE_POSITION * state.view.candlesVisible - state.view.candlesVisible / 2);
    snapToLive(); // double-snap for precision
  }
  state.view.autoScalePrice = true;
  state.view.manualPrice = false;
  state.view.followLive = true;
  state.view.userModified = false;
  state.followLive = true;
  state._priceScaleDirty = true;
  document.getElementById('btn-follow-live').classList.add('active');
  document.getElementById('btn-auto-scale').classList.add('active');
}

// Part 2: zoom at a specific screen X position
function zoomAtScreenX(screenX, factor) {
  const worldX = screenToWorldX(screenX);
  const oldCV = state.view.candlesVisible;
  const newCV = clamp(oldCV * factor, MIN_CANDLES_VISIBLE, MAX_CANDLES_VISIBLE);
  if (newCV === oldCV) return;
  state.view.candlesVisible = newCV;
  // Keep the world point under the cursor at the same screen position
  const chartW = state.width - state.priceScaleWidth;
  const pxPerCandle = chartW / newCV;
  state.view.centerIndex = worldX - (screenX - chartW / 2) / pxPerCandle;
  state.view.userModified = true;
  state._priceScaleDirty = true;
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
  const chartW = w - state.priceScaleWidth;

  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, h);

  const allCandles = getAllCandles();

  // Part 4: Fallback if no data
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

  const totalCandles = allCandles.length;
  const cpw = getCandlePixelWidth();

  // Part 4: Clamp viewport to prevent blank chart
  clampViewport();

  // Part 1: Save last valid viewport
  state.lastValidViewport = {
    centerIndex: state.view.centerIndex,
    candlesVisible: state.view.candlesVisible,
    priceCenter: state.view.priceCenter,
    pricePerPixel: state.view.pricePerPixel,
  };

  // Visible index range
  const leftWorld = screenToWorldX(0);
  const rightWorld = screenToWorldX(chartW);
  const startIdx = Math.max(0, Math.floor(leftWorld) - 1);
  const endIdx = Math.min(totalCandles - 1, Math.ceil(rightWorld) + 1);

  // Part 3: Auto-scale price to visible candles + bubble extremes + zone bands
  if (state.view.autoScalePrice && !state.view.manualPrice) {
    if (state.followLive || state._priceScaleDirty) {
      let minP = Infinity, maxP = -Infinity;
      for (let i = startIdx; i <= endIdx && i < totalCandles; i++) {
        if (allCandles[i].low < minP) minP = allCandles[i].low;
        if (allCandles[i].high > maxP) maxP = allCandles[i].high;
      }
      // Include bubble extremes in visible range
      const visibleTimes = new Set();
      for (let i = startIdx; i <= endIdx && i < totalCandles; i++) visibleTimes.add(allCandles[i].openTime);
      for (const b of state.bubbles) {
        if (visibleTimes.has(b.candleTime)) {
          if (b.price < minP) minP = b.price;
          if (b.price > maxP) maxP = b.price;
        }
      }
      // Include zone bands
      for (const zone of state.zones) {
        if (zone.priceLow < minP) minP = zone.priceLow;
        if (zone.priceHigh > maxP) maxP = zone.priceHigh;
      }
      if (minP < maxP && isFinite(minP) && isFinite(maxP)) {
        const range = maxP - minP;
        const margin = range * 0.12;
        const targetPPP = (range + margin * 2) / h;
        // Don't over-expand: cap at reasonable max
        const maxPPP = range / (h * 0.25);
        const clampedPPP = Math.min(targetPPP, maxPPP);
        state.view.pricePerPixel = lerp(state.view.pricePerPixel, clampedPPP, 0.18);
        state.view.priceCenter = lerp(state.view.priceCenter, (minP + maxP) / 2, 0.18);
      }
      state._priceScaleDirty = false;
    }
  }

  // Draw layers
  drawGrid(ctx, chartW, h, cpw);
  drawZones(ctx, h, chartW);
  drawVolumeBars(ctx, allCandles, startIdx, endIdx, cpw, h, chartW);
  drawCandles(ctx, allCandles, startIdx, endIdx, cpw, chartW);
  drawBubbles(ctx, allCandles, startIdx, endIdx, cpw, chartW);

  if (state.selectedRange) drawSelectedRange(ctx, allCandles, cpw, chartW);
  drawDrawings(ctx, allCandles, cpw, chartW);
  if (state.drawingState) drawActiveDrawing(ctx);

  drawPriceScale(ctx, w, h, chartW);
  drawCrosshair(ctx, w, h, chartW, allCandles, cpw);
  drawTimeLabels(ctx, allCandles, startIdx, endIdx, cpw, h, chartW);

  // Status bar
  const statusBar = document.getElementById('tool-status-bar');
  if (statusBar) {
    const visCount = Math.min(endIdx - startIdx + 1, totalCandles);
    const toolName = state.activeTool === 'cursor' ? 'Cursor' : state.activeTool;
    statusBar.textContent = `Tool: ${toolName} | Visible: ${visCount} candles | Zoom: ${Math.round(state.view.candlesVisible)} | Ctrl+Wheel: time zoom | Shift+Wheel: price zoom`;
  }

  requestAnimationFrame(render);
}

// ============ GRID ============
function drawGrid(ctx, chartW, h, cpw) {
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 0.5;

  // Horizontal price grid
  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topP = screenToPriceY(0);
  const botP = screenToPriceY(h);
  const minP = Math.min(topP, botP);
  const maxP = Math.max(topP, botP);
  const startP = Math.floor(minP / priceStep) * priceStep;

  ctx.beginPath();
  for (let p = startP; p <= maxP; p += priceStep) {
    const y = priceToScreenY(p);
    if (y < 0 || y > h) continue;
    ctx.moveTo(0, y); ctx.lineTo(chartW, y);
  }
  ctx.stroke();

  // Vertical time grid — adaptive step based on zoom
  const gridStep = cpw < 3 ? 100 : cpw < 5 ? 50 : cpw < 10 ? 20 : cpw < 20 ? 10 : cpw < 40 ? 5 : 1;
  const leftIdx = Math.floor(screenToWorldX(0));
  const rightIdx = Math.ceil(screenToWorldX(chartW));
  const startGridIdx = Math.floor(leftIdx / gridStep) * gridStep;

  ctx.beginPath();
  for (let i = startGridIdx; i <= rightIdx; i += gridStep) {
    const x = worldToScreenX(i);
    if (x < 0 || x > chartW) continue;
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  ctx.stroke();
}

// ============ CANDLES (Part 2: body width scales with zoom) ============
function drawCandles(ctx, allCandles, startIdx, endIdx, cpw, chartW) {
  const gap = Math.max(1, cpw * 0.1);
  const bodyW = Math.max(1, cpw - gap);
  const wickW = cpw > 20 ? 2 : 1;

  for (let i = startIdx; i <= endIdx && i < allCandles.length; i++) {
    const c = allCandles[i];
    const x = worldToScreenX(i);
    if (x < -cpw || x > chartW + cpw) continue;

    const isUp = c.close >= c.open;
    const isHist = c._historical || c._sourceInterval;
    let color = isUp ? COL.candleUp : COL.candleDown;
    if (isHist) color = COL.candleHistorical;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = wickW;
    ctx.beginPath();
    ctx.moveTo(x, priceToScreenY(c.high));
    ctx.lineTo(x, priceToScreenY(c.low));
    ctx.stroke();

    // Body
    const bodyTop = priceToScreenY(Math.max(c.open, c.close));
    const bodyBot = priceToScreenY(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    if (isHist) {
      ctx.fillStyle = 'rgba(55,65,81,0.55)';
    } else {
      ctx.fillStyle = color;
    }
    ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);

    // At deep zoom, add subtle body border for readability
    if (cpw > 30 && !isHist) {
      ctx.strokeStyle = isUp ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
    }
  }
}

// ============ VOLUME BARS ============
function drawVolumeBars(ctx, allCandles, startIdx, endIdx, cpw, h, chartW) {
  if (startIdx >= allCandles.length) return;
  let maxVol = 1;
  for (let i = startIdx; i <= endIdx && i < allCandles.length; i++) {
    const v = allCandles[i].volume || 0;
    if (v > maxVol) maxVol = v;
  }
  const barMaxH = h * 0.1;
  const gap = Math.max(1, cpw * 0.1);
  const barW = Math.max(1, cpw - gap);

  for (let i = startIdx; i <= endIdx && i < allCandles.length; i++) {
    const c = allCandles[i];
    const x = worldToScreenX(i);
    if (x < -cpw || x > chartW + cpw) continue;
    const barH = ((c.volume || 0) / maxVol) * barMaxH;
    const isUp = c.close >= c.open;
    const isHist = c._historical || c._sourceInterval;
    ctx.fillStyle = isHist ? 'rgba(55,65,81,0.15)' : (isUp ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)');
    ctx.fillRect(x - barW / 2, h - barH, barW, barH);
  }
}

// ============================================================
// PART 5 — DEEPCHART/DXFEED BUBBLE RENDERING
// ============================================================
// Clean circles, rings, halos. Text hidden by default, shown on hover.
// Multiple bubbles per candle: slight x-offset jitter inside candle body.
// Same-price stacks: slight y-offset ring stacking.

function drawBubbles(ctx, allCandles, startIdx, endIdx, cpw, chartW) {
  const total = allCandles.length;
  const visibleTimes = new Set();
  for (let i = startIdx; i <= endIdx && i < total; i++) visibleTimes.add(allCandles[i].openTime);

  const visBubbles = state.bubbles.filter(b => visibleTimes.has(b.candleTime) && b.state !== 'INVALIDATED');
  if (!visBubbles.length) return;

  // For each candle, assign x-offsets to bubbles so they don't all stack on one point
  // Deterministic jitter: use bubble index within candle
  const candleBubbleCounts = {};
  const candleBubbleIndices = {};
  for (const b of visBubbles) {
    const key = b.candleTime;
    if (!(key in candleBubbleCounts)) { candleBubbleCounts[key] = 0; candleBubbleIndices[key] = 0; }
    candleBubbleCounts[key]++;
  }

  // Build clusters — group nearby bubbles of same side+state within the same candle
  const clusters = [];
  const bandPx = Math.max(CLUSTER_BAND_PX, cpw * 0.5);

  for (const bubble of visBubbles) {
    const cIdx = allCandles.findIndex(c => c.openTime === bubble.candleTime);
    if (cIdx < 0) continue;

    const candleX = worldToScreenX(cIdx);
    if (candleX < -60 || candleX > chartW + 60) continue;

    // Part 5: Multiple bubbles per candle — spread across candle width
    const bubbleIdx = candleBubbleIndices[bubble.candleTime]++;
    const count = candleBubbleCounts[bubble.candleTime];
    let xOffset = 0;
    if (count > 1 && cpw > 8) {
      // Deterministic spread: distribute across 70% of candle width
      const spread = cpw * 0.7;
      const step = spread / Math.max(1, count - 1);
      xOffset = -spread / 2 + bubbleIdx * step;
    }

    const x = candleX + xOffset;
    const y = priceToScreenY(bubble.price);
    if (y < -60 || y > state.height + 60) continue;

    // Cluster: same candle, same side, same state, nearby price
    let merged = false;
    for (const cl of clusters) {
      if (cl.candleTime === bubble.candleTime &&
          Math.abs(cl.y - y) < bandPx &&
          cl.side === bubble.side && cl.state === bubble.state) {
        cl.bubbles.push(bubble);
        cl.totalNotional += bubble.notional || 0;
        cl.totalVolume += bubble.volume || 0;
        cl.y = (cl.y * (cl.bubbles.length - 1) + y) / cl.bubbles.length;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({
      x, y, candleTime: bubble.candleTime, bubbles: [bubble],
      totalNotional: bubble.notional || 0, totalVolume: bubble.volume || 0,
      side: bubble.side, state: bubble.state
    });
  }

  // Draw clusters as clean circles
  state.hoveredBubble = null;
  state.hoveredBubblePos = null;

  for (const cl of clusters) {
    const { x, y, bubbles: bubs, side, state: st } = cl;
    const count = bubs.length;

    // Part 5: radius scales with notional/aggressiveness
    const rawR = Math.sqrt(cl.totalNotional / 600);
    const radius = clamp(rawR, BUBBLE_MIN_R, BUBBLE_MAX_R);

    // Color from state + side
    let mainColor;
    switch (st) {
      case 'PENDING': mainColor = COL.bubblePending; break;
      case 'ACCEPTED': mainColor = side === 'buy' ? COL.bubbleAcceptedBuy : COL.bubbleAcceptedSell; break;
      case 'REJECTED': mainColor = side === 'buy' ? COL.bubbleRejectedBuy : COL.bubbleRejectedSell; break;
      case 'ABSORBED': mainColor = COL.bubbleAbsorbed; break;
      case 'EXHAUSTED': mainColor = COL.bubbleExhausted; break;
      default: mainColor = side === 'buy' ? COL.bubbleAcceptedBuy : COL.bubbleAcceptedSell;
    }

    // === Part 5: State-specific clean circle rendering ===
    switch (st) {
      case 'PENDING': {
        // Pulsing thin outline
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'ACCEPTED': {
        // Filled circle with clean glow — opaque
        // Outer glow halo
        const grad = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius * 1.8);
        grad.addColorStop(0, mainColor + '66');
        grad.addColorStop(0.5, mainColor + '1a');
        grad.addColorStop(1, mainColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2); ctx.fill();

        // Main filled body
        ctx.fillStyle = mainColor + 'bb';
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();

        // Bright core
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2); ctx.fill();

        // Crisp border
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'REJECTED': {
        // Part 5: Buy rejected = red rejection ring / Sell rejected = green rejection ring
        // Hollow ring — warning style, visually distinct from absorbed

        // Very faint fill
        ctx.fillStyle = mainColor + '10';
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();

        // Main ring
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();

        // Outer warning ring
        ctx.strokeStyle = mainColor + '44';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, radius + 3, 0, Math.PI * 2); ctx.stroke();

        // At deep zoom: show rejection X mark
        if (cpw > 22) {
          ctx.strokeStyle = mainColor + '66';
          ctx.lineWidth = 1.5;
          const s = radius * 0.35;
          ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
        }
        break;
      }
      case 'ABSORBED': {
        // Part 5: Translucent, soft halo, muted fill — "large aggression hit, did not travel"
        // Outer halo
        const grad = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius * 2.5);
        grad.addColorStop(0, mainColor + '28');
        grad.addColorStop(0.4, mainColor + '0e');
        grad.addColorStop(1, mainColor + '00');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2); ctx.fill();

        // Inner translucent fill
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Dashed secondary ring
        ctx.strokeStyle = mainColor + '44';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        // Outer halo ring
        ctx.strokeStyle = mainColor + '22';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'EXHAUSTED': {
        // Smaller, faded, low emphasis
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = mainColor;
        ctx.beginPath(); ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = mainColor + '28';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(x, y, radius * 0.9, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
    }

    // Part 5: NO text inside bubbles by default — only at deep zoom with large clusters
    if (count > 2 && cpw > 40 && radius > 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), x, y);
    }

    // Hover detection — generous hit area
    const dx = state.mouse.x - x;
    const dy = state.mouse.y - y;
    const hitR = Math.max(radius + 10, 16);
    if (dx * dx + dy * dy < hitR * hitR) {
      state.hoveredBubble = { x, y, cluster: cl, mainBubble: bubs.reduce((a, b) => (b.notional || 0) > (a.notional || 0) ? b : a, bubs[0]) };
      state.hoveredBubblePos = { x, y };
    }
  }
}

// ============ ZONES ============
function drawZones(ctx, h, chartW) {
  for (const zone of state.zones) {
    const y1 = priceToScreenY(zone.priceHigh);
    const y2 = priceToScreenY(zone.priceLow);
    if (y2 < 0 || y1 > h) continue;

    let fillCol, borderCol;
    const isBuy = zone.type.includes('BUY');
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
    ctx.fillRect(0, y1, chartW, y2 - y1);
    ctx.strokeStyle = borderCol; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(chartW, y1);
    ctx.moveTo(0, y2); ctx.lineTo(chartW, y2); ctx.stroke();
    ctx.setLineDash([]);

    if (state.view.candlesVisible < 200) {
      const shortType = zone.type.replace(/_/g, ' ').replace('BUYER ', 'B.').replace('SELLER ', 'S.');
      ctx.fillStyle = borderCol; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(shortType, chartW - 4, (y1 + y2) / 2 + 3);
    }
  }
}

// ============ SELECTED RANGE ============
function drawSelectedRange(ctx, allCandles, cpw, chartW) {
  const sr = state.selectedRange;
  if (!sr) return;
  let startIdx = allCandles.findIndex(c => c.openTime >= sr.start);
  let endIdx = allCandles.findIndex(c => c.openTime > sr.end);
  if (startIdx < 0) startIdx = 0;
  if (endIdx < 0) endIdx = allCandles.length - 1;
  const x1 = worldToScreenX(startIdx);
  const x2 = worldToScreenX(endIdx);
  const y1 = priceToScreenY(sr.priceHigh);
  const y2 = priceToScreenY(sr.priceLow);
  ctx.fillStyle = COL.selection;
  ctx.fillRect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);
  ctx.strokeStyle = COL.selectionBorder; ctx.lineWidth = 1.5; ctx.setLineDash([4, 2]);
  ctx.strokeRect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);
  ctx.setLineDash([]);
  if (sr.profile) drawProfileOverlay(ctx, sr.profile, Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);
}

function drawProfileOverlay(ctx, profile, boxX, boxY, boxW, boxH) {
  if (!profile.levels || !profile.levels.length) return;
  const maxVol = Math.max(...profile.levels.map(l => l.total), 1);
  const maxDelta = Math.max(...profile.levels.map(l => Math.abs(l.delta)), 1);
  const profileW = boxW * 0.35;
  for (const level of profile.levels) {
    const y = priceToScreenY(level.price);
    const barW = (level.total / maxVol) * profileW;
    const binH = Math.max(1, boxH / profile.levels.length);
    ctx.fillStyle = 'rgba(59,130,246,0.2)';
    ctx.fillRect(boxX, y - binH/2, barW, binH);
    const deltaW = (Math.abs(level.delta) / maxDelta) * profileW * 0.3;
    ctx.fillStyle = level.delta > 0 ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
    ctx.fillRect(level.delta > 0 ? boxX + barW : boxX + barW - deltaW, y - binH/2, deltaW, binH);
  }
  if (profile.poc) { const y = priceToScreenY(profile.poc); ctx.strokeStyle = COL.poc; ctx.lineWidth = 1.5; ctx.setLineDash([6,3]); ctx.beginPath(); ctx.moveTo(boxX,y); ctx.lineTo(boxX+boxW,y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.poc; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left'; ctx.fillText(`POC ${fmtPrice(profile.poc)}`, boxX+4, y-4); }
  if (profile.vah) { const y = priceToScreenY(profile.vah); ctx.strokeStyle = COL.vah; ctx.lineWidth = 1; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(boxX,y); ctx.lineTo(boxX+boxW,y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.vah; ctx.font = '8px monospace'; ctx.fillText(`VAH ${fmtPrice(profile.vah)}`, boxX+4, y-3); }
  if (profile.val) { const y = priceToScreenY(profile.val); ctx.strokeStyle = COL.val; ctx.lineWidth = 1; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(boxX,y); ctx.lineTo(boxX+boxW,y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.val; ctx.font = '8px monospace'; ctx.fillText(`VAL ${fmtPrice(profile.val)}`, boxX+4, y+10); }
  if (profile.deltaPoc) { const y = priceToScreenY(profile.deltaPoc); ctx.strokeStyle = COL.deltaPoc; ctx.lineWidth = 1; ctx.setLineDash([2,2]); ctx.beginPath(); ctx.moveTo(boxX,y); ctx.lineTo(boxX+boxW,y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = COL.deltaPoc; ctx.font = '8px monospace'; ctx.textAlign = 'right'; ctx.fillText(`ΔPOC ${fmtPrice(profile.deltaPoc)}`, boxX+boxW-4, y-3); }
  for (const hvn of (profile.hvns || [])) { const y = priceToScreenY(hvn); ctx.fillStyle = 'rgba(59,130,246,0.1)'; ctx.fillRect(boxX, y-3, boxW, 6); }
  for (const lvn of (profile.lvns || [])) { const y = priceToScreenY(lvn); ctx.fillStyle = 'rgba(168,85,247,0.07)'; ctx.fillRect(boxX, y-2, boxW, 4); }
}

// ============ DRAWINGS ============
function drawDrawings(ctx, allCandles, cpw, chartW) {
  for (const d of state.drawings) drawSingleDrawing(ctx, d, chartW);
}
function drawActiveDrawing(ctx) {
  drawSingleDrawing(ctx, state.drawingState, state.width - state.priceScaleWidth);
}
function drawSingleDrawing(ctx, d, chartW) {
  if (!d) return;
  ctx.strokeStyle = d.color || COL.drawing; ctx.lineWidth = 1.5;
  switch (d.type) {
    case 'hline': { const y = priceToScreenY(d.price); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(chartW,y); ctx.stroke(); ctx.fillStyle = d.color||COL.drawing; ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.fillText(`— ${fmtPrice(d.price)}`, 4, y-4); break; }
    case 'trendline': { const y1 = priceToScreenY(d.price1); const y2 = priceToScreenY(d.price2); ctx.beginPath(); ctx.moveTo(d.x1,y1); ctx.lineTo(d.x2,y2); ctx.stroke(); break; }
    case 'rect': { const y1 = priceToScreenY(d.priceHigh); const y2 = priceToScreenY(d.priceLow); ctx.fillStyle = 'rgba(59,130,246,0.06)'; ctx.fillRect(d.x1,y1,d.x2-d.x1,y2-y1); ctx.strokeRect(d.x1,y1,d.x2-d.x1,y2-y1); break; }
    case 'text': { const y = priceToScreenY(d.price); ctx.fillStyle = d.color||COL.drawing; ctx.font = '10px monospace'; ctx.textAlign = 'left'; ctx.fillText(d.text, d.x, y); break; }
  }
}

// ============ PRICE SCALE (Part 3) ============
function drawPriceScale(ctx, w, h, chartW) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(chartW, 0, w - chartW, h);

  // Part 3: Double-click on price axis resets autoscale
  // (handled in initInput)

  ctx.fillStyle = COL.gridText; ctx.font = '9px monospace'; ctx.textAlign = 'left';
  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topP = screenToPriceY(0);
  const botP = screenToPriceY(h);
  const minP = Math.min(topP, botP);
  const maxP = Math.max(topP, botP);
  const startP = Math.floor(minP / priceStep) * priceStep;

  for (let p = startP; p <= maxP; p += priceStep) {
    const y = priceToScreenY(p);
    if (y < 10 || y > h - 10) continue;
    ctx.fillText(fmtPrice(p), chartW + 4, y + 3);
  }

  // Live price marker
  if (state.currentCandle) {
    const cy = priceToScreenY(state.currentCandle.close);
    const isUp = state.currentCandle.close >= state.currentCandle.open;
    ctx.fillStyle = isUp ? COL.candleUp : COL.candleDown;
    ctx.fillRect(chartW, cy - 8, w - chartW, 16);
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace';
    ctx.fillText(fmtPrice(state.currentCandle.close), chartW + 4, cy + 4);
  }

  // Manual price indicator
  if (state.view.manualPrice) {
    ctx.fillStyle = '#f59e0b';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MANUAL', chartW + (w - chartW) / 2, 12);
  }
}

// ============ CROSSHAIR ============
function drawCrosshair(ctx, w, h, chartW, allCandles, cpw) {
  if (state.mouse.x < 0 || state.mouse.x > w || state.mouse.y < 0 || state.mouse.y > h) return;
  if (state.mouse.x > chartW) return;

  ctx.strokeStyle = COL.crosshair; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(0, state.mouse.y); ctx.lineTo(chartW, state.mouse.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(state.mouse.x, 0); ctx.lineTo(state.mouse.x, h); ctx.stroke();
  ctx.setLineDash([]);

  const price = screenToPriceY(state.mouse.y);
  const label = document.getElementById('crosshair-label');
  if (label) { label.classList.remove('hidden'); label.style.left = (chartW + 2) + 'px'; label.style.top = (state.mouse.y - 10) + 'px'; label.textContent = fmtPrice(price); }

  updateTooltip(allCandles, cpw, chartW);
}

// ============ TIME LABELS ============
function drawTimeLabels(ctx, allCandles, startIdx, endIdx, cpw, h, chartW) {
  ctx.fillStyle = COL.gridText; ctx.font = '8px monospace'; ctx.textAlign = 'center';
  const labelInterval = cpw < 3 ? 100 : cpw < 5 ? 50 : cpw < 10 ? 20 : cpw < 20 ? 10 : cpw < 40 ? 5 : 1;
  for (let i = startIdx; i <= endIdx && i < allCandles.length; i += labelInterval) {
    const c = allCandles[i];
    const x = worldToScreenX(i);
    if (x < 0 || x > chartW) continue;
    const t = new Date(c.openTime);
    ctx.fillText(`${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`, x, h - 4);
  }
}

// ============================================================
// PART 5 — TOOLTIP: Full details on hover, not permanently
// ============================================================
function updateTooltip(allCandles, cpw, chartW) {
  const tooltip = document.getElementById('hover-tooltip');
  if (!tooltip) return;
  state.hoveredCandle = null;

  // Find hovered candle
  const worldIdx = Math.round(screenToWorldX(state.mouse.x));
  if (worldIdx >= 0 && worldIdx < allCandles.length) {
    state.hoveredCandle = allCandles[worldIdx];
  }

  // Part 5: Bubble hover takes priority — show full detail tooltip
  if (state.hoveredBubble) {
    const b = state.hoveredBubble;
    tooltip.classList.remove('hidden');
    tooltip.style.left = Math.min(b.x + 20, chartW - 250) + 'px';
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
    else if (cl.state === 'REJECTED') interp = cl.side === 'buy' ? 'Buying rejected — sellers defended this level' : 'Selling rejected — buyers defended this level';
    else if (cl.state === 'ABSORBED') interp = 'Volume absorbed — passive defense, aggression did not travel';
    else if (cl.state === 'EXHAUSTED') interp = 'Aggression exhausted — momentum fading';

    // Response time if available
    const respStr = bub.response3s != null ? `3s: ${bub.response3s > 0 ? '+' : ''}${fmtPrice(bub.response3s)}` : '';
    const resp10s = bub.response10s != null ? `10s: ${bub.response10s > 0 ? '+' : ''}${fmtPrice(bub.response10s)}` : '';
    const resp40s = bub.response40s != null ? `40s: ${bub.response40s > 0 ? '+' : ''}${fmtPrice(bub.response40s)}` : '';

    tooltip.innerHTML = `
      <div style="color:${stateColor};font-weight:bold;margin-bottom:3px">${isCluster ? `${bubs.length} ${cl.side} — ${cl.state.toLowerCase()}` : `${cl.side.toUpperCase()} ${cl.state}`}</div>
      <div style="color:#94a3b8">Price: ${fmtPrice(bub.price)} | Size: ${fmtNum(bub.volume)} | $${fmtNum(bub.notional)}</div>
      ${isCluster ? `<div style="color:#94a3b8">Total: $${fmtNum(cl.totalNotional)} | Range: ${fmtPrice(Math.min(...bubs.map(bb=>bb.price)))} — ${fmtPrice(Math.max(...bubs.map(bb=>bb.price)))}</div>` : ''}
      <div style="border-top:1px solid #1e293b;margin:4px 0;padding-top:3px">
        <div>${buyCount} buy / ${sellCount} sell</div>
        <div>${stateBreakdown}</div>
      </div>
      ${respStr ? `<div style="color:#94a3b8;font-size:9px;margin-top:2px">${respStr} ${resp10s} ${resp40s}</div>` : ''}
      <div style="color:#94a3b8;font-style:italic;font-size:9px;margin-top:2px">${interp}</div>
    `;
    state.hoveredBubble = null;
    return;
  }

  // Candle tooltip (no bubble hovered)
  if (state.hoveredCandle) {
    const c = state.hoveredCandle;
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
}

// ============================================================
// PART 1–4 — INPUT HANDLING
// ============================================================
function initInput() {
  const canvas = state.canvas;

  // === Mouse move: pan + update position ===
  canvas.addEventListener('mousemove', (e) => {
    try {
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = e.clientX - rect.left;
      state.mouse.y = e.clientY - rect.top;
      state.mouse.price = screenToPriceY(state.mouse.y);

      if (state.mouse.isDown && state.mouse.button === 0 && state.activeTool === 'cursor') {
        const dx = e.clientX - state.mouse.dragStartX;
        const dy = e.clientY - state.mouse.dragStartY;
        const cpw = getCandlePixelWidth();

        // Part 1: Horizontal pan — move centerIndex
        state.view.centerIndex = state.mouse.dragStartCenterIndex - dx / cpw;
        // Part 3: Vertical pan — move priceCenter (marks manual price mode)
        if (Math.abs(dy) > 2) {
          state.view.priceCenter = state.mouse.dragStartPriceCenter + dy * state.view.pricePerPixel;
          state.view.manualPrice = true;
        }

        state.view.userModified = true;
        state.followLive = false;
        document.getElementById('btn-follow-live').classList.remove('active');
      }

      if (state.drawingState && state.mouse.isDown) updateDrawingState(state.mouse.x, state.mouse.price);
    } catch(err) {}
  });

  canvas.addEventListener('mousedown', (e) => {
    try {
      state.mouse.isDown = true;
      state.mouse.button = e.button;
      state.mouse.dragStartX = e.clientX;
      state.mouse.dragStartY = e.clientY;
      state.mouse.dragStartCenterIndex = state.view.centerIndex;
      state.mouse.dragStartPriceCenter = state.view.priceCenter;
      if (e.button === 0) handleToolClick(e);
    } catch(err) { showToast('Click error: ' + err.message, 'error'); }
  });

  canvas.addEventListener('mouseup', (e) => {
    try {
      if (state.drawingState && state.mouse.isDown) finalizeDrawing();
      state.mouse.isDown = false;
    } catch(err) {}
  });

  // === Part 2: Wheel — time zoom (cursor-centered) ===
  // Part 3: Ctrl+wheel = price zoom, Shift+wheel = horizontal pan
  canvas.addEventListener('wheel', (e) => {
    try {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.shiftKey) {
        // Part 3: Shift+wheel = vertical price zoom
        const factor = e.deltaY > 0 ? 1.1 : 0.91;
        const priceAtMouse = screenToPriceY(mouseY);
        state.view.pricePerPixel *= factor;
        state.view.pricePerPixel = clamp(state.view.pricePerPixel, 0.00001, 100000);
        state.view.priceCenter = priceAtMouse + (state.height / 2 - mouseY) * state.view.pricePerPixel;
        state.view.manualPrice = true;
      } else if (e.ctrlKey || e.metaKey) {
        // Part 2: Ctrl+wheel = time axis zoom (cursor-centered)
        const factor = e.deltaY > 0 ? ZOOM_FACTOR_WHEEL : 1 / ZOOM_FACTOR_WHEEL;
        zoomAtScreenX(mouseX, factor);
      } else {
        // Default wheel: horizontal pan (scroll through time)
        const panAmount = e.deltaY * 0.3;
        const cpw = getCandlePixelWidth();
        state.view.centerIndex += panAmount / cpw;
        state.view.userModified = true;
      }

      state.followLive = false;
      state._priceScaleDirty = true;
      document.getElementById('btn-follow-live').classList.remove('active');
    } catch(err) { showToast('Zoom error: ' + err.message, 'error'); }
  }, { passive: false });

  // === Part 3: Double-click price axis to reset autoscale ===
  canvas.addEventListener('dblclick', (e) => {
    try {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const chartW = state.width - state.priceScaleWidth;
      // If double-click on price scale area, reset price autoscale
      if (mouseX > chartW - 10) {
        state.view.autoScalePrice = true;
        state.view.manualPrice = false;
        state._priceScaleDirty = true;
        document.getElementById('btn-auto-scale').classList.add('active');
        showToast('Price autoscale reset', 'info');
      }
    } catch(err) {}
  });

  // === Keyboard ===
  document.addEventListener('keydown', (e) => {
    try {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      const chartW = state.width - state.priceScaleWidth;

      switch (e.key) {
        case 'Escape':
          if (state.drawingState) { state.drawingState = null; }
          else if (state.activeTool !== 'cursor') { setActiveTool('cursor'); state.selectedRange = null; updateRangePanel(); }
          else { state.selectedRange = null; updateRangePanel(); }
          break;
        case 'r': case 'R': setActiveTool('range'); break;
        case 'Delete': case 'Backspace': deleteSelectedDrawing(); break;
        case 'f': case 'F': fitAll(); break;

        // Part 2: Keyboard zoom
        case '=': case '+':
          zoomAtScreenX(chartW / 2, 1 / ZOOM_FACTOR_BTN);
          state.view.userModified = true; state.followLive = false; state._priceScaleDirty = true;
          document.getElementById('btn-follow-live').classList.remove('active');
          break;
        case '-': case '_':
          zoomAtScreenX(chartW / 2, ZOOM_FACTOR_BTN);
          state.view.userModified = true; state.followLive = false; state._priceScaleDirty = true;
          document.getElementById('btn-follow-live').classList.remove('active');
          break;

        // Part 1: '0' key = reset viewport
        case '0':
          resetToDefaultView();
          break;

        // Part 1: Home = snap to live
        case 'Home':
          snapToLive();
          state.followLive = true;
          state.view.userModified = false;
          document.getElementById('btn-follow-live').classList.add('active');
          break;
      }
    } catch(err) {}
  });
}

function handleToolClick(e) {
  const x = state.mouse.x;
  const price = state.mouse.price;
  switch (state.activeTool) {
    case 'cursor': break;
    case 'hline': state.drawings.push({ type: 'hline', price, color: COL.drawing }); saveDrawings(); setActiveTool('cursor'); break;
    case 'trendline': if (!state.drawingState) state.drawingState = { type: 'trendline', x1: x, price1: price, x2: x, price2: price, color: COL.drawing }; break;
    case 'rect': if (!state.drawingState) state.drawingState = { type: 'rect', x1: x, price1: price, x2: x, price2: price, color: COL.drawing }; break;
    case 'text': const text = prompt('Enter label:'); if (text) { state.drawings.push({ type: 'text', x, price, text, color: COL.drawing }); saveDrawings(); } setActiveTool('cursor'); break;
    case 'range': if (!state.drawingState) state.drawingState = { type: 'range', x1: x, price1: price, x2: x, price2: price }; break;
  }
}

function updateDrawingState(x, price) {
  if (!state.drawingState) return;
  state.drawingState.x2 = x; state.drawingState.price2 = price;
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
      if (state.wsReady && state.symbol) state.ws.send(JSON.stringify({ type: 'get_profile', symbol: state.symbol, start: state.selectedRange.start, end: state.selectedRange.end, priceLow, priceHigh }));
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

  const sc = document.getElementById('source-content');
  if (!sc) return;
  sc.innerHTML = `
    <div class="row"><span class="label">Read:</span><span class="val green">Hyperliquid</span></div>
    <div class="row"><span class="label">HL connected:</span><span class="val ${hlConn?'green':'red'}">${hlConn?'yes':'no'}</span></div>
    <div class="row"><span class="label">HL trades:</span><span class="val ${ss.hyperliquidTradesSubscribed?'green':'red'}">${ss.hyperliquidTradesSubscribed?'active':'no'}</span></div>
    <div class="row"><span class="label">Exec ref:</span><span class="val">Binance USD-M</span></div>
    <div class="row"><span class="label">BN connected:</span><span class="val ${ss.binanceUsdmReferenceConnected?'green':'yellow'}">${ss.binanceUsdmReferenceConnected?'yes':'reference only'}</span></div>
    <div class="row"><span class="label">BN aggTrade:</span><span class="val ${ss.binanceUsdmLiveTradeReceiving?'green':'yellow'}">${ss.binanceUsdmLiveTradeReceiving?'active':'not active'}</span></div>
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
      <div class="row"><span class="label">Zoom:</span><span class="val">${Math.round(state.view.candlesVisible)} candles</span></div>
      <div class="row"><span class="label">Price:</span><span class="val ${state.view.manualPrice?'yellow':''}">${state.view.manualPrice ? 'Manual' : 'Auto'}</span></div>
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

// Scanner
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
    if (state.followLive) { snapToLive(); state.view.manualPrice = false; state._priceScaleDirty = true; }
  });
  document.getElementById('btn-fit-all').addEventListener('click', fitAll);
  document.getElementById('btn-reset').addEventListener('click', resetToDefaultView);
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    const chartW = state.width - state.priceScaleWidth;
    zoomAtScreenX(chartW / 2, 1 / ZOOM_FACTOR_BTN);
    state.view.userModified = true; state.followLive = false; state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const chartW = state.width - state.priceScaleWidth;
    zoomAtScreenX(chartW / 2, ZOOM_FACTOR_BTN);
    state.view.userModified = true; state.followLive = false; state._priceScaleDirty = true;
    document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-auto-scale').addEventListener('click', () => {
    state.view.autoScalePrice = !state.view.autoScalePrice;
    state.view.manualPrice = false;
    document.getElementById('btn-auto-scale').classList.toggle('active', state.view.autoScalePrice);
    if (state.view.autoScalePrice) state._priceScaleDirty = true;
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
  state.lastValidViewport = null;

  // Part 1: Reset to default view on symbol change
  state.view.centerIndex = 0;
  state.view.candlesVisible = DEFAULT_CANDLES_VISIBLE;
  state.view.priceCenter = 0;
  state.view.pricePerPixel = 0.05;
  state.view.autoScalePrice = true;
  state.view.manualPrice = false;
  state.view.userModified = false;
  state.followLive = true;
  document.getElementById('btn-follow-live').classList.add('active');
  document.getElementById('btn-auto-scale').classList.add('active');

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

function fetchScannerData() {
  fetch(`/api/scanner?mode=${state.scannerMode}`).then(r => r.json()).then(data => { state.scannerData = data; updateScannerUI(); }).catch(() => {});
}

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
