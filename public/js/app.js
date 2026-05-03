// Orderflow Cockpit — Frontend Application
// Chart renderer + bubbles + zones + drawing tools + range profile + scanner

(function() {
'use strict';

// ============ STATE ============
const state = {
  symbol: null,
  interval: '40s',
  followLive: true,
  activeTool: 'cursor',
  source: 'hyperliquid',
  sourceStatus: {},
  isSpotFallback: false,

  // Chart data
  candles: [],
  currentCandle: null,
  bubbles: [],
  zones: [],

  // View transform
  view: {
    offsetX: 0,      // pixel offset from right
    scaleX: 8,       // pixels per candle
    pricePerPixel: 0.05,
    scrollY: 0,      // vertical scroll
  },

  // Mouse
  mouse: { x: 0, y: 0, price: 0, time: 0, isDown: false, button: 0 },
  hoveredCandle: null,
  hoveredBubble: null,

  // Drawing
  drawings: [],       // saved drawings
  drawingState: null, // in-progress drawing

  // Selected range
  selectedRange: null, // { start, end, priceLow, priceHigh, profile }

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
};

// Price colors
const COL = {
  bg: '#0a0e17',
  grid: '#141c2b',
  gridText: '#3d4a5e',
  candleUp: '#22c55e',
  candleDown: '#ef4444',
  candleUpFill: '#22c55e',
  candleDownFill: '#ef4444',
  wickUp: '#22c55e',
  wickDown: '#ef4444',
  volume: 'rgba(59,130,246,0.3)',
  bubbleAccepted: '#22c55e',
  bubbleRejected: '#ef4444',
  bubbleAbsorbed: '#f59e0b',
  bubbleExhausted: '#6b7280',
  zone: 'rgba(245,158,11,0.08)',
  zoneBorder: 'rgba(245,158,11,0.3)',
  poc: '#f59e0b',
  vah: '#3b82f6',
  val: '#3b82f6',
  deltaPoc: '#a855f7',
  hvn: 'rgba(59,130,246,0.15)',
  lvn: 'rgba(168,85,247,0.1)',
  crosshair: 'rgba(148,163,184,0.3)',
  selection: 'rgba(245,158,11,0.15)',
  selectionBorder: '#f59e0b',
  drawing: '#3b82f6',
  drawingActive: '#f59e0b',
};

// ============ WEBSOCKET ============
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${protocol}://${location.host}`);

  state.ws.onopen = () => {
    state.wsReady = true;
    console.log('[WS] Connected');
    if (state.symbol) {
      state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol: state.symbol }));
    }
  };

  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleMessage(msg);
    } catch (err) {}
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    console.log('[WS] Disconnected, reconnecting...');
    setTimeout(connectWS, 2000);
  };

  state.ws.onerror = () => {};
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'source_status':
      state.sourceStatus = msg.data;
      state.isSpotFallback = msg.data.isSpotFallback || false;
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
      // Keep last 500 bubbles
      if (state.bubbles.length > 500) state.bubbles = state.bubbles.slice(-500);
      break;

    case 'snapshot':
      if (msg.data.symbol !== state.symbol) break;
      state.candles = (msg.data.historical || []).map(c => ({
        ...c,
        priceMap: c.priceMap || {}
      }));
      state.currentCandle = msg.data.current || null;
      // Extract bubbles from candles
      state.bubbles = [];
      for (const c of state.candles) {
        if (c.bubbles) {
          for (const b of c.bubbles) {
            b.candleTime = c.openTime;
            state.bubbles.push(b);
          }
        }
      }
      if (state.followLive) fitAll();
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
      updateSymbolDropdown(msg.data);
      break;

    case 'scanner':
      state.scannerData = msg.data;
      updateScannerUI();
      break;
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

  // Clear
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, w, h);

  if (!state.candles.length && !state.currentCandle) {
    ctx.fillStyle = COL.gridText;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select a symbol to begin', w / 2, h / 2);
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

  // Price scale
  const priceCenter = scrollY + h / 2;
  const priceToY = (price) => priceCenter - (price / pricePerPixel);
  const yToPrice = (y) => (priceCenter - y) * pricePerPixel;

  // Visible range
  const rightEdge = w - 60; // price scale width
  const visibleCount = Math.ceil(w / candleW) + 2;
  const startIdx = Math.max(0, allCandles.length - visibleCount - Math.floor(offsetX / candleW));
  const endIdx = Math.min(allCandles.length, startIdx + visibleCount + 4);
  const visible = allCandles.slice(startIdx, endIdx);

  if (!visible.length) { requestAnimationFrame(render); return; }

  // Auto-fit price if follow live
  if (state.followLive) {
    let minP = Infinity, maxP = -Infinity;
    for (const c of visible) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }
    const range = maxP - minP || 1;
    state.view.pricePerPixel = range / (h * 0.85);
    state.view.scrollY = ((minP + maxP) / 2) / state.view.pricePerPixel - h / 2;
  }

  // Grid
  drawGrid(ctx, w, h, priceToY, yToPrice, rightEdge);

  // Zones
  drawZones(ctx, w, h, priceToY, rightEdge);

  // Volume bars
  drawVolumeBars(ctx, visible, startIdx, allCandles, candleW, gap, priceToY, h, rightEdge);

  // Candles
  drawCandles(ctx, visible, startIdx, candleW, gap, bodyW, priceToY, rightEdge);

  // Bubbles
  drawBubbles(ctx, visible, startIdx, candleW, priceToY, rightEdge);

  // Selected range overlay
  if (state.selectedRange) {
    drawSelectedRange(ctx, priceToY, yToPrice, rightEdge);
  }

  // Drawings
  drawDrawings(ctx, priceToY, rightEdge, startIdx, candleW, allCandles);

  // Active drawing
  if (state.drawingState) {
    drawActiveDrawing(ctx, priceToY, rightEdge, startIdx, candleW, allCandles);
  }

  // Price scale
  drawPriceScale(ctx, w, h, yToPrice, rightEdge);

  // Crosshair
  drawCrosshair(ctx, w, h, rightEdge, yToPrice, priceToY, startIdx, candleW, allCandles);

  // Time labels
  drawTimeLabels(ctx, visible, startIdx, candleW, h, rightEdge);

  requestAnimationFrame(render);
}

