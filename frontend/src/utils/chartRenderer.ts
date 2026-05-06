import { FootprintCandle, BigTrade, VolumeProfile, ChartViewport } from '../types';
import { HeatmapCell } from '../types/connector';

const COLORS = {
  bg: '#0a0a0f',
  grid: '#1a1a25',
  gridText: '#4a4a5a',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
  candleUpFill: '#1a3d38',
  candleDownFill: '#3d1a1a',
  wickUp: '#26a69a',
  wickDown: '#ef5350',
  volumeBar: '#2a2a3a',
  buyText: '#26a69a',
  sellText: '#ef5350',
  deltaPositive: '#26a69a',
  deltaNegative: '#ef5350',
  poc: '#ffab00',
  valueArea: '#2196f320',
  bubbleBuy: 'rgba(38, 166, 154, 0.35)',
  bubbleSell: 'rgba(239, 83, 80, 0.35)',
  bubbleBuyStroke: 'rgba(38, 166, 154, 0.7)',
  bubbleSellStroke: 'rgba(239, 83, 80, 0.7)',
  liquidationBuy: '#ffab0080',
  liquidationSell: '#ff6d0080',
  vpBar: 'rgba(33, 150, 243, 0.15)',
  vpBarPoc: 'rgba(255, 171, 0, 0.3)',
  cvdPositive: '#26a69a',
  cvdNegative: '#ef5350',
  crosshair: '#ffffff30',
  priceLabel: '#ffffff',
};

export function renderChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  candles: FootprintCandle[],
  bigTrades: BigTrade[],
  volumeProfile: VolumeProfile | null,
  heatmapData: HeatmapCell[],
  heatmapMaxSize: number,
  viewport: ChartViewport,
  currentPrice: number,
  options: {
    showBigTrades: boolean;
    showVolumeProfile: boolean;
    showHeatmap: boolean;
    heatmapIntensity: number;
    bigTradeFilter: string;
    panelHeights: { delta: number; cvd: number };
  }
) {
  const { startTime, endTime, priceLow, priceHigh } = viewport;
  const timeRange = endTime - startTime;
  const priceRange = priceHigh - priceLow;
  if (timeRange <= 0 || priceRange <= 0) return;

  const mainHeight = height - options.panelHeights.delta - options.panelHeights.cvd;
  const priceToY = (price: number) => mainHeight - ((price - priceLow) / priceRange) * mainHeight;
  const timeToX = (time: number) => ((time - startTime) / timeRange) * width;
  const yToPrice = (y: number) => priceLow + ((mainHeight - y) / mainHeight) * priceRange;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  renderGrid(ctx, width, mainHeight, priceLow, priceHigh, startTime, endTime, priceToY, timeToX);
  if (options.showHeatmap && heatmapData.length > 0) {
    renderHeatmap(ctx, width, mainHeight, heatmapData, heatmapMaxSize, viewport, priceToY, options.heatmapIntensity);
  }
  renderVolumeProfilePanel(ctx, width, mainHeight, volumeProfile, priceToY, viewport, options.showVolumeProfile);
  renderCandles(ctx, candles, viewport, priceToY, timeToX, mainHeight, width);
  renderBigTradeBubbles(ctx, bigTrades, viewport, priceToY, timeToX, mainHeight, options);
  renderCurrentPriceLine(ctx, currentPrice, width, mainHeight, priceToY);
  renderDeltaPanel(ctx, candles, viewport, width, mainHeight, options.panelHeights.delta, timeToX);
  renderCVDPanel(ctx, candles, viewport, width, mainHeight + options.panelHeights.delta, options.panelHeights.cvd, timeToX);
  renderPriceAxis(ctx, width, mainHeight, priceLow, priceHigh, priceToY);
  renderTimeAxis(ctx, width, height, startTime, endTime, timeToX);
}

