// Candle engine — aggregates raw trades into custom interval OHLCV + orderflow candles
// Phase 4: Robust 40s aggregation + interval switching with trade buffering

class CandleEngine {
  constructor(intervalMs = 40000) {
    this.intervalMs = intervalMs;
    this.candles = new Map(); // symbol -> candle[]
    this.current = new Map(); // symbol -> current candle
    this.listeners = [];
    this.maxCandles = 2000;

    // Phase 4: Trade buffer for interval switching
    this.tradeBuffer = new Map(); // symbol -> trade[] (last N trades)
    this.maxBufferSize = 10000; // per symbol
  }

  setInterval(ms) {
    if (ms === this.intervalMs) return;
    this.intervalMs = ms;
    // Clear current candles so they rebuild from buffer
    this.current.clear();
    // Rebuild from buffered trades
    this._rebuildFromBuffer();
  }

  onCandle(listener) {
    this.listeners.push(listener);
  }

  processTrade(trade) {
    const { symbol, price, qty, side, time, source } = trade;

    // Buffer trade for interval switching
    if (!this.tradeBuffer.has(symbol)) {
      this.tradeBuffer.set(symbol, []);
    }
    const buf = this.tradeBuffer.get(symbol);
    buf.push({ price, qty, side, time, source });
    if (buf.length > this.maxBufferSize) buf.shift();

    const bucket = Math.floor(time / this.intervalMs) * this.intervalMs;
    let candle = this.current.get(symbol);

    if (!candle || candle.openTime !== bucket) {
      if (candle) this._closeCandle(symbol, candle);
      candle = {
        symbol,
        openTime: bucket,
        closeTime: bucket + this.intervalMs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        tradeCount: 0,
        maxTradeSize: 0,
        largeTradeCount: 0,
        bubbleCount: 0,
        absorptionCount: 0,
        rejectionCount: 0,
        priceMap: new Map(),
        bubbles: [],
        source
      };
      this.current.set(symbol, candle);
    }

    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;
    candle.volume += qty;
    candle.tradeCount++;

    if (side === 'buy') {
      candle.buyVolume += qty;
      candle.delta += qty;
    } else {
      candle.sellVolume += qty;
      candle.delta -= qty;
    }

    candle.maxTradeSize = Math.max(candle.maxTradeSize, qty);

    const notional = price * qty;
    if (notional > 10000) candle.largeTradeCount++;

    // Bubble detection
    if (notional > 5000 || qty > 100) {
      candle.bubbleCount++;
      candle.bubbles.push({
        price,
        qty,
        side,
        notional,
        time,
        state: 'pending',
        source
      });
    }

    // Price-level footprint
    const bin = this._priceBin(price, symbol);
    let level = candle.priceMap.get(bin);
    if (!level) {
      level = { buy: 0, sell: 0, total: 0, delta: 0, maxPrint: 0, trades: 0, absorptions: 0, rejections: 0 };
      candle.priceMap.set(bin, level);
    }
    if (side === 'buy') {
      level.buy += qty;
      level.delta += qty;
    } else {
      level.sell += qty;
      level.delta -= qty;
    }
    level.total += qty;
    level.trades++;
    level.maxPrint = Math.max(level.maxPrint, qty);

    // Absorption detection
    if (notional > 20000 && level.trades > 3) {
      const imbalance = Math.abs(level.delta) / level.total;
      if (imbalance < 0.3) {
        level.absorptions++;
        candle.absorptionCount++;
      }
    }

    // Rejection detection
    if (notional > 15000) {
      const range = candle.high - candle.low;
      const midPrice = (candle.high + candle.low) / 2;
      if (range / midPrice < 0.001) {
        level.rejections++;
        candle.rejectionCount++;
      }
    }
  }

  _rebuildFromBuffer() {
    // Rebuild all candles from buffered trades
    for (const [symbol, trades] of this.tradeBuffer) {
      // Clear existing candles for this symbol
      this.candles.set(symbol, []);

      // Replay trades
      for (const t of trades) {
        this.processTrade({ symbol, ...t });
      }
    }
  }

  _closeCandle(symbol, candle) {
    const priceLevels = {};
    for (const [bin, level] of candle.priceMap) {
      priceLevels[bin] = level;
    }

    const closed = {
      ...candle,
      priceMap: priceLevels,
      priceMapSize: candle.priceMap.size
    };

    if (!this.candles.has(symbol)) this.candles.set(symbol, []);
    const arr = this.candles.get(symbol);
    arr.push(closed);
    if (arr.length > this.maxCandles) arr.shift();

    this._classifyBubbles(closed);

    for (const fn of this.listeners) {
      fn(closed);
    }
  }

  _classifyBubbles(candle) {
    const range = candle.high - candle.low;
    const mid = (candle.high + candle.low) / 2;
    const rangeRatio = range / mid;

    for (const bubble of candle.bubbles) {
      const distFromMid = Math.abs(bubble.price - mid) / mid;

      if (rangeRatio < 0.002) {
        bubble.state = 'absorbed';
      } else if (distFromMid > 0.7 && bubble.notional > 30000) {
        bubble.state = 'rejected';
      } else if (bubble.notional > 50000) {
        bubble.state = 'exhausted';
      } else {
        bubble.state = 'accepted';
      }
    }
  }

  _priceBin(price, symbol) {
    let binSize;
    if (price > 10000) binSize = 10;
    else if (price > 1000) binSize = 5;
    else if (price > 100) binSize = 1;
    else if (price > 10) binSize = 0.1;
    else if (price > 1) binSize = 0.01;
    else binSize = 0.001;
    return Math.round(price / binSize) * binSize;
  }

  injectHistorical(symbol, candle) {
    if (!this.candles.has(symbol)) this.candles.set(symbol, []);
    const arr = this.candles.get(symbol);
    // Don't duplicate
    if (arr.some(c => c.openTime === candle.openTime)) return;
    arr.push(candle);
    // Sort by time
    arr.sort((a, b) => a.openTime - b.openTime);
    // Trim
    while (arr.length > this.maxCandles) arr.shift();
  }

  getCandles(symbol, count = 500) {
    const arr = this.candles.get(symbol) || [];
    return arr.slice(-count);
  }

  getCurrentCandle(symbol) {
    return this.current.get(symbol) || null;
  }

  getSnapshot(symbol) {
    const historical = this.getCandles(symbol, 500);
    const current = this.getCurrentCandle(symbol);
    return { historical, current };
  }
}

module.exports = CandleEngine;