function drawGrid(ctx, w, h, priceToY, yToPrice, rightEdge) {
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 0.5;

  // Horizontal grid lines
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

    ctx.fillStyle = COL.gridText;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    // Label on right
  }
  ctx.stroke();

  // Vertical grid lines (time)
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

function drawCandles(ctx, visible, startIdx, candleW, gap, bodyW, priceToY, rightEdge) {
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const x = rightEdge - (visible.length - 1 - i) * candleW - candleW / 2;
    if (x < -candleW || x > rightEdge + candleW) continue;

    const isUp = c.close >= c.open;
    const color = isUp ? COL.candleUp : COL.candleDown;

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

    ctx.fillStyle = color;
    ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
  }
}

function drawVolumeBars(ctx, visible, startIdx, allCandles, candleW, gap, priceToY, h, rightEdge) {
  if (!visible.length) return;
  const maxVol = Math.max(...visible.map(c => c.volume || 0), 1);
  const barMaxH = h * 0.12;

  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const x = rightEdge - (visible.length - 1 - i) * candleW - candleW / 2;
    if (x < -candleW || x > rightEdge + candleW) continue;

    const barH = ((c.volume || 0) / maxVol) * barMaxH;
    const isUp = c.close >= c.open;

    ctx.fillStyle = isUp ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
    ctx.fillRect(x - (candleW - gap) / 2, h - barH, candleW - gap, barH);
  }
}

function drawBubbles(ctx, visible, startIdx, candleW, priceToY, rightEdge) {
  // Group bubbles by candle time
  const candleMap = new Map();
  for (const c of visible) {
    candleMap.set(c.openTime, c);
  }

  // Cluster bubbles by price proximity
  const clusters = [];
  const clusterThreshold = 3; // pixels

  for (const bubble of state.bubbles) {
    const cIdx = visible.findIndex(c => c.openTime === bubble.candleTime);
    if (cIdx < 0) continue;
    const c = visible[cIdx];
    const x = rightEdge - (visible.length - 1 - cIdx) * candleW - candleW / 2;
    const y = priceToY(bubble.price);

    // Find existing cluster
    let merged = false;
    for (const cluster of clusters) {
      if (Math.abs(cluster.x - x) < candleW && Math.abs(cluster.y - y) < clusterThreshold * 2) {
        cluster.bubbles.push(bubble);
        cluster.totalNotional += bubble.notional || 0;
        cluster.y = (cluster.y * cluster.bubbles.length + y) / (cluster.bubbles.length + 1);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ x, y, bubbles: [bubble], totalNotional: bubble.notional || 0 });
    }
  }

  for (const cluster of clusters) {
    const { x, y, bubbles: bubs } = cluster;
    const count = bubs.length;
    const mainBubble = bubs.reduce((a, b) => (b.notional || 0) > (a.notional || 0) ? b : a, bubs[0]);
    const side = mainBubble.side;
    const state_ = mainBubble.state || 'accepted';

    // Color by state
    let color, fillAlpha = 0.6, strokeAlpha = 1;
    switch (state_) {
      case 'accepted':
        color = side === 'buy' ? COL.bubbleAccepted : COL.bubbleRejected;
        fillAlpha = 0.4;
        break;
      case 'rejected':
        color = COL.bubbleRejected;
        fillAlpha = 0.1;
        break;
      case 'absorbed':
        color = COL.bubbleAbsorbed;
        fillAlpha = 0.3;
        break;
      case 'exhausted':
        color = COL.bubbleExhausted;
        fillAlpha = 0.2;
        break;
      default:
        color = side === 'buy' ? COL.bubbleAccepted : COL.bubbleRejected;
    }

    // Size
    const radius = Math.min(12, Math.max(3, Math.sqrt(cluster.totalNotional / 1000)));

    // Draw
    if (state_ === 'rejected') {
      // Hollow ring
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      // Warning outline
      ctx.strokeStyle = 'rgba(239,68,68,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (state_ === 'absorbed') {
      // Halo
      ctx.fillStyle = `rgba(245,158,11,${fillAlpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (state_ === 'exhausted') {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Accepted — filled with glow
      ctx.fillStyle = color;
      ctx.globalAlpha = fillAlpha;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Count label
    if (count > 1) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${count}`, x, y);
    }

    // Hover detection
    const dx = state.mouse.x - x;
    const dy = state.mouse.y - y;
    if (dx * dx + dy * dy < (radius + 4) * (radius + 4)) {
      state.hoveredBubble = { x, y, cluster, mainBubble };
    }
  }
}

