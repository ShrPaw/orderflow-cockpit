import { Trade, FootprintCandle, FootprintCell, VolumeProfile, VolumeProfileLevel, BigTrade, SessionStats } from '../types';

let tradeIdCounter = 0;

function generateId(): string {
  return `t_${Date.now()}_${++tradeIdCounter}`;
}

function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export class MarketDataGenerator {
  private currentPrice: number;
  private volatility: number;
  private drift: number;
  private tickSize: number;
  private baseVolume: number;
  private sessionStartTime: number;

  constructor(startPrice: number = 67500) {
    this.currentPrice = startPrice;
    this.volatility = 0.0003;
    this.drift = 0;
    this.tickSize = 0.1;
    this.baseVolume = 0.5;
    this.sessionStartTime = Date.now() - 3600000;
  }

  generateTrade(): Trade {
    const priceChange = gaussianRandom() * this.volatility * this.currentPrice;
    this.currentPrice += priceChange + this.drift;
    this.currentPrice = Math.round(this.currentPrice / this.tickSize) * this.tickSize;

    const volumeMultiplier = 0.2 + Math.random() * 3;
    const isLarge = Math.random() < 0.02;
    const isExtreme = Math.random() < 0.002;
    let quantity = this.baseVolume * volumeMultiplier;
    if (isExtreme) quantity *= 20 + Math.random() * 80;
    else if (isLarge) quantity *= 5 + Math.random() * 15;

    quantity = Math.round(quantity * 1000) / 1000;

    const bidAskBias = Math.random();
    const aggressor: 'buy' | 'sell' = bidAskBias > 0.5 ? 'buy' : 'sell';

    return {
      id: generateId(),
      timestamp: Date.now(),
      price: this.currentPrice,
      quantity,
      aggressor,
      exchange: 'binance',
      symbol: 'BTCUSDT',
      isLiquidation: isExtreme && Math.random() > 0.5,
    };
  }

  generateBatch(count: number): Trade[] {
    const trades: Trade[] = [];
    for (let i = 0; i < count; i++) {
      trades.push(this.generateTrade());
    }
    return trades;
  }

  getCurrentPrice(): number {
    return this.currentPrice;
  }

  setPrice(price: number): void {
    this.currentPrice = price;
  }
}

export function aggregateIntoFootprints(
  trades: Trade[],
  periodMs: number,
  tickSize: number = 0.1
): FootprintCandle[] {
  if (trades.length === 0) return [];

  const candles: FootprintCandle[] = [];
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  let periodStart = Math.floor(sorted[0].timestamp / periodMs) * periodMs;
  let currentCells = new Map<number, FootprintCell>();
  let open = 0, high = 0, low = Infinity, close = 0;
  let totalVolume = 0, buyVolume = 0, sellVolume = 0;

  const finalizeCandle = () => {
    if (currentCells.size === 0) return;
    let maxVolPrice = 0, maxVol = 0;
    for (const [price, cell] of currentCells) {
      const total = cell.buyVolume + cell.sellVolume;
      if (total > maxVol) { maxVol = total; maxVolPrice = price; }
    }
    candles.push({
      timestamp: periodStart,
      open, high, low: low === Infinity ? open : low, close,
      totalVolume, buyVolume, sellVolume,
      delta: buyVolume - sellVolume,
      poc: maxVolPrice,
      cells: currentCells,
    });
  };

  for (const trade of sorted) {
    const tradePeriod = Math.floor(trade.timestamp / periodMs) * periodMs;
    if (tradePeriod !== periodStart) {
      finalizeCandle();
      periodStart = tradePeriod;
      currentCells = new Map();
      open = 0; high = 0; low = Infinity; close = 0;
      totalVolume = 0; buyVolume = 0; sellVolume = 0;
    }

    const priceLevel = Math.round(trade.price / tickSize) * tickSize;
    const cell = currentCells.get(priceLevel) || { price: priceLevel, buyVolume: 0, sellVolume: 0, delta: 0, tradeCount: 0 };

    if (trade.aggressor === 'buy') {
      cell.buyVolume += trade.quantity;
      buyVolume += trade.quantity;
    } else {
      cell.sellVolume += trade.quantity;
      sellVolume += trade.quantity;
    }
    cell.delta = cell.buyVolume - cell.sellVolume;
    cell.tradeCount++;
    currentCells.set(priceLevel, cell);

    totalVolume += trade.quantity;
    if (open === 0) open = trade.price;
    close = trade.price;
    high = Math.max(high, trade.price);
    low = Math.min(low, trade.price);
  }

  finalizeCandle();
  return candles;
}