function renderGrid(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  priceLow: number, priceHigh: number, startTime: number, endTime: number,
  priceToY: (p: number) => number, timeToX: (t: number) => number
) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;

  const priceRange = priceHigh - priceLow;
  let priceStep = 10;
  if (priceRange > 2000) priceStep = 500;
  else if (priceRange > 500) priceStep = 100;
  else if (priceRange > 200) priceStep = 50;
  else if (priceRange > 50) priceStep = 10;
  else if (priceRange > 10) priceStep = 5;
  else priceStep = 1;

  const startPrice = Math.ceil(priceLow / priceStep) * priceStep;
  ctx.font = '10px monospace';
  ctx.fillStyle = COLORS.gridText;
  ctx.textAlign = 'right';

  for (let p = startPrice; p <= priceHigh; p += priceStep) {
    const y = priceToY(p);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(p.toFixed(1), width - 5, y - 3);
  }

  const timeRange = endTime - startTime;
  let timeStep = 60000;
  if (timeRange > 3600000) timeStep = 600000;
  else if (timeRange > 1800000) timeStep = 300000;
  else if (timeRange > 600000) timeStep = 60000;
  else if (timeRange > 120000) timeStep = 30000;
  else timeStep = 10000;

  ctx.textAlign = 'center';
  const start = Math.ceil(startTime / timeStep) * timeStep;
  for (let t = start; t <= endTime; t += timeStep) {
    const x = timeToX(t);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    const d = new Date(t);
    ctx.fillText(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`, x, height + 12);
  }
}

function renderHeatmap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cells: HeatmapCell[],
  maxSize: number,
  viewport: ChartViewport,
  priceToY: (p: number) => number,
  intensity: number
) {
  const { priceLow, priceHigh } = viewport;
  const priceRange = priceHigh - priceLow;

  // Calculate cell height based on price range and tick size
  const sampleCell = cells[0];
  if (!sampleCell) return;

  // Estimate tick size from cell spacing
  const sortedPrices = cells.map(c => c.price).sort((a, b) => a - b);
  let tickSize = 10;
  for (let i = 1; i < sortedPrices.length; i++) {
    const diff = sortedPrices[i] - sortedPrices[i - 1];
    if (diff > 0) { tickSize = diff; break; }
  }

  const cellHeightPx = Math.max(1, (tickSize / priceRange) * height);
  const barMaxWidth = width * 0.4;  // Heatmap takes max 40% of chart width

  for (const cell of cells) {
    if (cell.price < priceLow || cell.price > priceHigh) continue;

    const y = priceToY(cell.price);
    const barWidth = cell.intensity * barMaxWidth * intensity;

    // Color: green for bids, red for asks
    const alpha = 0.1 + cell.intensity * 0.5 * intensity;
    if (cell.side === 'bid') {
      ctx.fillStyle = `rgba(38, 166, 154, ${alpha})`;
    } else {
      ctx.fillStyle = `rgba(239, 83, 80, ${alpha})`;
    }

    // Draw from edge: bids from left, asks from right
    if (cell.side === 'bid') {
      ctx.fillRect(0, y - cellHeightPx / 2, barWidth, cellHeightPx);
    } else {
      ctx.fillRect(width - barWidth, y - cellHeightPx / 2, barWidth, cellHeightPx);
    }

    // Draw size label for large levels
    if (cell.intensity > 0.3 && cellHeightPx > 8) {
      ctx.font = '8px monospace';
      ctx.fillStyle = cell.side === 'bid' ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)';
      if (cell.side === 'bid') {
        ctx.textAlign = 'left';
        ctx.fillText(cell.size.toFixed(3), 4, y + 3);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(cell.size.toFixed(3), width - 4, y + 3);
      }
    }
  }
}

function renderCandles(
  ctx: CanvasRenderingContext2D, candles: FootprintCandle[],
  viewport: ChartViewport, priceToY: (p: number) => number,
  timeToX: (t: number) => number, height: number, width: number
) {
  const { startTime, endTime } = viewport;
  const visible = candles.filter(c => c.timestamp >= startTime - 60000 && c.timestamp <= endTime + 60000);
  if (visible.length === 0) return;

  const timeRange = endTime - startTime;
  const candleWidth = Math.max(2, (width / (timeRange / (visible[1]?.timestamp - visible[0]?.timestamp || 60000))) * 0.7);
  const isZoomedIn = candleWidth > 20;

  for (const candle of visible) {
    const x = timeToX(candle.timestamp);
    if (x < -candleWidth || x > width + candleWidth) continue;

    const isUp = candle.close >= candle.open;
    const bodyTop = priceToY(Math.max(candle.open, candle.close));
    const bodyBottom = priceToY(Math.min(candle.open, candle.close));
    const wickTop = priceToY(candle.high);
    const wickBottom = priceToY(candle.low);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    ctx.strokeStyle = isUp ? COLORS.wickUp : COLORS.wickDown;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + candleWidth / 2, wickTop);
    ctx.lineTo(x + candleWidth / 2, wickBottom);
    ctx.stroke();

    ctx.fillStyle = isUp ? COLORS.candleUpFill : COLORS.candleDownFill;
    ctx.strokeStyle = isUp ? COLORS.candleUp : COLORS.candleDown;
    ctx.lineWidth = 1;
    ctx.fillRect(x, bodyTop, candleWidth, bodyHeight);
    ctx.strokeRect(x, bodyTop, candleWidth, bodyHeight);

    if (isZoomedIn && candle.cells.size > 0) {
      renderFootprintCells(ctx, candle, x, candleWidth, priceToY, isZoomedIn);
    } else {
      const midY = (bodyTop + bodyBottom) / 2;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = candle.delta >= 0 ? COLORS.deltaPositive : COLORS.deltaNegative;
      ctx.fillText(`${candle.delta >= 0 ? '+' : ''}${candle.delta.toFixed(1)}`, x + candleWidth / 2, midY + 3);
    }

    if (candleWidth > 8) {
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.volumeBar;
      const volY = bodyBottom + 12;
      ctx.fillText(`V:${candle.totalVolume.toFixed(1)}`, x + 2, volY);
    }
  }
}

function renderFootprintCells(
  ctx: CanvasRenderingContext2D, candle: FootprintCandle,
  x: number, candleWidth: number, priceToY: (p: number) => number, isZoomed: boolean
) {
  const cells = Array.from(candle.cells.values()).sort((a, b) => b.price - a.price);
  if (cells.length === 0) return;

  const cellHeight = Math.max(10, Math.min(20, candleWidth * 0.5));
  const halfWidth = candleWidth / 2;

  for (const cell of cells) {
    const y = priceToY(cell.price);
    const total = cell.buyVolume + cell.sellVolume;
    if (total < 0.01) continue;

    const buyRatio = cell.buyVolume / total;
    const isHighDelta = Math.abs(cell.delta) > total * 0.6;

    if (isHighDelta) {
      ctx.fillStyle = cell.delta > 0 ? 'rgba(38, 166, 154, 0.08)' : 'rgba(239, 83, 80, 0.08)';
      ctx.fillRect(x, y - cellHeight / 2, candleWidth, cellHeight);
    }

    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.buyText;
    ctx.fillText(cell.buyVolume.toFixed(1), x + halfWidth - 2, y + 3);

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.sellText;
    ctx.fillText(cell.sellVolume.toFixed(1), x + halfWidth + 2, y + 3);

    if (cellHeight > 14) {
      ctx.textAlign = 'center';
      ctx.fillStyle = cell.delta >= 0 ? COLORS.deltaPositive : COLORS.deltaNegative;
      ctx.font = '7px monospace';
      ctx.fillText(`${cell.delta >= 0 ? '+' : ''}${cell.delta.toFixed(1)}`, x + halfWidth, y - cellHeight / 2 + 9);
    }
  }
}

function renderBigTradeBubbles(
  ctx: CanvasRenderingContext2D, bigTrades: BigTrade[],
  viewport: ChartViewport, priceToY: (p: number) => number,
  timeToX: (t: number) => number, height: number,
  options: { showBigTrades: boolean; bigTradeFilter: string }
) {
  if (!options.showBigTrades) return;

  const filtered = bigTrades.filter(bt => {
    if (options.bigTradeFilter === 'all') return true;
    if (options.bigTradeFilter === 'medium') return bt.sizeCategory === 'medium';
    if (options.bigTradeFilter === 'large') return bt.sizeCategory === 'large' || bt.sizeCategory === 'extreme';
    if (options.bigTradeFilter === 'extreme') return bt.sizeCategory === 'extreme';
    return true;
  });

  for (const bt of filtered) {
    const { trade } = bt;
    if (trade.timestamp < viewport.startTime || trade.timestamp > viewport.endTime) continue;

    const x = timeToX(trade.timestamp);
    const y = priceToY(trade.price);

    let radius: number;
    switch (bt.sizeCategory) {
      case 'extreme': radius = 18 + Math.min(bt.notional / 500000, 15); break;
      case 'large': radius = 10 + Math.min(bt.notional / 200000, 10); break;
      default: radius = 5 + Math.min(bt.notional / 100000, 6);
    }

    const isBuy = trade.aggressor === 'buy';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isBuy ? COLORS.bubbleBuy : COLORS.bubbleSell;
    ctx.fill();
    ctx.strokeStyle = isBuy ? COLORS.bubbleBuyStroke : COLORS.bubbleSellStroke;
    ctx.lineWidth = bt.sizeCategory === 'extreme' ? 2.5 : 1.5;
    ctx.stroke();

    if (radius > 12) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${trade.quantity.toFixed(1)}`, x, y);
    }

    if (trade.isLiquidation) {
      ctx.strokeStyle = '#ffab00';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function renderCurrentPriceLine(
  ctx: CanvasRenderingContext2D, price: number, width: number, height: number,
  priceToY: (p: number) => number
) {
  const y = priceToY(price);
  ctx.strokeStyle = '#ffffff40';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#2196f3';
  ctx.fillRect(width - 70, y - 10, 68, 20);
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(price.toFixed(1), width - 36, y);
}

function renderVolumeProfilePanel(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  profile: VolumeProfile | null, priceToY: (p: number) => number,
  viewport: ChartViewport, show: boolean
) {
  if (!show || !profile || profile.levels.length === 0) return;

  const maxVol = Math.max(...profile.levels.map(l => l.volume));
  const maxBarWidth = width * 0.15;

  for (const level of profile.levels) {
    if (level.price < viewport.priceLow || level.price > viewport.priceHigh) continue;
    const y = priceToY(level.price);
    const barWidth = (level.volume / maxVol) * maxBarWidth;
    const isPOC = Math.abs(level.price - profile.poc) < 0.05;

    ctx.fillStyle = isPOC ? COLORS.vpBarPoc : COLORS.vpBar;
    ctx.fillRect(0, y - 2, barWidth, 4);

    if (isPOC) {
      ctx.strokeStyle = COLORS.poc;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }
}

function renderDeltaPanel(
  ctx: CanvasRenderingContext2D, candles: FootprintCandle[],
  viewport: ChartViewport, width: number, yOffset: number, panelHeight: number,
  timeToX: (t: number) => number
) {
  if (panelHeight <= 0) return;

  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, yOffset, width, panelHeight);

  const visible = candles.filter(c => c.timestamp >= viewport.startTime && c.timestamp <= viewport.endTime);
  if (visible.length === 0) return;

  const maxDelta = Math.max(1, ...visible.map(c => Math.abs(c.delta)));
  const midY = yOffset + panelHeight / 2;

  ctx.strokeStyle = '#1a1a25';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();

  const barWidth = Math.max(2, (width / visible.length) * 0.6);

  for (const candle of visible) {
    const x = timeToX(candle.timestamp);
    const barHeight = (Math.abs(candle.delta) / maxDelta) * (panelHeight / 2 - 4);

    ctx.fillStyle = candle.delta >= 0 ? COLORS.deltaPositive : COLORS.deltaNegative;
    if (candle.delta >= 0) {
      ctx.fillRect(x, midY - barHeight, barWidth, barHeight);
    } else {
      ctx.fillRect(x, midY, barWidth, barHeight);
    }
  }

  ctx.font = '9px monospace';
  ctx.fillStyle = '#6a6a7a';
  ctx.textAlign = 'left';
  ctx.fillText('DELTA', 5, yOffset + 11);
}

function renderCVDPanel(
  ctx: CanvasRenderingContext2D, candles: FootprintCandle[],
  viewport: ChartViewport, width: number, yOffset: number, panelHeight: number,
  timeToX: (t: number) => number
) {
  if (panelHeight <= 0) return;

  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, yOffset, width, panelHeight);

  const visible = candles.filter(c => c.timestamp >= viewport.startTime && c.timestamp <= viewport.endTime);
  if (visible.length < 2) return;

  let cvd = 0;
  const cvdPoints: { x: number; y: number; value: number }[] = [];
  let minCvd = Infinity, maxCvd = -Infinity;

  for (const c of visible) {
    cvd += c.delta;
    const x = timeToX(c.timestamp);
    cvdPoints.push({ x, y: 0, value: cvd });
    minCvd = Math.min(minCvd, cvd);
    maxCvd = Math.max(maxCvd, cvd);
  }

  const cvdRange = maxCvd - minCvd || 1;
  const padding = 4;
  for (const p of cvdPoints) {
    p.y = yOffset + panelHeight - padding - ((p.value - minCvd) / cvdRange) * (panelHeight - 2 * padding);
  }

  ctx.strokeStyle = '#1a1a25';
  ctx.lineWidth = 0.5;
  const zeroY = yOffset + panelHeight - padding - ((0 - minCvd) / cvdRange) * (panelHeight - 2 * padding);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(width, zeroY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cvdPoints[0].x, cvdPoints[0].y);
  for (let i = 1; i < cvdPoints.length; i++) {
    ctx.lineTo(cvdPoints[i].x, cvdPoints[i].y);
  }
  ctx.strokeStyle = '#2196f3';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
  ctx.lineTo(cvdPoints[cvdPoints.length - 1].x, yOffset + panelHeight);
  ctx.lineTo(cvdPoints[0].x, yOffset + panelHeight);
  ctx.closePath();
  ctx.fill();

  ctx.font = '9px monospace';
  ctx.fillStyle = '#6a6a7a';
  ctx.textAlign = 'left';
  ctx.fillText('CVD', 5, yOffset + 11);

  const lastCvd = cvdPoints[cvdPoints.length - 1];
  ctx.textAlign = 'right';
  ctx.fillStyle = lastCvd.value >= 0 ? COLORS.cvdPositive : COLORS.cvdNegative;
  ctx.fillText(lastCvd.value.toFixed(0), width - 5, yOffset + 11);
}