function drawZones(ctx, w, h, priceToY, rightEdge) {
  for (const zone of state.zones) {
    const y1 = priceToY(zone.priceHigh);
    const y2 = priceToY(zone.priceLow);
    const zoneH = y2 - y1;

    ctx.fillStyle = COL.zone;
    ctx.fillRect(0, y1, rightEdge, zoneH);

    ctx.strokeStyle = COL.zoneBorder;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y1);
    ctx.lineTo(rightEdge, y1);
    ctx.moveTo(0, y2);
    ctx.lineTo(rightEdge, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Compact label right side
    ctx.fillStyle = 'rgba(245,158,11,0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(zone.type.replace(/_/g, ' '), rightEdge - 4, (y1 + y2) / 2 + 3);
  }
}

function drawSelectedRange(ctx, priceToY, yToPrice, rightEdge) {
  const sr = state.selectedRange;
  if (!sr) return;

  const allCandles = [...state.candles];
  if (state.currentCandle) allCandles.push(state.currentCandle);

  // Find candle indices
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
  ctx.fillRect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);
  ctx.strokeStyle = COL.selectionBorder;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1);

  // Profile overlay
  if (sr.profile) {
    drawProfileOverlay(ctx, sr.profile, Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1, priceToY, yToPrice);
  }
}

