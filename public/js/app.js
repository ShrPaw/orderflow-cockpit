// Orderflow Cockpit — Full Surgical Scalper Rebuild (Parts 1–13)
// Deepchart/dxFeed-style viewport, candle spacing, price scale, bubble rendering, clustering, debug

(function() {
'use strict';

// ============ CONSTANTS ============
const MIN_CANDLES_VISIBLE = 3;
const MAX_CANDLES_VISIBLE = 600;
const DEFAULT_CANDLES_VISIBLE = 100;
const FIT_RECENT_MAX = 250;
const RIGHT_PADDING_CANDLES = 12;
const LIVE_CANDLE_POSITION = 0.80;
const BUBBLE_MIN_R = 3;
const BUBBLE_MAX_R = 24;
const ZOOM_FACTOR_WHEEL = 1.12;
const ZOOM_FACTOR_BTN = 1.35;

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
window.onerror = function(msg) { try { showToast('Error: ' + (msg||'unknown'), 'error'); } catch(_) {} return true; };
window.addEventListener('unhandledrejection', function(e) { try { showToast('Async error: ' + (e.reason?.message||e.reason||'unknown'), 'error'); } catch(_) {} });

// ============ HELPERS ============
function fmtPrice(p) { if (p==null||isNaN(p)) return '—'; if (Math.abs(p)>=1000) return p.toFixed(1); if (Math.abs(p)>=100) return p.toFixed(2); if (Math.abs(p)>=1) return p.toFixed(3); if (Math.abs(p)>=0.01) return p.toFixed(4); return p.toFixed(6); }
function fmtNum(n) { if (n==null||isNaN(n)) return '—'; if (Math.abs(n)>=1e9) return (n/1e9).toFixed(1)+'B'; if (Math.abs(n)>=1e6) return (n/1e6).toFixed(1)+'M'; if (Math.abs(n)>=1e3) return (n/1e3).toFixed(1)+'K'; return n.toFixed(0); }
function symbolToBinance(s) { const sp={PEPE:'1000PEPEUSDT',LUNC:'1000LUNCUSDT',SHIB:'1000SHIBUSDT',BONK:'1000BONKUSDT',FLOKI:'1000FLOKIUSDT',XEC:'1000XECUSDT',CAT:'1000CATSUSDT',RATS:'1000RATSUSDT'}; return sp[s]||`${s}USDT`; }
function estimatePriceStep(ppp,h) { const tr=h*ppp; const steps=[0.0001,0.0002,0.0005,0.001,0.002,0.005,0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000]; const t=tr/8; for(const s of steps){if(s>=t)return s;} return steps[steps.length-1]; }
function lerp(a,b,t) { return a+(b-a)*t; }
function clamp(v,mn,mx) { return Math.max(mn,Math.min(mx,v)); }

// Part 7: Label density modes
const LABEL_OFF = 'off';
const LABEL_COMPACT = 'compact';
const LABEL_FULL = 'full';

// ============ STATE ============
const state = {
  symbol: null, interval: '40s', followLive: true, activeTool: 'cursor',
  source: 'hyperliquid', sourceStatus: {}, symbolLoaded: false, symbolError: null,
  candles: [], currentCandle: null, bubbles: [], zones: [],

  // Part 7: Label density
  labelDensity: LABEL_COMPACT,

  view: {
    centerIndex: 0, candlesVisible: DEFAULT_CANDLES_VISIBLE,
    priceCenter: 0, pricePerPixel: 0.05,
    autoScalePrice: true, followLive: true, userModified: false, manualPrice: false,
  },
  lastValidViewport: null,

  mouse: { x:0, y:0, price:0, isDown:false, button:0, dragStartX:0, dragStartY:0, dragStartCenterIndex:0, dragStartPriceCenter:0 },
  hoveredCandle: null, hoveredBubble: null, hoveredBubblePos: null,
  drawings: [], drawingState: null, selectedRange: null,
  scannerData: [], scannerMode: 'top_attention',
  ws: null, wsReady: false, canvas: null, ctx: null, width:0, height:0, dpr:1,
  historyLoaded: false, historyCount: 0, historySource: '', _priceScaleDirty: true, _loadingSymbol: false,
  priceScaleWidth: 62,

  // Part 11: Debug
  debugOpen: false,
  // Part 6: Cluster tracking for debug
  _clusterCount: 0, _individualBubbleCount: 0,
};

const COL = {
  bg:'#0a0e17', grid:'#141c2b', gridText:'#3d4a5e',
  candleUp:'#22c55e', candleDown:'#ef4444', candleHistorical:'#374151',
  bubblePending:'#f59e0b',
  bubbleAcceptedBuy:'#22c55e', bubbleAcceptedSell:'#ef4444',
  bubbleRejectedBuy:'#ef4444', bubbleRejectedSell:'#22c55e',
  bubbleAbsorbed:'#06b6d4', bubbleExhausted:'#6b7280',
  crosshair:'rgba(148,163,184,0.3)',
  selection:'rgba(245,158,11,0.12)', selectionBorder:'#f59e0b',
  drawing:'#3b82f6', poc:'#f59e0b', vah:'#3b82f6', val:'#3b82f6', deltaPoc:'#a855f7',
};

// ============ HISTORICAL CANDLES ============
function fetchHistoricalCandles(symbol) {
  if (!symbol) return;
  fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${state.interval}&count=300`)
    .then(r=>r.json()).then(data=>{
      if (data.ok&&data.candles&&data.candles.length>0) {
        const existing=new Set(state.candles.map(c=>c.openTime));
        const nc=data.candles.filter(c=>!existing.has(c.openTime));
        state.candles=[...nc,...state.candles];
        if(state.candles.length>800) state.candles=state.candles.slice(-800);
        state.historyLoaded=true; state.historyCount=data.count; state.historySource=data.interval+' historical';
        state._priceScaleDirty=true; state.symbolLoaded=true; updateRightPanel();
      } else { state.historySource='Building live history'; state.symbolLoaded=true; updateRightPanel(); }
    }).catch(()=>{ state.historySource='Building live history'; state.symbolLoaded=true; updateRightPanel(); });
}

// ============ WEBSOCKET ============
function connectWS() {
  const proto=location.protocol==='https:'?'wss':'ws';
  state.ws=new WebSocket(`${proto}://${location.host}`);
  state.ws.onopen=()=>{ state.wsReady=true; if(state.symbol) state.ws.send(JSON.stringify({type:'subscribe_symbol',symbol:state.symbol})); };
  state.ws.onmessage=(e)=>{ try{handleMessage(JSON.parse(e.data));}catch(err){showToast('WS error: '+err.message,'error');} };
  state.ws.onclose=()=>{ state.wsReady=false; setTimeout(connectWS,2000); };
  state.ws.onerror=()=>{};
}

function handleMessage(msg) {
  switch(msg.type) {
    case 'source_status': state.sourceStatus=msg.data; updateSourceUI(); break;
    case 'candle': if(msg.data.symbol===state.symbol) handleCandle(msg.data); break;
    case 'bubbles': if(msg.data.symbol===state.symbol) { for(const b of msg.data.bubbles){b.candleTime=msg.data.candleTime;state.bubbles.push(b);} if(state.bubbles.length>5000)state.bubbles=state.bubbles.slice(-5000); } break;
    case 'snapshot': if(msg.data.symbol===state.symbol) {
      state.candles=(msg.data.historical||[]).map(c=>({...c,priceMap:c.priceMap||{}}));
      state.currentCandle=msg.data.current||null; state.bubbles=[];
      for(const c of state.candles){if(c.bubbles)for(const b of c.bubbles){b.candleTime=c.openTime;state.bubbles.push(b);}}
      state.symbolLoaded=true; state._priceScaleDirty=true; updateRightPanel();
      if(state.followLive&&!state.view.userModified) resetToDefaultView();
    } break;
    case 'zones': if(msg.data.symbol===state.symbol) state.zones=msg.data.zones||[]; break;
    case 'profile': if(state.selectedRange){state.selectedRange.profile=msg.data.profile;updateRangePanel();} break;
    case 'hl_coins': window.__hlCoins=msg.data||[]; break;
    case 'symbol_selected': if(msg.data.symbol){state.symbolLoaded=true;state._loadingSymbol=false;state.symbolError=null;document.getElementById('symbol-input').value=msg.data.symbol;document.getElementById('fp-symbol').textContent=msg.data.symbol;updateRightPanel();updateSourceUI();loadDrawings();} break;
  }
}

function handleCandle(candle) {
  const existing=state.candles.find(c=>c.openTime===candle.openTime);
  if(existing) Object.assign(existing,candle); else state.candles.push(candle);
  if(state.candles.length>800) state.candles=state.candles.slice(-800);
  state.currentCandle=null; state._priceScaleDirty=true;
  if(candle.bubbles&&candle.bubbles.length>0){for(const b of candle.bubbles){b.candleTime=candle.openTime;state.bubbles.push(b);}if(state.bubbles.length>5000)state.bubbles=state.bubbles.slice(-5000);}
  if(state.followLive&&!state.view.userModified) snapToLive();
}

function getAllCandles() { const all=[...state.candles]; if(state.currentCandle)all.push(state.currentCandle); return all; }

// ============================================================
// VIEWPORT — WORLD COORDINATE CAMERA
// ============================================================
function worldToScreenX(worldIndex) {
  const chartW=state.width-state.priceScaleWidth;
  return chartW/2+(worldIndex-state.view.centerIndex)*(chartW/state.view.candlesVisible);
}
function screenToWorldX(screenX) {
  const chartW=state.width-state.priceScaleWidth;
  return state.view.centerIndex+(screenX-chartW/2)/(chartW/state.view.candlesVisible);
}
function priceToScreenY(price) { return state.height/2-(price-state.view.priceCenter)/state.view.pricePerPixel; }
function screenToPriceY(screenY) { return state.view.priceCenter+(state.height/2-screenY)*state.view.pricePerPixel; }
function getCandlePixelWidth() { return (state.width-state.priceScaleWidth)/state.view.candlesVisible; }

function snapToLive() {
  const all=getAllCandles(); if(all.length===0)return;
  const chartW=state.width-state.priceScaleWidth;
  const pxPerCandle=chartW/state.view.candlesVisible;
  const targetScreenX=chartW*LIVE_CANDLE_POSITION;
  state.view.centerIndex=(all.length-1)-(targetScreenX-chartW/2)/pxPerCandle;
}

function clampViewport() {
  const all=getAllCandles(); if(all.length===0)return;
  const maxDataIdx=all.length-1;
  const maxAllowed=maxDataIdx+RIGHT_PADDING_CANDLES;
  const minAllowed=-RIGHT_PADDING_CANDLES;
  const halfVis=state.view.candlesVisible/2;
  if(state.view.centerIndex+halfVis<minAllowed) state.view.centerIndex=minAllowed+halfVis;
  if(state.view.centerIndex-halfVis>maxAllowed) state.view.centerIndex=maxAllowed-halfVis;
}

function fitAll() {
  const all=getAllCandles(); if(all.length===0)return;
  const fitCount=Math.min(all.length,FIT_RECENT_MAX);
  state.view.candlesVisible=Math.max(MIN_CANDLES_VISIBLE,fitCount+RIGHT_PADDING_CANDLES);
  const startIdx=all.length-fitCount;
  state.view.centerIndex=startIdx+(fitCount-1)/2;
  state.view.userModified=false; state.followLive=true; state._priceScaleDirty=true;
  snapToLive();
  document.getElementById('btn-follow-live').classList.add('active');
}

function fitAllHistory() {
  const all=getAllCandles(); if(all.length===0)return;
  state.view.candlesVisible=Math.max(MIN_CANDLES_VISIBLE,all.length+RIGHT_PADDING_CANDLES);
  state.view.centerIndex=(all.length-1)/2;
  state.view.userModified=false; state.followLive=false; state._priceScaleDirty=true;
  document.getElementById('btn-follow-live').classList.remove('active');
}

function resetToDefaultView() {
  state.view.candlesVisible=DEFAULT_CANDLES_VISIBLE;
  state.view.autoScalePrice=true; state.view.manualPrice=false;
  state.view.followLive=true; state.view.userModified=false;
  state.followLive=true; state._priceScaleDirty=true;
  snapToLive();
  document.getElementById('btn-follow-live').classList.add('active');
  document.getElementById('btn-auto-scale').classList.add('active');
}

function zoomAtScreenX(screenX,factor) {
  const worldX=screenToWorldX(screenX);
  const oldCV=state.view.candlesVisible;
  const newCV=clamp(oldCV*factor,MIN_CANDLES_VISIBLE,MAX_CANDLES_VISIBLE);
  if(newCV===oldCV)return;
  state.view.candlesVisible=newCV;
  const chartW=state.width-state.priceScaleWidth;
  state.view.centerIndex=worldX-(screenX-chartW/2)/(chartW/newCV);
  state.view.userModified=true; state._priceScaleDirty=true;
}

// ============ CHART RENDERING ============
function initCanvas() {
  state.canvas=document.getElementById('chart-canvas');
  state.ctx=state.canvas.getContext('2d');
  state.dpr=window.devicePixelRatio||1;
  resizeCanvas(); window.addEventListener('resize',resizeCanvas);
}
function resizeCanvas() {
  const rect=state.canvas.parentElement.getBoundingClientRect();
  state.width=rect.width; state.height=rect.height;
  state.canvas.width=state.width*state.dpr; state.canvas.height=state.height*state.dpr;
  state.canvas.style.width=state.width+'px'; state.canvas.style.height=state.height+'px';
  state.ctx.setTransform(state.dpr,0,0,state.dpr,0,0);
}

function render() {
  const ctx=state.ctx, w=state.width, h=state.height, chartW=w-state.priceScaleWidth;
  ctx.fillStyle=COL.bg; ctx.fillRect(0,0,w,h);
  const allCandles=getAllCandles();

  if(!state.symbol||!allCandles.length) {
    ctx.fillStyle=COL.gridText; ctx.font='14px monospace'; ctx.textAlign='center';
    if(!state.symbol){ctx.fillText('Connecting to Hyperliquid...',w/2,h/2);ctx.font='11px monospace';ctx.fillText('BTC will auto-load',w/2,h/2+20);}
    else{ctx.fillText(`Loading ${state.symbol}...`,w/2,h/2);ctx.font='11px monospace';ctx.fillStyle=state.symbolError?'#ef4444':COL.gridText;ctx.fillText(state.symbolError||'Building live 40s history…',w/2,h/2+20);}
    requestAnimationFrame(render); return;
  }

  const totalCandles=allCandles.length, cpw=getCandlePixelWidth();
  clampViewport();
  state.lastValidViewport={centerIndex:state.view.centerIndex,candlesVisible:state.view.candlesVisible,priceCenter:state.view.priceCenter,pricePerPixel:state.view.pricePerPixel};

  const leftWorld=screenToWorldX(0), rightWorld=screenToWorldX(chartW);
  const startIdx=Math.max(0,Math.floor(leftWorld)-1);
  const endIdx=Math.min(totalCandles-1,Math.ceil(rightWorld)+1);

  // Auto-scale price
  if(state.view.autoScalePrice&&!state.view.manualPrice&&(state.followLive||state._priceScaleDirty)) {
    let minP=Infinity,maxP=-Infinity;
    for(let i=startIdx;i<=endIdx&&i<totalCandles;i++){if(allCandles[i].low<minP)minP=allCandles[i].low;if(allCandles[i].high>maxP)maxP=allCandles[i].high;}
    const visTimes=new Set(); for(let i=startIdx;i<=endIdx&&i<totalCandles;i++)visTimes.add(allCandles[i].openTime);
    for(const b of state.bubbles){if(visTimes.has(b.candleTime)){if(b.price<minP)minP=b.price;if(b.price>maxP)maxP=b.price;}}
    for(const z of state.zones){if(z.priceLow<minP)minP=z.priceLow;if(z.priceHigh>maxP)maxP=z.priceHigh;}
    if(minP<maxP&&isFinite(minP)&&isFinite(maxP)){
      const range=maxP-minP, margin=range*0.12;
      const targetPPP=(range+margin*2)/h;
      const maxPPP=range/(h*0.25);
      state.view.pricePerPixel=lerp(state.view.pricePerPixel,Math.min(targetPPP,maxPPP),0.18);
      state.view.priceCenter=lerp(state.view.priceCenter,(minP+maxP)/2,0.18);
    }
    state._priceScaleDirty=false;
  }

  drawGrid(ctx,chartW,h,cpw);
  drawZones(ctx,h,chartW);
  drawVolumeBars(ctx,allCandles,startIdx,endIdx,cpw,h,chartW);
  drawCandles(ctx,allCandles,startIdx,endIdx,cpw,chartW);
  drawBubbles(ctx,allCandles,startIdx,endIdx,cpw,chartW);
  if(state.selectedRange) drawSelectedRange(ctx,allCandles,cpw,chartW);
  drawDrawings(ctx,allCandles,cpw,chartW);
  if(state.drawingState) drawActiveDrawing(ctx);
  drawPriceScale(ctx,w,h,chartW);
  drawCrosshair(ctx,w,h,chartW,allCandles,cpw);
  drawTimeLabels(ctx,allCandles,startIdx,endIdx,cpw,h,chartW);

  // Status bar
  const sb=document.getElementById('tool-status-bar');
  if(sb){const vc=Math.min(endIdx-startIdx+1,totalCandles);sb.textContent=`Tool: ${state.activeTool==='cursor'?'Cursor':state.activeTool} | Visible: ${vc} | Zoom: ${Math.round(state.view.candlesVisible)} | Labels: ${state.labelDensity}`;}

  // Part 11: Debug panel update
  if(state.debugOpen) updateDebugPanel(allCandles,startIdx,endIdx);

  requestAnimationFrame(render);
}

function drawGrid(ctx,chartW,h,cpw) {
  ctx.strokeStyle=COL.grid; ctx.lineWidth=0.5;
  const ps=estimatePriceStep(state.view.pricePerPixel,h);
  const tP=screenToPriceY(0),bP=screenToPriceY(h);
  const mnP=Math.min(tP,bP),mxP=Math.max(tP,bP);
  const sP=Math.floor(mnP/ps)*ps;
  ctx.beginPath();
  for(let p=sP;p<=mxP;p+=ps){const y=priceToScreenY(p);if(y<0||y>h)continue;ctx.moveTo(0,y);ctx.lineTo(chartW,y);}
  ctx.stroke();
  const gs=cpw<3?100:cpw<5?50:cpw<10?20:cpw<20?10:cpw<40?5:1;
  const li=Math.floor(screenToWorldX(0)),ri=Math.ceil(screenToWorldX(chartW));
  const sgi=Math.floor(li/gs)*gs;
  ctx.beginPath();
  for(let i=sgi;i<=ri;i+=gs){const x=worldToScreenX(i);if(x<0||x>chartW)continue;ctx.moveTo(x,0);ctx.lineTo(x,h);}
  ctx.stroke();
}

function drawCandles(ctx,allCandles,startIdx,endIdx,cpw,chartW) {
  const gap=Math.max(1,cpw*0.1), bodyW=Math.max(1,cpw-gap), wickW=cpw>20?2:1;
  for(let i=startIdx;i<=endIdx&&i<allCandles.length;i++){
    const c=allCandles[i], x=worldToScreenX(i);
    if(x<-cpw||x>chartW+cpw)continue;
    const isUp=c.close>=c.open, isHist=c._historical||c._sourceInterval;
    let color=isUp?COL.candleUp:COL.candleDown; if(isHist)color=COL.candleHistorical;
    ctx.strokeStyle=color; ctx.lineWidth=wickW;
    ctx.beginPath(); ctx.moveTo(x,priceToScreenY(c.high)); ctx.lineTo(x,priceToScreenY(c.low)); ctx.stroke();
    const bodyTop=priceToScreenY(Math.max(c.open,c.close)), bodyBot=priceToScreenY(Math.min(c.open,c.close));
    const bodyH=Math.max(1,bodyBot-bodyTop);
    ctx.fillStyle=isHist?'rgba(55,65,81,0.55)':color;
    ctx.fillRect(x-bodyW/2,bodyTop,bodyW,bodyH);
    if(cpw>30&&!isHist){ctx.strokeStyle=isUp?'rgba(34,197,94,0.4)':'rgba(239,68,68,0.4)';ctx.lineWidth=1;ctx.strokeRect(x-bodyW/2,bodyTop,bodyW,bodyH);}
  }
}

function drawVolumeBars(ctx,allCandles,startIdx,endIdx,cpw,h,chartW) {
  if(startIdx>=allCandles.length)return;
  let maxV=1; for(let i=startIdx;i<=endIdx&&i<allCandles.length;i++){const v=allCandles[i].volume||0;if(v>maxV)maxV=v;}
  const bMaxH=h*0.1, gap=Math.max(1,cpw*0.1), barW=Math.max(1,cpw-gap);
  for(let i=startIdx;i<=endIdx&&i<allCandles.length;i++){
    const c=allCandles[i], x=worldToScreenX(i);
    if(x<-cpw||x>chartW+cpw)continue;
    const barH=((c.volume||0)/maxV)*bMaxH;
    const isUp=c.close>=c.open, isHist=c._historical||c._sourceInterval;
    ctx.fillStyle=isHist?'rgba(55,65,81,0.15)':(isUp?'rgba(34,197,94,0.18)':'rgba(239,68,68,0.18)');
    ctx.fillRect(x-barW/2,h-barH,barW,barH);
  }
}

// ============================================================
// PART 5+6 — BUBBLE RENDERING WITH PROPER CLUSTERING
// ============================================================
function drawBubbles(ctx,allCandles,startIdx,endIdx,cpw,chartW) {
  const total=allCandles.length;
  const visTimes=new Set(); for(let i=startIdx;i<=endIdx&&i<total;i++)visTimes.add(allCandles[i].openTime);
  const visBubbles=state.bubbles.filter(b=>visTimes.has(b.candleTime)&&b.state!=='INVALIDATED');
  if(!visBubbles.length){state._clusterCount=0;state._individualBubbleCount=visBubbles.length;return;}

  // Part 6: Assign per-candle bubble indices for x-offset jitter
  const candleBubbleIdx={}; const candleBubbleCnt={};
  for(const b of visBubbles){const k=b.candleTime;if(!(k in candleBubbleCnt)){candleBubbleCnt[k]=0;candleBubbleIdx[k]=0;}candleBubbleCnt[k]++;}

  // Part 6: Cluster by candle + pixel proximity + SAME side + SAME state
  // Zoom-dependent clustering: at deep zoom, cluster less aggressively
  const clusterBandPx=Math.max(8,cpw*0.4);
  const clusters=[];

  for(const bubble of visBubbles){
    const cIdx=allCandles.findIndex(c=>c.openTime===bubble.candleTime);
    if(cIdx<0)continue;
    const candleX=worldToScreenX(cIdx);
    if(candleX<-60||candleX>chartW+60)continue;

    // Part 6: X-offset jitter for multiple bubbles in same candle
    const bIdx=candleBubbleIdx[bubble.candleTime]++;
    const cnt=candleBubbleCnt[bubble.candleTime];
    let xOff=0;
    if(cnt>1&&cpw>8){const spread=cpw*0.7;const step=spread/Math.max(1,cnt-1);xOff=-spread/2+bIdx*step;}

    const x=candleX+xOff, y=priceToScreenY(bubble.price);
    if(y<-60||y>state.height+60)continue;

    // Part 6: Cluster ONLY same side + same state — no semantic mixing
    let merged=false;
    for(const cl of clusters){
      if(cl.candleTime===bubble.candleTime&&Math.abs(cl.x-x)<cpw*0.5&&Math.abs(cl.y-y)<clusterBandPx&&cl.side===bubble.side&&cl.state===bubble.state){
        cl.bubbles.push(bubble); cl.totalNotional+=bubble.notional||0; cl.totalVolume+=bubble.volume||0;
        cl.y=(cl.y*(cl.bubbles.length-1)+y)/cl.bubbles.length; merged=true; break;
      }
    }
    if(!merged) clusters.push({x,y,candleTime:bubble.candleTime,bubbles:[bubble],totalNotional:bubble.notional||0,totalVolume:bubble.volume||0,side:bubble.side,state:bubble.state});
  }

  state._clusterCount=clusters.length;
  state._individualBubbleCount=visBubbles.length;
  state.hoveredBubble=null; state.hoveredBubblePos=null;

  for(const cl of clusters){
    const {x,y,bubbles:bubs,side,state:st}=cl;
    const count=bubs.length;
    const rawR=Math.sqrt(cl.totalNotional/600);
    const radius=clamp(rawR,BUBBLE_MIN_R,BUBBLE_MAX_R);

    let mainColor;
    switch(st){
      case 'PENDING':mainColor=COL.bubblePending;break;
      case 'ACCEPTED':mainColor=side==='buy'?COL.bubbleAcceptedBuy:COL.bubbleAcceptedSell;break;
      case 'REJECTED':mainColor=side==='buy'?COL.bubbleRejectedBuy:COL.bubbleRejectedSell;break;
      case 'ABSORBED':mainColor=COL.bubbleAbsorbed;break;
      case 'EXHAUSTED':mainColor=COL.bubbleExhausted;break;
      default:mainColor=side==='buy'?COL.bubbleAcceptedBuy:COL.bubbleAcceptedSell;
    }

    // === State-specific clean circle rendering ===
    switch(st){
      case 'PENDING':{
        const pulse=0.5+0.5*Math.sin(Date.now()/280);
        ctx.globalAlpha=pulse;ctx.strokeStyle=mainColor;ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();
        ctx.globalAlpha=0.08;ctx.fillStyle=mainColor;
        ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=1;break;
      }
      case 'ACCEPTED':{
        const grad=ctx.createRadialGradient(x,y,radius*0.1,x,y,radius*1.8);
        grad.addColorStop(0,mainColor+'66');grad.addColorStop(0.5,mainColor+'1a');grad.addColorStop(1,mainColor+'00');
        ctx.fillStyle=grad;ctx.beginPath();ctx.arc(x,y,radius*1.8,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=mainColor+'bb';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=mainColor;ctx.beginPath();ctx.arc(x,y,radius*0.3,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=mainColor;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();
        break;
      }
      case 'REJECTED':{
        ctx.fillStyle=mainColor+'10';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=mainColor;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle=mainColor+'44';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,radius+3,0,Math.PI*2);ctx.stroke();
        if(cpw>22){ctx.strokeStyle=mainColor+'66';ctx.lineWidth=1.5;const s=radius*0.35;ctx.beginPath();ctx.moveTo(x-s,y-s);ctx.lineTo(x+s,y+s);ctx.stroke();ctx.beginPath();ctx.moveTo(x+s,y-s);ctx.lineTo(x-s,y+s);ctx.stroke();}
        break;
      }
      case 'ABSORBED':{
        const grad=ctx.createRadialGradient(x,y,radius*0.2,x,y,radius*2.5);
        grad.addColorStop(0,mainColor+'28');grad.addColorStop(0.4,mainColor+'0e');grad.addColorStop(1,mainColor+'00');
        ctx.fillStyle=grad;ctx.beginPath();ctx.arc(x,y,radius*2.5,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=0.25;ctx.fillStyle=mainColor;ctx.beginPath();ctx.arc(x,y,radius*0.55,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
        ctx.strokeStyle=mainColor+'44';ctx.lineWidth=1.5;ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        ctx.strokeStyle=mainColor+'22';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,radius*1.5,0,Math.PI*2);ctx.stroke();
        break;
      }
      case 'EXHAUSTED':{
        ctx.globalAlpha=0.18;ctx.fillStyle=mainColor;ctx.beginPath();ctx.arc(x,y,radius*0.6,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
        ctx.strokeStyle=mainColor+'28';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.arc(x,y,radius*0.9,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        break;
      }
    }

    // Part 6+7: Cluster label — clean "3x" format, only when labelDensity allows
    if(count>1&&state.labelDensity!==LABEL_OFF){
      const showLabel=state.labelDensity===LABEL_FULL||(state.labelDensity===LABEL_COMPACT&&cpw>10);
      if(showLabel){
        ctx.fillStyle='rgba(255,255,255,0.75)';ctx.font=`bold ${cpw>30?9:7}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(count+'x',x,y);
      }
    }

    // Hover detection
    const dx=state.mouse.x-x, dy=state.mouse.y-y;
    const hitR=Math.max(radius+10,16);
    if(dx*dx+dy*dy<hitR*hitR){
      state.hoveredBubble={x,y,cluster:cl,mainBubble:bubs.reduce((a,b)=>(b.notional||0)>(a.notional||0)?b:a,bubs[0])};
      state.hoveredBubblePos={x,y};
    }
  }
}

// ============ ZONES ============
function drawZones(ctx,h,chartW) {
  for(const zone of state.zones){
    const y1=priceToScreenY(zone.priceHigh),y2=priceToScreenY(zone.priceLow);
    if(y2<0||y1>h)continue;
    let fillCol,borderCol; const isBuy=zone.type.includes('BUY');
    if(zone.type.includes('DEFENSE')){fillCol=isBuy?'rgba(34,197,94,0.06)':'rgba(239,68,68,0.06)';borderCol=isBuy?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)';}
    else if(zone.type.includes('ABSORPTION')){fillCol='rgba(6,182,212,0.05)';borderCol='rgba(6,182,212,0.2)';}
    else if(zone.type.includes('REJECTION')){fillCol=isBuy?'rgba(239,68,68,0.05)':'rgba(34,197,94,0.05)';borderCol=isBuy?'rgba(239,68,68,0.2)':'rgba(34,197,94,0.2)';}
    else{fillCol='rgba(245,158,11,0.04)';borderCol='rgba(245,158,11,0.15)';}
    ctx.fillStyle=fillCol;ctx.fillRect(0,y1,chartW,y2-y1);
    ctx.strokeStyle=borderCol;ctx.lineWidth=1;ctx.setLineDash([4,2]);
    ctx.beginPath();ctx.moveTo(0,y1);ctx.lineTo(chartW,y1);ctx.moveTo(0,y2);ctx.lineTo(chartW,y2);ctx.stroke();ctx.setLineDash([]);
    if(state.labelDensity!==LABEL_OFF&&state.view.candlesVisible<200){
      const short=zone.type.replace(/_/g,' ').replace('BUYER ','B.').replace('SELLER ','S.');
      ctx.fillStyle=borderCol;ctx.font='8px monospace';ctx.textAlign='right';ctx.fillText(short,chartW-4,(y1+y2)/2+3);
    }
  }
}

// ============ SELECTED RANGE (Part 9: uses world coordinates) ============
function drawSelectedRange(ctx,allCandles,cpw,chartW) {
  const sr=state.selectedRange; if(!sr)return;
  let si=allCandles.findIndex(c=>c.openTime>=sr.start);
  let ei=allCandles.findIndex(c=>c.openTime>sr.end);
  if(si<0)si=0; if(ei<0)ei=allCandles.length-1;
  const x1=worldToScreenX(si),x2=worldToScreenX(ei);
  const y1=priceToScreenY(sr.priceHigh),y2=priceToScreenY(sr.priceLow);
  ctx.fillStyle=COL.selection;ctx.fillRect(Math.min(x1,x2),y1,Math.abs(x2-x1),y2-y1);
  ctx.strokeStyle=COL.selectionBorder;ctx.lineWidth=1.5;ctx.setLineDash([4,2]);
  ctx.strokeRect(Math.min(x1,x2),y1,Math.abs(x2-x1),y2-y1);ctx.setLineDash([]);
  if(sr.profile) drawProfileOverlay(ctx,sr.profile,Math.min(x1,x2),y1,Math.abs(x2-x1),y2-y1);
}

function drawProfileOverlay(ctx,profile,boxX,boxY,boxW,boxH) {
  if(!profile.levels||!profile.levels.length)return;
  const maxV=Math.max(...profile.levels.map(l=>l.total),1);
  const maxD=Math.max(...profile.levels.map(l=>Math.abs(l.delta)),1);
  const pW=boxW*0.35;
  for(const lv of profile.levels){
    const y=priceToScreenY(lv.price);const bW=(lv.total/maxV)*pW;const bH=Math.max(1,boxH/profile.levels.length);
    ctx.fillStyle='rgba(59,130,246,0.2)';ctx.fillRect(boxX,y-bH/2,bW,bH);
    const dW=(Math.abs(lv.delta)/maxD)*pW*0.3;
    ctx.fillStyle=lv.delta>0?'rgba(34,197,94,0.35)':'rgba(239,68,68,0.35)';
    ctx.fillRect(lv.delta>0?boxX+bW:boxX+bW-dW,y-bH/2,dW,bH);
  }
  if(profile.poc){const y=priceToScreenY(profile.poc);ctx.strokeStyle=COL.poc;ctx.lineWidth=1.5;ctx.setLineDash([6,3]);ctx.beginPath();ctx.moveTo(boxX,y);ctx.lineTo(boxX+boxW,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=COL.poc;ctx.font='bold 9px monospace';ctx.textAlign='left';ctx.fillText(`POC ${fmtPrice(profile.poc)}`,boxX+4,y-4);}
  if(profile.vah){const y=priceToScreenY(profile.vah);ctx.strokeStyle=COL.vah;ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(boxX,y);ctx.lineTo(boxX+boxW,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=COL.vah;ctx.font='8px monospace';ctx.fillText(`VAH ${fmtPrice(profile.vah)}`,boxX+4,y-3);}
  if(profile.val){const y=priceToScreenY(profile.val);ctx.strokeStyle=COL.val;ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(boxX,y);ctx.lineTo(boxX+boxW,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=COL.val;ctx.font='8px monospace';ctx.fillText(`VAL ${fmtPrice(profile.val)}`,boxX+4,y+10);}
  if(profile.deltaPoc){const y=priceToScreenY(profile.deltaPoc);ctx.strokeStyle=COL.deltaPoc;ctx.lineWidth=1;ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(boxX,y);ctx.lineTo(boxX+boxW,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=COL.deltaPoc;ctx.font='8px monospace';ctx.textAlign='right';ctx.fillText(`ΔPOC ${fmtPrice(profile.deltaPoc)}`,boxX+boxW-4,y-3);}
  for(const h of(profile.hvns||[])){const y=priceToScreenY(h);ctx.fillStyle='rgba(59,130,246,0.1)';ctx.fillRect(boxX,y-3,boxW,6);}
  for(const l of(profile.lvns||[])){const y=priceToScreenY(l);ctx.fillStyle='rgba(168,85,247,0.07)';ctx.fillRect(boxX,y-2,boxW,4);}
}

// ============ DRAWINGS ============
function drawDrawings(ctx,allCandles,cpw,chartW){for(const d of state.drawings)drawSingleDrawing(ctx,d,chartW);}
function drawActiveDrawing(ctx){drawSingleDrawing(ctx,state.drawingState,state.width-state.priceScaleWidth);}
function drawSingleDrawing(ctx,d,chartW){
  if(!d)return;ctx.strokeStyle=d.color||COL.drawing;ctx.lineWidth=1.5;
  switch(d.type){
    case 'hline':{const y=priceToScreenY(d.price);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(chartW,y);ctx.stroke();if(state.labelDensity!==LABEL_OFF){ctx.fillStyle=d.color||COL.drawing;ctx.font='8px monospace';ctx.textAlign='left';ctx.fillText(`— ${fmtPrice(d.price)}`,4,y-4);}break;}
    case 'trendline':{const y1=priceToScreenY(d.price1);const y2=priceToScreenY(d.price2);ctx.beginPath();ctx.moveTo(d.x1,y1);ctx.lineTo(d.x2,y2);ctx.stroke();break;}
    case 'rect':{const y1=priceToScreenY(d.priceHigh);const y2=priceToScreenY(d.priceLow);ctx.fillStyle='rgba(59,130,246,0.06)';ctx.fillRect(d.x1,y1,d.x2-d.x1,y2-y1);ctx.strokeRect(d.x1,y1,d.x2-d.x1,y2-y1);break;}
    case 'text':{const y=priceToScreenY(d.price);ctx.fillStyle=d.color||COL.drawing;ctx.font='10px monospace';ctx.textAlign='left';ctx.fillText(d.text,d.x,y);break;}
  }
}

// ============ PRICE SCALE (Part 3) ============
function drawPriceScale(ctx,w,h,chartW) {
  ctx.fillStyle='#111827';ctx.fillRect(chartW,0,w-chartW,h);
  ctx.fillStyle=COL.gridText;ctx.font='9px monospace';ctx.textAlign='left';
  const ps=estimatePriceStep(state.view.pricePerPixel,h);
  const tP=screenToPriceY(0),bP=screenToPriceY(h);
  const mnP=Math.min(tP,bP),mxP=Math.max(tP,bP),sP=Math.floor(mnP/ps)*ps;
  for(let p=sP;p<=mxP;p+=ps){const y=priceToScreenY(p);if(y<10||y>h-10)continue;ctx.fillText(fmtPrice(p),chartW+4,y+3);}
  if(state.currentCandle){const cy=priceToScreenY(state.currentCandle.close);const isUp=state.currentCandle.close>=state.currentCandle.open;ctx.fillStyle=isUp?COL.candleUp:COL.candleDown;ctx.fillRect(chartW,cy-8,w-chartW,16);ctx.fillStyle='#000';ctx.font='bold 10px monospace';ctx.fillText(fmtPrice(state.currentCandle.close),chartW+4,cy+4);}
  if(state.view.manualPrice){ctx.fillStyle='#f59e0b';ctx.font='8px monospace';ctx.textAlign='center';ctx.fillText('MANUAL',chartW+(w-chartW)/2,12);}
}

// ============ CROSSHAIR ============
function drawCrosshair(ctx,w,h,chartW,allCandles,cpw) {
  if(state.mouse.x<0||state.mouse.x>w||state.mouse.y<0||state.mouse.y>h)return;
  if(state.mouse.x>chartW)return;
  ctx.strokeStyle=COL.crosshair;ctx.lineWidth=0.5;ctx.setLineDash([2,2]);
  ctx.beginPath();ctx.moveTo(0,state.mouse.y);ctx.lineTo(chartW,state.mouse.y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(state.mouse.x,0);ctx.lineTo(state.mouse.x,h);ctx.stroke();ctx.setLineDash([]);
  const price=screenToPriceY(state.mouse.y);
  const label=document.getElementById('crosshair-label');
  if(label){label.classList.remove('hidden');label.style.left=(chartW+2)+'px';label.style.top=(state.mouse.y-10)+'px';label.textContent=fmtPrice(price);}
  updateTooltip(allCandles,cpw,chartW);
}

function drawTimeLabels(ctx,allCandles,startIdx,endIdx,cpw,h,chartW) {
  if(state.labelDensity===LABEL_OFF)return;
  ctx.fillStyle=COL.gridText;ctx.font='8px monospace';ctx.textAlign='center';
  const li=cpw<3?100:cpw<5?50:cpw<10?20:cpw<20?10:cpw<40?5:1;
  for(let i=startIdx;i<=endIdx&&i<allCandles.length;i+=li){
    const c=allCandles[i],x=worldToScreenX(i);
    if(x<0||x>chartW)continue;
    const t=new Date(c.openTime);
    ctx.fillText(`${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`,x,h-4);
  }
}

// ============================================================
// PART 5+6 — TOOLTIP: Full details on hover
// ============================================================
function updateTooltip(allCandles,cpw,chartW) {
  const tooltip=document.getElementById('hover-tooltip'); if(!tooltip)return;
  state.hoveredCandle=null;
  const worldIdx=Math.round(screenToWorldX(state.mouse.x));
  if(worldIdx>=0&&worldIdx<allCandles.length) state.hoveredCandle=allCandles[worldIdx];

  // Part 5+6: Bubble hover — full detail tooltip
  if(state.hoveredBubble){
    const b=state.hoveredBubble;tooltip.classList.remove('hidden');
    tooltip.style.left=Math.min(b.x+20,chartW-260)+'px';tooltip.style.top=(b.y-20)+'px';
    const bub=b.mainBubble,cl=b.cluster,bubs=cl.bubbles,isCluster=bubs.length>1;
    const buyCnt=bubs.filter(bb=>bb.side==='buy').length,sellCnt=bubs.filter(bb=>bb.side==='sell').length;
    const stCnt={};for(const bb of bubs){const s=bb.state||'PENDING';stCnt[s]=(stCnt[s]||0)+1;}
    const stBreak=Object.entries(stCnt).map(([s,n])=>`${n} ${s.toLowerCase()}`).join(', ');
    const stColor=cl.state==='ACCEPTED'?(cl.side==='buy'?'#22c55e':'#ef4444'):cl.state==='REJECTED'?(cl.side==='buy'?'#ef4444':'#22c55e'):cl.state==='ABSORBED'?'#06b6d4':cl.state==='EXHAUSTED'?'#6b7280':'#f59e0b';
    let interp='';
    if(cl.state==='ACCEPTED')interp=cl.side==='buy'?'Buy aggression accepted — auction higher':'Sell aggression accepted — auction lower';
    else if(cl.state==='REJECTED')interp=cl.side==='buy'?'Buying rejected — sellers defended this level':'Selling rejected — buyers defended this level';
    else if(cl.state==='ABSORBED')interp='Volume absorbed — passive defense, aggression did not travel';
    else if(cl.state==='EXHAUSTED')interp='Aggression exhausted — momentum fading';
    const r3=bub.response3s!=null?`3s: ${bub.response3s>0?'+':''}${fmtPrice(bub.response3s)}`:'';
    const r10=bub.response10s!=null?`10s: ${bub.response10s>0?'+':''}${fmtPrice(bub.response10s)}`:'';
    const r40=bub.response40s!=null?`40s: ${bub.response40s>0?'+':''}${fmtPrice(bub.response40s)}`:'';
    tooltip.innerHTML=`
      <div style="color:${stColor};font-weight:bold;margin-bottom:3px">${isCluster?`${bubs.length} bubbles in cluster`:cl.side.toUpperCase()+' '+cl.state}</div>
      ${isCluster?`<div style="color:#94a3b8;font-size:9px;margin-bottom:3px">${buyCnt} buy ${Object.keys(stCnt).join(', ')||''} | ${sellCnt} sell</div>`:''}
      ${isCluster?`<div style="color:#94a3b8;font-size:9px">Breakdown: ${stBreak}</div>`:''}
      ${isCluster?`<div style="color:#94a3b8;font-size:9px">Total: $${fmtNum(cl.totalNotional)} | Price band: ${fmtPrice(Math.min(...bubs.map(bb=>bb.price)))} — ${fmtPrice(Math.max(...bubs.map(bb=>bb.price)))}</div>`:''}
      <div style="color:#94a3b8;margin-top:2px">Price: ${fmtPrice(bub.price)} | Size: ${fmtNum(bub.volume)} | $${fmtNum(bub.notional)}</div>
      <div style="border-top:1px solid #1e293b;margin:4px 0;padding-top:3px">
        <div>${buyCnt} buy / ${sellCnt} sell</div>
        <div>${stBreak}</div>
      </div>
      ${r3?`<div style="color:#94a3b8;font-size:9px;margin-top:2px">${r3} ${r10} ${r40}</div>`:''}
      <div style="color:#94a3b8;font-style:italic;font-size:9px;margin-top:2px">${interp}</div>
    `;
    state.hoveredBubble=null;return;
  }

  // Candle tooltip
  if(state.hoveredCandle){
    const c=state.hoveredCandle;const t=new Date(c.openTime);
    const ts=`${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`;
    tooltip.classList.remove('hidden');tooltip.style.left=(state.mouse.x+15)+'px';tooltip.style.top=(state.mouse.y-10)+'px';
    tooltip.innerHTML=`<div style="color:#94a3b8;margin-bottom:3px">${ts}</div><div>O: ${fmtPrice(c.open)} H: ${fmtPrice(c.high)} L: ${fmtPrice(c.low)} C: ${fmtPrice(c.close)}</div><div>Vol: ${fmtNum(c.volume)} | Δ: ${c.delta>0?'+':''}${fmtNum(c.delta)}</div><div>Trades: ${c.tradeCount} | Bubbles: ${c.bubbleCount||0}</div><div style="color:#94a3b8;font-size:9px">Absorbed: ${c.absorptionCount||0} | Rejected: ${c.rejectionCount||0}</div>`;
  } else { tooltip.classList.add('hidden'); }
}

// ============================================================
// INPUT HANDLING
// ============================================================
function initInput() {
  const canvas=state.canvas;

  canvas.addEventListener('mousemove',(e)=>{
    try{
      const rect=canvas.getBoundingClientRect();
      state.mouse.x=e.clientX-rect.left;state.mouse.y=e.clientY-rect.top;
      state.mouse.price=screenToPriceY(state.mouse.y);
      if(state.mouse.isDown&&state.mouse.button===0&&state.activeTool==='cursor'){
        const dx=e.clientX-state.mouse.dragStartX,dy=e.clientY-state.mouse.dragStartY;
        const cpw=getCandlePixelWidth();
        state.view.centerIndex=state.mouse.dragStartCenterIndex-dx/cpw;
        if(Math.abs(dy)>2){state.view.priceCenter=state.mouse.dragStartPriceCenter+dy*state.view.pricePerPixel;state.view.manualPrice=true;}
        state.view.userModified=true;state.followLive=false;
        document.getElementById('btn-follow-live').classList.remove('active');
      }
      if(state.drawingState&&state.mouse.isDown)updateDrawingState(state.mouse.x,state.mouse.price);
    }catch(err){}
  });

  canvas.addEventListener('mousedown',(e)=>{
    try{state.mouse.isDown=true;state.mouse.button=e.button;state.mouse.dragStartX=e.clientX;state.mouse.dragStartY=e.clientY;state.mouse.dragStartCenterIndex=state.view.centerIndex;state.mouse.dragStartPriceCenter=state.view.priceCenter;if(e.button===0)handleToolClick(e);}catch(err){showToast('Click error: '+err.message,'error');}
  });
  canvas.addEventListener('mouseup',(e)=>{try{if(state.drawingState&&state.mouse.isDown)finalizeDrawing();state.mouse.isDown=false;}catch(err){}});

  // Wheel: Ctrl=time zoom, Shift=price zoom, default=pan
  canvas.addEventListener('wheel',(e)=>{
    try{
      e.preventDefault();
      const rect=canvas.getBoundingClientRect(), mouseX=e.clientX-rect.left, mouseY=e.clientY-rect.top;
      if(e.shiftKey){
        const factor=e.deltaY>0?1.1:0.91;const priceAtMouse=screenToPriceY(mouseY);
        state.view.pricePerPixel*=factor;state.view.pricePerPixel=clamp(state.view.pricePerPixel,0.00001,100000);
        state.view.priceCenter=priceAtMouse+(state.height/2-mouseY)*state.view.pricePerPixel;state.view.manualPrice=true;
      } else if(e.ctrlKey||e.metaKey){
        const factor=e.deltaY>0?ZOOM_FACTOR_WHEEL:1/ZOOM_FACTOR_WHEEL;zoomAtScreenX(mouseX,factor);
      } else {
        const panAmt=e.deltaY*0.3;const cpw=getCandlePixelWidth();state.view.centerIndex+=panAmt/cpw;state.view.userModified=true;
      }
      state.followLive=false;state._priceScaleDirty=true;
      document.getElementById('btn-follow-live').classList.remove('active');
    }catch(err){showToast('Zoom error: '+err.message,'error');}
  },{passive:false});

  // Double-click price axis = reset autoscale
  canvas.addEventListener('dblclick',(e)=>{
    try{const rect=canvas.getBoundingClientRect(),mouseX=e.clientX-rect.left,chartW=state.width-state.priceScaleWidth;
    if(mouseX>chartW-10){state.view.autoScalePrice=true;state.view.manualPrice=false;state._priceScaleDirty=true;document.getElementById('btn-auto-scale').classList.add('active');showToast('Price autoscale reset','info');}}catch(err){}
  });

  // Keyboard
  document.addEventListener('keydown',(e)=>{
    try{
      if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
      const chartW=state.width-state.priceScaleWidth;
      switch(e.key){
        case 'Escape':if(state.drawingState){state.drawingState=null;}else if(state.activeTool!=='cursor'){setActiveTool('cursor');state.selectedRange=null;updateRangePanel();}else{state.selectedRange=null;updateRangePanel();}break;
        case 'r':case 'R':setActiveTool('range');break;
        case 'Delete':case 'Backspace':deleteSelectedDrawing();break;
        case 'f':case 'F':fitAll();break;
        case '=':case '+':zoomAtScreenX(chartW/2,1/ZOOM_FACTOR_BTN);state.view.userModified=true;state.followLive=false;state._priceScaleDirty=true;document.getElementById('btn-follow-live').classList.remove('active');break;
        case '-':case '_':zoomAtScreenX(chartW/2,ZOOM_FACTOR_BTN);state.view.userModified=true;state.followLive=false;state._priceScaleDirty=true;document.getElementById('btn-follow-live').classList.remove('active');break;
        case '0':resetToDefaultView();break;
        case 'Home':snapToLive();state.followLive=true;state.view.userModified=false;document.getElementById('btn-follow-live').classList.add('active');break;
      }
    }catch(err){}
  });
}

function handleToolClick(e) {
  const x=state.mouse.x,price=state.mouse.price;
  switch(state.activeTool){
    case 'cursor':break;
    case 'hline':state.drawings.push({type:'hline',price,color:COL.drawing});saveDrawings();setActiveTool('cursor');break;
    case 'trendline':if(!state.drawingState)state.drawingState={type:'trendline',x1:x,price1:price,x2:x,price2:price,color:COL.drawing};break;
    case 'rect':if(!state.drawingState)state.drawingState={type:'rect',x1:x,price1:price,x2:x,price2:price,color:COL.drawing};break;
    case 'text':const text=prompt('Enter label:');if(text){state.drawings.push({type:'text',x,price,text,color:COL.drawing});saveDrawings();}setActiveTool('cursor');break;
    case 'range':if(!state.drawingState)state.drawingState={type:'range',x1:x,price1:price,x2:x,price2:price};break;
  }
}

function updateDrawingState(x,price){
  if(!state.drawingState)return;state.drawingState.x2=x;state.drawingState.price2=price;
  if(state.drawingState.type==='rect'||state.drawingState.type==='range'){state.drawingState.priceHigh=Math.max(state.drawingState.price1,price);state.drawingState.priceLow=Math.min(state.drawingState.price1,price);}
}

// Part 9: Range tool uses world coordinates — works after zoom/pan
function finalizeDrawing() {
  const d=state.drawingState; if(!d)return;
  if(d.type==='range'){
    const allCandles=getAllCandles();
    const priceHigh=Math.max(d.price1,d.price2),priceLow=Math.min(d.price1,d.price2);
    // Part 9: Convert screen coords to world indices for proper matching after zoom/pan
    const worldStart=Math.round(screenToWorldX(Math.min(d.x1,d.x2)));
    const worldEnd=Math.round(screenToWorldX(Math.max(d.x1,d.x2)));
    const matching=allCandles.filter((c,i)=>{
      const mid=(c.high+c.low)/2;
      return i>=worldStart&&i<=worldEnd&&mid>=priceLow&&mid<=priceHigh;
    });
    if(matching.length>0){
      state.selectedRange={start:matching[0].openTime,end:matching[matching.length-1].openTime,priceLow,priceHigh,profile:null};
      if(state.wsReady&&state.symbol)state.ws.send(JSON.stringify({type:'get_profile',symbol:state.symbol,start:state.selectedRange.start,end:state.selectedRange.end,priceLow,priceHigh}));
      fetch(`/api/range-profile?symbol=${state.symbol}&start=${state.selectedRange.start}&end=${state.selectedRange.end}&price_low=${priceLow}&price_high=${priceHigh}`)
        .then(r=>r.json()).then(data=>{if(data.ok&&data.profile){state.selectedRange.profile=data.profile;updateRangePanel();}}).catch(()=>{});
    }
  }else if(d.type==='trendline'||d.type==='rect'){state.drawings.push({...d});saveDrawings();}
  state.drawingState=null;
}

function deleteSelectedDrawing(){if(state.drawings.length>0){state.drawings.pop();saveDrawings();}}
function saveDrawings(){if(!state.symbol)return;try{localStorage.setItem(`drawings_${state.symbol}`,JSON.stringify(state.drawings));}catch(e){}}
function loadDrawings(){if(!state.symbol)return;try{const s=localStorage.getItem(`drawings_${state.symbol}`);state.drawings=s?JSON.parse(s):[];}catch(e){state.drawings=[];}}

// ============ UI UPDATES ============
function setActiveTool(tool){
  state.activeTool=tool;
  document.querySelectorAll('.tool-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.tool===tool));
  const cm={cursor:'grab',hline:'crosshair',trendline:'crosshair',rect:'crosshair',range:'crosshair',text:'text',delete:'not-allowed'};
  state.canvas.style.cursor=cm[tool]||'crosshair';
  const bar=document.getElementById('tool-status-bar');
  const nm={cursor:'Cursor',hline:'Horizontal Line',trendline:'Trend Line',rect:'Rectangle',range:'Range Profile (R)',text:'Text Label',delete:'Delete'};
  if(bar)bar.textContent='Tool: '+(nm[tool]||tool);
}

function updateSourceUI(){
  const ss=state.sourceStatus;
  const pill=document.getElementById('active-source'),quality=document.getElementById('data-quality'),execRef=document.getElementById('exec-ref');
  const hlConn=ss.hyperliquidConnected||(ss.hyperliquid&&ss.hyperliquid.connected)||false;
  const lastTrade=ss.lastTradeTs||(ss.hyperliquid&&ss.hyperliquid.lastTradeTs)||null;
  if(hlConn&&state.symbolLoaded){pill.textContent='HL';pill.classList.add('active');const age=lastTrade?Date.now()-lastTrade:Infinity;quality.textContent=age<30000?'Quality: Good':age<120000?'Quality: Stale':'Quality: Waiting';}
  else if(hlConn){pill.textContent='HL';pill.classList.add('active');quality.textContent='Quality: Loading...';}
  else{pill.textContent='—';pill.classList.remove('active');quality.textContent='Quality: Disconnected';}
  if(state.symbol){execRef.textContent=`Exec: ${symbolToBinance(state.symbol)}`;execRef.classList.remove('dim');}else{execRef.textContent='Exec: —';execRef.classList.add('dim');}
  const sc=document.getElementById('source-content');if(!sc)return;
  sc.innerHTML=`<div class="row"><span class="label">Read:</span><span class="val green">Hyperliquid</span></div><div class="row"><span class="label">HL connected:</span><span class="val ${hlConn?'green':'red'}">${hlConn?'yes':'no'}</span></div><div class="row"><span class="label">HL trades:</span><span class="val ${ss.hyperliquidTradesSubscribed?'green':'red'}">${ss.hyperliquidTradesSubscribed?'active':'no'}</span></div><div class="row"><span class="label">Exec ref:</span><span class="val">Binance USD-M</span></div><div class="row"><span class="label">BN connected:</span><span class="val ${ss.binanceUsdmReferenceConnected?'green':'yellow'}">${ss.binanceUsdmReferenceConnected?'yes':'reference only'}</span></div><div class="row"><span class="label">BN aggTrade:</span><span class="val ${ss.binanceUsdmLiveTradeReceiving?'green':'yellow'}">${ss.binanceUsdmLiveTradeReceiving?'active':'not active'}</span></div>`;
}

function updateRightPanel(){
  const el=document.getElementById('auction-content');if(!el)return;
  if(state.symbol&&state.symbolLoaded){
    el.innerHTML=`<div class="row"><span class="label">Symbol:</span><span class="val">${state.symbol}</span></div><div class="row"><span class="label">Interval:</span><span class="val">${state.interval}</span></div><div class="row"><span class="label">Candles:</span><span class="val">${state.candles.length}</span></div><div class="row"><span class="label">History:</span><span class="val ${state.historyLoaded?'green':''}">${state.historyLoaded?state.historyCount+' backfill':state.historySource||'loading...'}</span></div><div class="row"><span class="label">Bubbles:</span><span class="val">${state.bubbles.length}</span></div><div class="row"><span class="label">Zones:</span><span class="val">${state.zones.length}</span></div><div class="row"><span class="label">Zoom:</span><span class="val">${Math.round(state.view.candlesVisible)} candles</span></div><div class="row"><span class="label">Price:</span><span class="val ${state.view.manualPrice?'yellow':''}">${state.view.manualPrice?'Manual':'Auto'}</span></div><div class="row"><span class="label">Labels:</span><span class="val">${state.labelDensity}</span></div>`;
  }else if(state.symbol){el.innerHTML=`<div style="color:#f59e0b">Loading ${state.symbol}...</div>`;}else{el.innerHTML='<div style="color:#475569">No symbol selected</div>';}
}

function updateRangePanel(){
  const el=document.getElementById('range-content');if(!el)return;
  const sr=state.selectedRange;
  if(!sr){el.innerHTML='Select a range on chart';return;}
  if(!sr.profile){el.innerHTML='<div style="color:#f59e0b">Computing profile...</div>';return;}
  const p=sr.profile,duration=((sr.end-sr.start)/1000).toFixed(0);
  el.innerHTML=`<div class="row"><span class="label">Duration:</span><span class="val">${duration}s</span></div><div class="row"><span class="label">Range:</span><span class="val">${fmtPrice(sr.priceLow)} — ${fmtPrice(sr.priceHigh)}</span></div><div class="row"><span class="label">Volume:</span><span class="val">${fmtNum(p.totalVolume)}</span></div><div class="row"><span class="label">Buy Vol:</span><span class="val green">${fmtNum(p.buyVolume)}</span></div><div class="row"><span class="label">Sell Vol:</span><span class="val red">${fmtNum(p.sellVolume)}</span></div><div class="row"><span class="label">Delta:</span><span class="val ${p.delta>0?'green':'red'}">${p.delta>0?'+':''}${fmtNum(p.delta)}</span></div><div class="row"><span class="label">POC:</span><span class="val" style="color:#f59e0b">${fmtPrice(p.poc)}</span></div><div class="row"><span class="label">VAH:</span><span class="val" style="color:#3b82f6">${fmtPrice(p.vah)}</span></div><div class="row"><span class="label">VAL:</span><span class="val" style="color:#3b82f6">${fmtPrice(p.val)}</span></div><div class="row"><span class="label">ΔPOC:</span><span class="val" style="color:#a855f7">${fmtPrice(p.deltaPoc)}</span></div><div class="row"><span class="label">Side:</span><span class="val ${p.dominantSide==='buy'?'green':p.dominantSide==='sell'?'red':''}">${p.dominantSide}</span></div><div style="margin-top:6px;padding:4px;background:rgba(245,158,11,0.08);border-radius:3px;font-size:9px;color:#94a3b8">${p.interpretation||'—'}</div>`;
}

// Part 11: Debug panel
function updateDebugPanel(allCandles,startIdx,endIdx) {
  const body=document.getElementById('debug-body');if(!body)return;
  const latest=allCandles.length-1;
  body.innerHTML=`
    <div class="debug-row"><span class="dk">candleCount</span><span class="dv">${allCandles.length}</span></div>
    <div class="debug-row"><span class="dk">visibleCandleCount</span><span class="dv">${endIdx-startIdx+1}</span></div>
    <div class="debug-row"><span class="dk">candlesPerScreen</span><span class="dv">${Math.round(state.view.candlesVisible)}</span></div>
    <div class="debug-row"><span class="dk">minCandles</span><span class="dv">${MIN_CANDLES_VISIBLE}</span></div>
    <div class="debug-row"><span class="dk">maxCandles</span><span class="dv">${MAX_CANDLES_VISIBLE}</span></div>
    <div class="debug-row"><span class="dk">rightPadding</span><span class="dv">${RIGHT_PADDING_CANDLES}</span></div>
    <div class="debug-row"><span class="dk">followLive</span><span class="dv ${state.followLive?'ok':'warn'}">${state.followLive}</span></div>
    <div class="debug-row"><span class="dk">manualPrice</span><span class="dv ${state.view.manualPrice?'warn':'ok'}">${state.view.manualPrice}</span></div>
    <div class="debug-row"><span class="dk">latestCandleIdx</span><span class="dv">${latest}</span></div>
    <div class="debug-row"><span class="dk">viewportStart</span><span class="dv">${startIdx}</span></div>
    <div class="debug-row"><span class="dk">viewportEnd</span><span class="dv">${endIdx}</span></div>
    <div class="debug-row"><span class="dk">centerIndex</span><span class="dv">${state.view.centerIndex.toFixed(1)}</span></div>
    <div class="debug-row"><span class="dk">pricePerPixel</span><span class="dv">${state.view.pricePerPixel.toFixed(6)}</span></div>
    <div class="debug-row"><span class="dk">labelDensity</span><span class="dv">${state.labelDensity}</span></div>
    <div class="debug-row"><span class="dk">clusterCount</span><span class="dv">${state._clusterCount}</span></div>
    <div class="debug-row"><span class="dk">individualBubbles</span><span class="dv">${state._individualBubbleCount}</span></div>
    <div class="debug-row"><span class="dk">mouseMode</span><span class="dv">${state.mouse.isDown?'drag':state.activeTool}</span></div>
    <div class="debug-row"><span class="dk">lastValidVP</span><span class="dv">${state.lastValidViewport?'yes':'no'}</span></div>
  `;
}

// Scanner
function updateScannerUI(){
  const body=document.getElementById('scanner-body');if(!body)return;
  const data=state.scannerData;
  if(!data||!data.ok||!data.rows||!data.rows.length){
    const reason=data?.reason||'loading';const hydrated=data?.hydrated||{};
    let msg=reason==='universe_not_loaded'?`Hydrating... HL=${hydrated.hyperliquid?'✓':'...'} BN=${hydrated.binance?'✓':'...'}`:reason==='no_price_data'?'Universes loaded — waiting for trades...':'Loading scanner...';
    body.innerHTML=`<tr><td colspan="12" style="text-align:center;color:#475569">${msg}</td></tr>`;return;
  }
  body.innerHTML=data.rows.map(s=>`<tr class="${s.hlSymbol===state.symbol?'selected':''}" onclick="window.__selectSymbol('${s.hlSymbol}')"><td><strong>${s.hlSymbol}</strong>${s.isPinned?' ★':''}</td><td><span class="tag-status tag-${s.statusTag}">${s.statusTag}</span></td><td>${fmtPrice(s.price)}</td><td style="color:${s.change24h>0?'#22c55e':'#ef4444'}">${s.change24h>0?'+':''}${s.change24h.toFixed(2)}%</td><td>${fmtNum(s.volume)}</td><td style="color:${s.delta>0?'#22c55e':'#ef4444'}">${s.delta>0?'+':''}${fmtNum(s.delta)}</td><td>${s.tradeFrequency.toFixed(1)}/s</td><td>${s.bubbleCount}</td><td>${s.absorptionCount+s.rejectionCount}</td><td>${s.availableOnBinance?s.binanceSymbol:'<span style="color:#475569">—</span>'}</td></tr>`).join('');
}

// ============ BUTTONS ============
function initButtons(){
  document.getElementById('btn-follow-live').addEventListener('click',()=>{
    state.followLive=!state.followLive;state.view.userModified=!state.followLive;
    document.getElementById('btn-follow-live').classList.toggle('active',state.followLive);
    if(state.followLive){snapToLive();state.view.manualPrice=false;state._priceScaleDirty=true;}
  });
  // Part 10: Fit Recent button
  document.getElementById('btn-fit-recent').addEventListener('click',fitAll);
  document.getElementById('btn-fit-all').addEventListener('click',fitAllHistory);
  document.getElementById('btn-reset').addEventListener('click',resetToDefaultView);
  document.getElementById('btn-zoom-in').addEventListener('click',()=>{
    const chartW=state.width-state.priceScaleWidth;zoomAtScreenX(chartW/2,1/ZOOM_FACTOR_BTN);
    state.view.userModified=true;state.followLive=false;state._priceScaleDirty=true;document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-zoom-out').addEventListener('click',()=>{
    const chartW=state.width-state.priceScaleWidth;zoomAtScreenX(chartW/2,ZOOM_FACTOR_BTN);
    state.view.userModified=true;state.followLive=false;state._priceScaleDirty=true;document.getElementById('btn-follow-live').classList.remove('active');
  });
  document.getElementById('btn-auto-scale').addEventListener('click',()=>{
    state.view.autoScalePrice=!state.view.autoScalePrice;state.view.manualPrice=false;
    document.getElementById('btn-auto-scale').classList.toggle('active',state.view.autoScalePrice);
    if(state.view.autoScalePrice)state._priceScaleDirty=true;
  });

  // Part 7: Label density toggle
  document.getElementById('btn-labels').addEventListener('click',()=>{
    const modes=[LABEL_COMPACT,LABEL_FULL,LABEL_OFF];
    const idx=modes.indexOf(state.labelDensity);
    state.labelDensity=modes[(idx+1)%modes.length];
    const btn=document.getElementById('btn-labels');
    btn.classList.toggle('active',state.labelDensity!==LABEL_OFF);
    btn.title='Label Density: '+state.labelDensity.charAt(0).toUpperCase()+state.labelDensity.slice(1);
    btn.textContent='Ⓐ '+state.labelDensity.charAt(0).toUpperCase()+state.labelDensity.slice(1);
  });

  // Part 11: Debug toggle
  document.getElementById('btn-debug').addEventListener('click',()=>{
    state.debugOpen=!state.debugOpen;
    document.getElementById('debug-panel').classList.toggle('hidden',!state.debugOpen);
    document.getElementById('btn-debug').classList.toggle('active',state.debugOpen);
  });

  document.querySelectorAll('.tool-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{if(btn.dataset.tool==='delete')deleteSelectedDrawing();else setActiveTool(btn.dataset.tool);});
  });

  document.getElementById('interval-select').addEventListener('change',(e)=>{
    state.interval=e.target.value;
    // Part 8: Reset viewport on timeframe change
    state.candles=[];state.currentCandle=null;state.bubbles=[];state.zones=[];
    state._priceScaleDirty=true;
    resetToDefaultView();
    if(state.wsReady)state.ws.send(JSON.stringify({type:'set_interval',interval:state.interval}));
    if(state.symbol)fetchHistoricalCandles(state.symbol);
  });

  const symInput=document.getElementById('symbol-input'),symDropdown=document.getElementById('symbol-dropdown');
  symInput.addEventListener('focus',()=>showSymbolDropdown(symInput.value.toUpperCase()));
  symInput.addEventListener('input',(e)=>showSymbolDropdown(e.target.value.toUpperCase()));
  symInput.addEventListener('keydown',(e)=>{if(e.key==='Enter'){const val=symInput.value.toUpperCase().trim();if(val)selectSymbol(val);symDropdown.classList.add('hidden');}});
  symInput.addEventListener('blur',()=>setTimeout(()=>symDropdown.classList.add('hidden'),200));

  document.getElementById('scanner-mode').addEventListener('change',(e)=>{state.scannerMode=e.target.value;fetchScannerData();});

  document.querySelectorAll('.bottom-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.bottom-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function showSymbolDropdown(filter){
  const dropdown=document.getElementById('symbol-dropdown');const coins=window.__hlCoins||[];
  const filtered=filter?coins.filter(c=>c.startsWith(filter)).slice(0,30):coins.slice(0,30);
  if(!filtered.length){dropdown.classList.add('hidden');return;}
  dropdown.classList.remove('hidden');dropdown.innerHTML=filtered.map(c=>`<div class="dropdown-item" onclick="window.__selectSymbol('${c}')"><span>${c}</span><span class="tag">${symbolToBinance(c)}</span></div>`).join('');
}

// ============ SYMBOL SELECTION ============
function selectSymbol(symbol){
  const sym=symbol.toUpperCase().trim();if(!sym||state._loadingSymbol)return;
  state._loadingSymbol=true;state.symbol=sym;state.symbolError=null;
  state.candles=[];state.currentCandle=null;state.bubbles=[];state.zones=[];
  state.selectedRange=null;state.symbolLoaded=false;
  state.historyLoaded=false;state.historyCount=0;state.historySource='';
  state._priceScaleDirty=true;state.lastValidViewport=null;
  // Part 8: Reset viewport on symbol change
  state.view.centerIndex=0;state.view.candlesVisible=DEFAULT_CANDLES_VISIBLE;
  state.view.priceCenter=0;state.view.pricePerPixel=0.05;
  state.view.autoScalePrice=true;state.view.manualPrice=false;
  state.view.userModified=false;state.followLive=true;
  document.getElementById('btn-follow-live').classList.add('active');
  document.getElementById('btn-auto-scale').classList.add('active');
  document.getElementById('symbol-input').value=sym;document.getElementById('fp-symbol').textContent=sym;
  updateRangePanel();updateRightPanel();updateSourceUI();
  fetch('/api/select-symbol',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'hyperliquid',symbol:sym,interval:state.interval})})
    .then(r=>r.json()).then(data=>{
      if(data.ok){if(data.lastError){state.symbolError=data.lastError;showToast(data.lastError,'warn');}if(!data.historicalCandlesLoaded)fetchHistoricalCandles(sym);}
      else{state.symbolError=data.error||'Failed to load symbol';showToast('Symbol error: '+(data.error||'unknown'),'error');state._loadingSymbol=false;}
    }).catch(err=>{state.symbolError='Network error — retrying';showToast('REST error: '+err.message,'warn');if(state.wsReady)state.ws.send(JSON.stringify({type:'subscribe_symbol',symbol:sym}));fetchHistoricalCandles(sym);state._loadingSymbol=false;});
  if(state.wsReady)state.ws.send(JSON.stringify({type:'subscribe_symbol',symbol:sym}));
  fetchHistoricalCandles(sym);fetchScannerData();loadDrawings();
}
window.__selectSymbol=selectSymbol;

function fetchScannerData(){fetch(`/api/scanner?mode=${state.scannerMode}`).then(r=>r.json()).then(data=>{state.scannerData=data;updateScannerUI();}).catch(()=>{});}

function updateFootprint(){
  if(!state.symbol)return;
  fetch(`/orderflow/footprint?symbol=${state.symbol}`).then(r=>r.json()).then(data=>{
    const el=document.getElementById('footprint-content');if(!el)return;
    if(!data.levels||!Object.keys(data.levels).length){el.innerHTML='<div style="color:#475569">No footprint data</div>';return;}
    const levels=Object.entries(data.levels).map(([price,l])=>({price:parseFloat(price),...l})).sort((a,b)=>b.price-a.price);
    const maxT=Math.max(...levels.map(l=>l.total),1);
    el.innerHTML=levels.map(l=>{const d=l.buy-l.sell;return `<div class="fp-row"><span class="price-col">${fmtPrice(l.price)}</span><span class="buy-col"><span class="bar buy" style="width:${l.buy/maxT*80}px"></span> ${fmtNum(l.buy)}</span><span class="sell-col">${fmtNum(l.sell)} <span class="bar sell" style="width:${l.sell/maxT*80}px"></span></span><span class="delta-col" style="color:${d>0?'#22c55e':'#ef4444'}">${d>0?'+':''}${fmtNum(d)}</span></div>`;}).join('');
  }).catch(()=>{});
}

function startStatusPolling(){setInterval(()=>{fetch('/api/status').then(r=>r.json()).then(status=>{state.sourceStatus=status;updateSourceUI();updateRightPanel();}).catch(()=>{});},5000);}

// ============ INIT ============
function init(){
  initCanvas();initInput();initButtons();connectWS();fetchScannerData();
  setInterval(fetchScannerData,5000);startStatusPolling();setInterval(updateFootprint,3000);
  requestAnimationFrame(render);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