export function calculateVolumeProfile(candles: FootprintCandle[]): VolumeProfile {
  const levelMap = new Map<number, VolumeProfileLevel>();

  for (const candle of candles) {
    for (const [price, cell] of candle.cells) {
      const existing = levelMap.get(price) || { price, volume: 0, buyVolume: 0, sellVolume: 0 };
      existing.volume += cell.buyVolume + cell.sellVolume;
      existing.buyVolume += cell.buyVolume;
      existing.sellVolume += cell.sellVolume;
      levelMap.set(price, existing);
    }
  }

  const levels = Array.from(levelMap.values()).sort((a, b) => a.price - b.price);
  if (levels.length === 0) return { levels: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, totalVolume: 0 };

  const totalVolume = levels.reduce((s, l) => s + l.volume, 0);
  let maxVol = 0, pocPrice = levels[0].price;
  for (const l of levels) {
    if (l.volume > maxVol) { maxVol = l.volume; pocPrice = l.price; }
  }

  const pocIdx = levels.findIndex(l => l.price === pocPrice);
  let vaVolume = totalVolume * 0.7;
  let accumulated = levels[pocIdx].volume;
  let loIdx = pocIdx, hiIdx = pocIdx;

  while (accumulated < vaVolume && (loIdx > 0 || hiIdx < levels.length - 1)) {
    const loVol = loIdx > 0 ? levels[loIdx - 1].volume : 0;
    const hiVol = hiIdx < levels.length - 1 ? levels[hiIdx + 1].volume : 0;
    if (loVol >= hiVol && loIdx > 0) { loIdx--; accumulated += levels[loIdx].volume; }
    else if (hiIdx < levels.length - 1) { hiIdx++; accumulated += levels[hiIdx].volume; }
    else break;
  }

  return {
    levels,
    poc: pocPrice,
    valueAreaHigh: levels[hiIdx].price,
    valueAreaLow: levels[loIdx].price,
    totalVolume,
  };
}

export function detectBigTrades(
  trades: Trade[],
  thresholds: { medium: number; large: number; extreme: number }
): BigTrade[] {
  return trades
    .filter(t => t.quantity >= thresholds.medium)
    .map(t => ({
      trade: t,
      notional: t.price * t.quantity,
      sizeCategory: t.quantity >= thresholds.extreme ? 'extreme' :
                    t.quantity >= thresholds.large ? 'large' : 'medium',
    }));
}

export function calculateSessionStats(trades: Trade[]): SessionStats {
  if (trades.length === 0) {
    return { totalVolume: 0, totalBuyVolume: 0, totalSellVolume: 0, netDelta: 0, highPrice: 0, lowPrice: 0, tradeCount: 0, vwap: 0, bigTradeCount: 0 };
  }

  let totalVolume = 0, buyVolume = 0, sellVolume = 0;
  let high = -Infinity, low = Infinity;
  let vwapNum = 0;

  for (const t of trades) {
    totalVolume += t.quantity;
    if (t.aggressor === 'buy') buyVolume += t.quantity;
    else sellVolume += t.quantity;
    high = Math.max(high, t.price);
    low = Math.min(low, t.price);
    vwapNum += t.price * t.quantity;
  }

  return {
    totalVolume, totalBuyVolume: buyVolume, totalSellVolume: sellVolume,
    netDelta: buyVolume - sellVolume, highPrice: high, lowPrice: low,
    tradeCount: trades.length, vwap: totalVolume > 0 ? vwapNum / totalVolume : 0,
    bigTradeCount: trades.filter(t => t.quantity >= 5).length,
  };
}