function drawProfileOverlay(ctx, profile, boxX, boxY, boxW, boxH, priceToY, yToPrice) {
  if (!profile.levels || !profile.levels.length) return;

  const maxVol = Math.max(...profile.levels.map(l => l.total), 1);
  const maxDelta = Math.max(...profile.levels.map(l => Math.abs(l.delta)), 1);
  const profileW = boxW * 0.4; // Profile takes 40% of box width

  // Volume profile bars
  for (const level of profile.levels) {
    const y = priceToY(level.price);
    const barW = (level.total / maxVol) * profileW;
    const binH = Math.max(1, boxH / profile.levels.length);

    // Volume bar
    ctx.fillStyle = 'rgba(59,130,246,0.25)';
    ctx.fillRect(boxX, y - binH / 2, barW, binH);

    // Delta overlay
    const deltaW = (Math.abs(level.delta) / maxDelta) * profileW * 0.3;
    ctx.fillStyle = level.delta > 0 ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
    const dX = level.delta > 0 ? boxX + barW : boxX + barW - deltaW;
    ctx.fillRect(dX, y - binH / 2, deltaW, binH);
  }

  // POC line
  if (profile.poc) {
    const pocY = priceToY(profile.poc);
    ctx.strokeStyle = COL.poc;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(boxX, pocY);
    ctx.lineTo(boxX + boxW, pocY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.poc;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`POC ${profile.poc.toFixed(2)}`, boxX + 4, pocY - 4);
  }

  // VAH/VAL
  if (profile.vah) {
    const vahY = priceToY(profile.vah);
    ctx.strokeStyle = COL.vah;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(boxX, vahY);
    ctx.lineTo(boxX + boxW, vahY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.vah;
    ctx.font = '8px monospace';
    ctx.fillText(`VAH ${profile.vah.toFixed(2)}`, boxX + 4, vahY - 3);
  }
  if (profile.val) {
    const valY = priceToY(profile.val);
    ctx.strokeStyle = COL.val;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(boxX, valY);
    ctx.lineTo(boxX + boxW, valY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.val;
    ctx.font = '8px monospace';
    ctx.fillText(`VAL ${profile.val.toFixed(2)}`, boxX + 4, valY + 10);
  }

  // Delta POC
  if (profile.deltaPoc) {
    const dpY = priceToY(profile.deltaPoc);
    ctx.strokeStyle = COL.deltaPoc;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(boxX, dpY);
    ctx.lineTo(boxX + boxW, dpY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.deltaPoc;
    ctx.font = '8px monospace';
    ctx.fillText(`ΔPOC ${profile.deltaPoc.toFixed(2)}`, boxX + boxW - 4, dpY - 3);
    ctx.textAlign = 'left';
  }

  // HVN/LVN highlights
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

function drawPriceScale(ctx, w, h, yToPrice, rightEdge) {
  // Background
  ctx.fillStyle = '#111827';
  ctx.fillRect(rightEdge, 0, w - rightEdge, h);

  // Price labels
  ctx.fillStyle = COL.gridText;
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';

  const priceStep = estimatePriceStep(state.view.pricePerPixel, h);
  const topPrice = yToPrice(0);
  const botPrice = yToPrice(h);
  const startPrice = Math.floor(Math.min(topPrice, botPrice) / priceStep) * priceStep;

  for (let p = startPrice; p <= Math.max(topPrice, botPrice); p += priceStep) {
    const y = (state.view.scrollY + h / 2) - (p / state.view.pricePerPixel);
    if (y < 10 || y > h - 10) continue;
    ctx.fillText(formatPrice(p), rightEdge + 4, y + 3);
  }

  // Current price
  if (state.currentCandle) {
    const cy = (state.view.scrollY + h / 2) - (state.currentCandle.close / state.view.pricePerPixel);
    const isUp = state.currentCandle.close >= state.currentCandle.open;
    ctx.fillStyle = isUp ? COL.candleUp : COL.candleDown;
    ctx.fillRect(rightEdge, cy - 8, w - rightEdge, 16);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(formatPrice(state.currentCandle.close), rightEdge + 4, cy + 4);
  }
}

function drawCrosshair(ctx, w, h, rightEdge, yToPrice, priceToY, startIdx, candleW, allCandles) {
  if (state.mouse.x < 0 || state.mouse.x > w || state.mouse.y < 0 || state.mouse.y > h) return;
  if (state.mouse.x > rightEdge) return;

  ctx.strokeStyle = COL.crosshair;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);

  // Horizontal
  ctx.beginPath();
  ctx.moveTo(0, state.mouse.y);
  ctx.lineTo(rightEdge, state.mouse.y);
  ctx.stroke();

  // Vertical
  ctx.beginPath();
  ctx.moveTo(state.mouse.x, 0);
  ctx.lineTo(state.mouse.x, h);
  ctx.stroke();

  ctx.setLineDash([]);

  // Price label
  const price = yToPrice(state.mouse.y);
  const label = document.getElementById('crosshair-label');
  label.classList.remove('hidden');
  label.style.left = (rightEdge + 2) + 'px';
  label.style.top = (state.mouse.y - 10) + 'px';
  label.textContent = formatPrice(price);

  // Hover tooltip
  updateTooltip(allCandles, candleW, rightEdge, startIdx);
}

function drawTimeLabels(ctx, visible, startIdx, candleW, h, rightEdge) {
  ctx.fillStyle = COL.gridText;
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';

  for (let i = 0; i < visible.length; i += 10) {
    const c = visible[i];
    const x = rightEdge - (visible.length - 1 - i) * candleW - candleW / 2;
    const t = new Date(c.openTime);
    const label = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`;
    ctx.fillText(label, x, h - 4);
  }
}

function drawDrawings(ctx, priceToY, rightEdge, startIdx, candleW, allCandles) {
  for (const d of state.drawings) {
    drawSingleDrawing(ctx, d, priceToY, rightEdge, startIdx, candleW, allCandles);
  }
}

function drawActiveDrawing(ctx, priceToY, rightEdge, startIdx, candleW, allCandles) {
  drawSingleDrawing(ctx, state.drawingState, priceToY, rightEdge, startIdx, candleW, allCandles);
}

function drawSingleDrawing(ctx, d, priceToY, rightEdge, startIdx, candleW, allCandles) {
  if (!d) return;
  ctx.strokeStyle = d.color || COL.drawing;
  ctx.lineWidth = 1.5;

  switch (d.type) {
    case 'hline': {
      const y = priceToY(d.price);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rightEdge, y);
      ctx.stroke();
      ctx.fillStyle = d.color || COL.drawing;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`— ${formatPrice(d.price)}`, 4, y - 4);
      break;
    }
    case 'trendline': {
      const y1 = priceToY(d.price1);
      const y2 = priceToY(d.price2);
      ctx.beginPath();
      ctx.moveTo(d.x1, y1);
      ctx.lineTo(d.x2, y2);
      ctx.stroke();
      break;
    }
    case 'rect': {
      const y1 = priceToY(d.priceHigh);
      const y2 = priceToY(d.priceLow);
      ctx.fillStyle = 'rgba(59,130,246,0.08)';
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

// ============ HELPERS ============
function estimatePriceStep(pricePerPixel, h) {
  const totalRange = h * pricePerPixel;
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const target = totalRange / 8;
  for (const s of steps) {
    if (s >= target) return s;
  }
  return steps[steps.length - 1];
}

function formatPrice(p) {
  if (p === null || p === undefined) return '—';
  if (Math.abs(p) >= 1000) return p.toFixed(1);
  if (Math.abs(p) >= 100) return p.toFixed(2);
  if (Math.abs(p) >= 1) return p.toFixed(3);
  if (Math.abs(p) >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function formatNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

function fitAll() {
  state.view.offsetX = 0;
  state.followLive = true;
  document.getElementById('btn-follow-live').classList.add('active');
}

// ============ TOOLTIP ============
function updateTooltip(allCandles, candleW, rightEdge, startIdx) {
  const tooltip = document.getElementById('hover-tooltip');

  // Find hovered candle
  const visibleCount = Math.floor(state.width / candleW) + 2;
  const si = Math.max(0, allCandles.length - visibleCount - Math.floor(state.view.offsetX / candleW));
  const idx = Math.floor((rightEdge - state.mouse.x) / candleW);
  const candleIdx = allCandles.length - 1 - (si + (visibleCount - 1 - idx));

  if (candleIdx >= 0 && candleIdx < allCandles.length) {
    const c = allCandles[candleIdx];
    state.hoveredCandle = c;
    const t = new Date(c.openTime);
    const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`;

    tooltip.classList.remove('hidden');
    tooltip.style.left = (state.mouse.x + 15) + 'px';
    tooltip.style.top = (state.mouse.y - 10) + 'px';
    tooltip.innerHTML = `
      <div style="color:#94a3b8;margin-bottom:4px">${timeStr}</div>
      <div>O: ${formatPrice(c.open)} H: ${formatPrice(c.high)}</div>
      <div>L: ${formatPrice(c.low)} C: ${formatPrice(c.close)}</div>
      <div>Vol: ${formatNum(c.volume)} | Δ: ${c.delta > 0 ? '+' : ''}${formatNum(c.delta)}</div>
      <div>Trades: ${c.tradeCount} | Bubbles: ${c.bubbleCount || 0}</div>
      <div>Absorb: ${c.absorptionCount || 0} | Reject: ${c.rejectionCount || 0}</div>
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
    tooltip.innerHTML = `
      <div style="color:${bub.side === 'buy' ? '#22c55e' : '#ef4444'};font-weight:bold">${bub.side.toUpperCase()} BUBBLE</div>
      <div>Price: ${formatPrice(bub.price)}</div>
      <div>Size: ${formatNum(bub.qty)}</div>
      <div>Notional: $${formatNum(bub.notional)}</div>
      <div>State: ${bub.state || 'accepted'}</div>
      <div>Count: ${b.bubbles.length}</div>
    `;
    state.hoveredBubble = null;
  }
}

// ============ INPUT HANDLING ============
function initInput() {
  const canvas = state.canvas;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;

    // Update price/time
    state.mouse.price = (state.view.scrollY + state.height / 2 - state.mouse.y) * state.view.pricePerPixel;

    // Pan if dragging
    if (state.mouse.isDown && state.mouse.button === 0 && state.activeTool === 'cursor') {
      state.view.offsetX += e.movementX / state.view.scaleX;
      state.view.scrollY -= e.movementY;
      state.followLive = false;
      document.getElementById('btn-follow-live').classList.remove('active');
    }

    // Drawing state update
    if (state.drawingState && state.mouse.isDown) {
      updateDrawingState(state.mouse.x, state.mouse.price);
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    state.mouse.isDown = true;
    state.mouse.button = e.button;

    if (e.button === 0) {
      handleToolClick(e);
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (state.drawingState && state.mouse.isDown) {
      finalizeDrawing();
    }
    state.mouse.isDown = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Vertical zoom
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      state.view.pricePerPixel *= factor;
    } else if (e.shiftKey) {
      // Horizontal pan
      state.view.offsetX -= e.deltaY / state.view.scaleX;
    } else {
      // Horizontal zoom
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      state.view.scaleX = Math.max(2, Math.min(50, state.view.scaleX * factor));
    }
    state.followLive = false;
    document.getElementById('btn-follow-live').classList.remove('active');
  }, { passive: false });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.key) {
      case 'Escape':
        setActiveTool('cursor');
        state.drawingState = null;
        state.selectedRange = null;
        updateRangePanel();
        break;
      case 'r':
      case 'R':
        setActiveTool('range');
        break;
      case 'Delete':
      case 'Backspace':
        deleteSelectedDrawing();
        break;
      case 'f':
      case 'F':
        fitAll();
        break;
    }
  });
}

function handleToolClick(e) {
  const x = state.mouse.x;
  const price = state.mouse.price;

  switch (state.activeTool) {
    case 'cursor':
      // Selection handled in mousemove
      break;
    case 'hline':
      state.drawings.push({ type: 'hline', price, color: COL.drawing });
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
      const text = prompt('Enter label (e.g., absorption, rejection, seller defense):');
      if (text) {
        state.drawings.push({ type: 'text', x, price, text, color: COL.drawing });
      }
      setActiveTool('cursor');
      break;
    case 'range':
      if (!state.drawingState) {
        state.drawingState = { type: 'range', x1: x, price1: price, x2: x, price2: price };
      }
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
    // Compute selected range profile
    const allCandles = [...state.candles];
    if (state.currentCandle) allCandles.push(state.currentCandle);

    // Find time range from x positions
    const visibleCount = Math.floor(state.width / state.view.scaleX) + 2;
    const si = Math.max(0, allCandles.length - visibleCount - Math.floor(state.view.offsetX / state.view.scaleX));

    const priceHigh = Math.max(d.price1, d.price2);
    const priceLow = Math.min(d.price1, d.price2);

    // Find candles in the selected price range and approximate time range
    const matchingCandles = allCandles.filter(c => {
      const mid = (c.high + c.low) / 2;
      return mid >= priceLow && mid <= priceHigh;
    });

    if (matchingCandles.length > 0) {
      const start = matchingCandles[0].openTime;
      const end = matchingCandles[matchingCandles.length - 1].openTime;

      state.selectedRange = {
        start,
        end,
        priceLow,
        priceHigh,
        profile: null
      };

      // Request profile from server
      if (state.wsReady && state.symbol) {
        state.ws.send(JSON.stringify({
          type: 'get_profile',
          symbol: state.symbol,
          start,
          end,
          priceLow,
          priceHigh
        }));
      }
    }
  } else if (d.type === 'trendline' || d.type === 'rect') {
    state.drawings.push({ ...d });
  }

  state.drawingState = null;
}

function deleteSelectedDrawing() {
  // Delete last drawing
  if (state.drawings.length > 0) {
    state.drawings.pop();
  }
}

// ============ UI UPDATES ============
function setActiveTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  state.canvas.style.cursor = tool === 'cursor' ? 'grab' : 'crosshair';
}

function updateSourceUI() {
  const ss = state.sourceStatus;
  const pill = document.getElementById('active-source');
  const quality = document.getElementById('data-quality');
  const execRef = document.getElementById('exec-ref');
  const warning = document.getElementById('fallback-warning');

  if (ss.hyperliquid === 'connected') {
    pill.textContent = 'HL';
    pill.classList.add('active');
    quality.textContent = 'Quality: Good';
  } else if (ss.binance_futures === 'connected') {
    pill.textContent = 'Binance-F';
    pill.classList.add('active');
    quality.textContent = 'Quality: OK';
  } else if (ss.binance_spot === 'connected') {
    pill.textContent = 'Spot';
    pill.classList.remove('active');
    quality.textContent = 'Quality: Fallback';
  } else {
    pill.textContent = '—';
    pill.classList.remove('active');
    quality.textContent = 'Quality: Disconnected';
  }

  if (state.isSpotFallback) {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }

  // Exec ref
  if (state.symbol) {
    const mapped = symbolToBinance(state.symbol);
    execRef.textContent = mapped ? `Exec: ${mapped}` : 'Exec: —';
  }

  // Source content panel
  const sc = document.getElementById('source-content');
  sc.innerHTML = `
    <div class="row"><span class="label">Read:</span><span class="val">${ss.hyperliquid === 'connected' ? 'Hyperliquid' : ss.binance_futures === 'connected' ? 'Binance Futures' : 'Spot (fallback)'}</span></div>
    <div class="row"><span class="label">HL:</span><span class="val ${ss.hyperliquid === 'connected' ? 'green' : 'red'}">${ss.hyperliquid || '—'}</span></div>
    <div class="row"><span class="label">B.Futures:</span><span class="val ${ss.binance_futures === 'connected' ? 'green' : 'red'}">${ss.binance_futures || '—'}</span></div>
    <div class="row"><span class="label">B.Spot:</span><span class="val ${ss.binance_spot === 'connected' ? 'green' : 'red'}">${ss.binance_spot || '—'}</span></div>
    <div class="row"><span class="label">Spot FB:</span><span class="val ${state.isSpotFallback ? 'red' : 'green'}">${state.isSpotFallback ? 'YES' : 'NO'}</span></div>
  `;
}

function updateRangePanel() {
  const el = document.getElementById('range-content');
  const sr = state.selectedRange;

  if (!sr) {
    el.innerHTML = 'Select a range on chart';
    return;
  }

  if (!sr.profile) {
    el.innerHTML = '<div style="color:#f59e0b">Computing profile...</div>';
    return;
  }

  const p = sr.profile;
  const tStart = new Date(sr.start);
  const tEnd = new Date(sr.end);
  const timeStr = `${tStart.toTimeString().slice(0, 8)} → ${tEnd.toTimeString().slice(0, 8)}`;

  el.innerHTML = `
    <div class="row"><span class="label">Time:</span><span class="val">${timeStr}</span></div>
    <div class="row"><span class="label">Range:</span><span class="val">${formatPrice(sr.priceLow)} — ${formatPrice(sr.priceHigh)}</span></div>
    <div class="row"><span class="label">Volume:</span><span class="val">${formatNum(p.totalVolume)}</span></div>
    <div class="row"><span class="label">Buy Vol:</span><span class="val green">${formatNum(p.buyVolume)}</span></div>
    <div class="row"><span class="label">Sell Vol:</span><span class="val red">${formatNum(p.sellVolume)}</span></div>
    <div class="row"><span class="label">Delta:</span><span class="val ${p.delta > 0 ? 'green' : 'red'}">${p.delta > 0 ? '+' : ''}${formatNum(p.delta)}</span></div>
    <div class="row"><span class="label">POC:</span><span class="val" style="color:#f59e0b">${formatPrice(p.poc)}</span></div>
    <div class="row"><span class="label">VAH:</span><span class="val" style="color:#3b82f6">${formatPrice(p.vah)}</span></div>
    <div class="row"><span class="label">VAL:</span><span class="val" style="color:#3b82f6">${formatPrice(p.val)}</span></div>
    <div class="row"><span class="label">ΔPOC:</span><span class="val" style="color:#a855f7">${formatPrice(p.deltaPoc)}</span></div>
    <div class="row"><span class="label">VWAP:</span><span class="val">${formatPrice(p.vwap)}</span></div>
    <div class="row"><span class="label">Side:</span><span class="val ${p.dominantSide === 'buy' ? 'green' : p.dominantSide === 'sell' ? 'red' : ''}">${p.dominantSide}</span></div>
    <div class="row"><span class="label">Efficiency:</span><span class="val">${(p.directionalEfficiency * 100).toFixed(1)}%</span></div>
    <div class="row"><span class="label">Acceptance:</span><span class="val">${p.acceptance.replace(/_/g, ' ')}</span></div>
    <div class="row"><span class="label">Bubbles:</span><span class="val">${p.bubbleCount} (A:${p.bubbleStates.accepted} R:${p.bubbleStates.rejected} Ab:${p.bubbleStates.absorbed})</span></div>
    <div style="margin-top:6px;padding:4px;background:rgba(245,158,11,0.08);border-radius:3px;font-size:9px;color:#94a3b8">
      ${p.interpretation || '—'}
    </div>
  `;
}

function updateScannerUI() {
  const body = document.getElementById('scanner-body');
  if (!state.scannerData.length) {
    body.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#475569">No data yet...</td></tr>';
    return;
  }

  body.innerHTML = state.scannerData.map(s => `
    <tr class="${s.symbol === state.symbol ? 'selected' : ''}" onclick="window.__selectSymbol('${s.symbol}')">
      <td>
        <strong>${s.symbol}</strong>
        ${s.isPinned ? '<span class="pinned-badge">★</span>' : ''}
        ${s.isWatchlist ? '<span class="watchlist-badge">◆</span>' : ''}
      </td>
      <td><span class="tag-status tag-${s.status}">${s.status}</span></td>
      <td>${formatPrice(s.price)}</td>
      <td style="color:${s.priceChange > 0 ? '#22c55e' : '#ef4444'}">${s.priceChange > 0 ? '+' : ''}${s.priceChange.toFixed(2)}%</td>
      <td>${formatNum(s.volume)}</td>
      <td style="color:${s.delta > 0 ? '#22c55e' : '#ef4444'}">${s.delta > 0 ? '+' : ''}${formatNum(s.delta)}</td>
      <td>${s.tradeFrequency.toFixed(1)}/s</td>
      <td>${s.volatilityExpansion.toFixed(2)}%</td>
      <td>${s.bubbleCount}</td>
      <td>${s.absorptionCount}</td>
      <td>${s.source}</td>
      <td>${s.availableOnBinance ? s.binanceSymbol : '<span style="color:#475569">—</span>'}</td>
    </tr>
  `).join('');
}

function symbolToBinance(symbol) {
  const special = { 'PEPE': '1000PEPEUSDT', 'LUNC': '1000LUNCUSDT', 'SHIB': '1000SHIBUSDT', 'BONK': '1000BONKUSDT', 'FLOKI': '1000FLOKIUSDT' };
  return special[symbol] || `${symbol}USDT`;
}

function updateSymbolDropdown(coins) {
  // Store for symbol search
  window.__hlCoins = coins || [];
}

// ============ BUTTON HANDLERS ============
function initButtons() {
  document.getElementById('btn-follow-live').addEventListener('click', () => {
    state.followLive = !state.followLive;
    document.getElementById('btn-follow-live').classList.toggle('active', state.followLive);
    if (state.followLive) fitAll();
  });

  document.getElementById('btn-fit-all').addEventListener('click', fitAll);
  document.getElementById('btn-reset').addEventListener('click', () => {
    state.view = { offsetX: 0, scaleX: 8, pricePerPixel: 0.05, scrollY: 0 };
    state.followLive = true;
    document.getElementById('btn-follow-live').classList.add('active');
  });

  // Tool buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'delete') {
        deleteSelectedDrawing();
      } else {
        setActiveTool(btn.dataset.tool);
      }
    });
  });

  // Interval selector
  document.getElementById('interval-select').addEventListener('change', (e) => {
    state.interval = e.target.value;
    if (state.wsReady) {
      state.ws.send(JSON.stringify({ type: 'set_interval', interval: state.interval }));
    }
  });

  // Symbol input
  const symInput = document.getElementById('symbol-input');
  const symDropdown = document.getElementById('symbol-dropdown');

  symInput.addEventListener('focus', () => {
    showSymbolDropdown(symInput.value.toUpperCase());
  });

  symInput.addEventListener('input', (e) => {
    showSymbolDropdown(e.target.value.toUpperCase());
  });

  symInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = symInput.value.toUpperCase().trim();
      if (val) selectSymbol(val);
      symDropdown.classList.add('hidden');
    }
  });

  symInput.addEventListener('blur', () => {
    setTimeout(() => symDropdown.classList.add('hidden'), 200);
  });

  // Scanner mode
  document.getElementById('scanner-mode').addEventListener('change', (e) => {
    state.scannerMode = e.target.value;
    fetchScannerData();
  });

  // Bottom tabs
  document.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Source selector
  document.getElementById('source-select').addEventListener('change', (e) => {
    state.source = e.target.value;
  });
}

function showSymbolDropdown(filter) {
  const dropdown = document.getElementById('symbol-dropdown');
  const coins = window.__hlCoins || [];
  const filtered = filter ? coins.filter(c => c.startsWith(filter)).slice(0, 30) : coins.slice(0, 30);

  if (!filtered.length) {
    dropdown.classList.add('hidden');
    return;
  }

  dropdown.classList.remove('hidden');
  dropdown.innerHTML = filtered.map(c => `
    <div class="dropdown-item" onclick="window.__selectSymbol('${c}')">
      <span>${c}</span>
      <span class="tag">${symbolToBinance(c)}</span>
    </div>
  `).join('');
}

// ============ SYMBOL SELECTION ============
function selectSymbol(symbol) {
  state.symbol = symbol;
  state.candles = [];
  state.currentCandle = null;
  state.bubbles = [];
  state.zones = [];
  state.selectedRange = null;
  state.drawings = [];

  document.getElementById('symbol-input').value = symbol;
  document.getElementById('fp-symbol').textContent = symbol;

  updateRangePanel();
  updateSourceUI();

  if (state.wsReady) {
    state.ws.send(JSON.stringify({ type: 'subscribe_symbol', symbol }));
  }

  // Fetch scanner data
  fetchScannerData();
}

// Global access for onclick handlers
window.__selectSymbol = selectSymbol;

// ============ SCANNER FETCH ============
let scannerTimer = null;
function fetchScannerData() {
  fetch(`/scanner/overview?mode=${state.scannerMode}`)
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
      if (!data.levels || !Object.keys(data.levels).length) {
        el.innerHTML = '<div style="color:#475569">No footprint data</div>';
        return;
      }

      const levels = Object.entries(data.levels)
        .map(([price, l]) => ({ price: parseFloat(price), ...l }))
        .sort((a, b) => b.price - a.price);

      const maxTotal = Math.max(...levels.map(l => l.total), 1);
      const pocPrice = data.candle ? ((data.candle.high + data.candle.low) / 2) : 0;

      el.innerHTML = levels.map(l => {
        const buyPct = (l.buy / l.total * 100).toFixed(0);
        const sellPct = (l.sell / l.total * 100).toFixed(0);
        const isPoc = Math.abs(l.price - pocPrice) < data.candle?.high * 0.001;
        const delta = l.buy - l.sell;

        return `
          <div class="fp-row ${isPoc ? 'poc' : ''}">
            <span class="price-col">${formatPrice(l.price)}</span>
            <span class="buy-col"><span class="bar buy" style="width:${l.buy / maxTotal * 80}px"></span> ${formatNum(l.buy)}</span>
            <span class="sell-col">${formatNum(l.sell)} <span class="bar sell" style="width:${l.sell / maxTotal * 80}px"></span></span>
            <span class="delta-col" style="color:${delta > 0 ? '#22c55e' : '#ef4444'}">${delta > 0 ? '+' : ''}${formatNum(delta)}</span>
          </div>
        `;
      }).join('');
    })
    .catch(() => {});
}

// ============ INIT ============
function init() {
  initCanvas();
  initInput();
  initButtons();
  connectWS();
  startScannerPolling();

  // Footprint refresh
  setInterval(updateFootprint, 3000);

  // Start render loop
  requestAnimationFrame(render);

  // Select default symbol
  selectSymbol('BTC');
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