function renderPriceAxis(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  priceLow: number, priceHigh: number, priceToY: (p: number) => number
) {
  const axisWidth = 68;
  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(width - axisWidth, 0, axisWidth, height);

  const priceRange = priceHigh - priceLow;
  let priceStep = 10;
  if (priceRange > 2000) priceStep = 500;
  else if (priceRange > 500) priceStep = 100;
  else if (priceRange > 200) priceStep = 50;
  else if (priceRange > 50) priceStep = 10;
  else if (priceRange > 10) priceStep = 5;
  else priceStep = 1;

  ctx.font = '10px monospace';
  ctx.textAlign = 'center';

  const startPrice = Math.ceil(priceLow / priceStep) * priceStep;
  for (let p = startPrice; p <= priceHigh; p += priceStep) {
    const y = priceToY(p);
    ctx.fillStyle = '#8a8a9a';
    ctx.fillText(p.toFixed(1), width - axisWidth / 2, y + 3);
  }
}

function renderTimeAxis(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  startTime: number, endTime: number, timeToX: (t: number) => number
) {
  const axisHeight = 20;
  ctx.fillStyle = '#0d0d14';
  ctx.fillRect(0, height - axisHeight, width, axisHeight);

  const timeRange = endTime - startTime;
  let timeStep = 60000;
  if (timeRange > 3600000) timeStep = 600000;
  else if (timeRange > 1800000) timeStep = 300000;
  else if (timeRange > 600000) timeStep = 60000;
  else if (timeRange > 120000) timeStep = 30000;
  else timeStep = 10000;

  ctx.font = '9px monospace';
  ctx.fillStyle = '#6a6a7a';
  ctx.textAlign = 'center';

  const start = Math.ceil(startTime / timeStep) * timeStep;
  for (let t = start; t <= endTime; t += timeStep) {
    const x = timeToX(t);
    const d = new Date(t);
    ctx.fillText(
      `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`,
      x, height - 6
    );
  }
}
