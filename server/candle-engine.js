// Candle Engine — 40s/3m/5m aggregation with Deepchart-style bubble state machine
// Bubbles: PENDING → ACCEPTED / REJECTED / ABSORBED / EXHAUSTED / INVALIDATED

class CandleEngine {
  constructor(intervalMs = 40000) {
    this.intervalMs = intervalMs;
    this.candles = new Map();   // symbol → closed candle[]
    this.current = new Map();   // symbol → live candle
    this.allBubbles = new Map();// symbol → bubble[]
    this.listeners = [];
    this.maxCandles = 2000;
    this.maxBubbles = 5000;

    // Trade buffer for interval switching
    this.tradeBuffer = new Map();
    this.maxBufferSize = 20000;

    // Bubble response evaluation timers
    this.pendingEvals = []; // { bubble, evalAt }
    this.evalInterval = setInterval(() => this._evaluatePendingBubbles(), 1000);
  }

  setInterval(ms) {
    if (ms === this.intervalMs) return;
    this.intervalMs = ms;
    this.current.clear();
    this._rebuildFromBuffer();
  }

  onCandle(listener) {
    this.listeners.push(listener);
  }

  processTrade(trade) {
    const { symbol, price, qty, side, time, source } = trade;

    // Buffer for rebuild
    if (!this.tradeBuffer.has(symbol)) this.tradeBuffer.set(symbol, []);
    const buf = this.tradeBuffer.get(symbol);
    buf.push({ price, qty, side, time, source });
    if (buf.length > this.maxBufferSize) buf.shift();

    const bucket = Math.floor(time / this.intervalMs) * this.intervalMs;
    let candle = this.current.get(symbol);

    if (!candle || candle.openTime !== bucket) {
      if (candle) this._closeCandle(symbol, candle);
      candle = this._newCandle(symbol, bucket, price, source);
      this.current.set(symbol, candle);
    }

    // Update candle OHLCV
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

    const notional = price * qty;
    candle.maxTradeSize = Math.max(candle.maxTradeSize, qty);
    if (notional > 10000) candle.largeTradeCount++;

    // Price-level footprint
    const bin = this._priceBin(price, symbol);
    let level = candle.priceMap.get(bin);
    if (!level) {
      level = { buy: 0, sell: 0, total: 0, delta: 0, maxPrint: 0, trades: 0, absorptions: 0, rejections: 0 };
      candle.priceMap.set(bin, level);
    }
    if (side === 'buy') { level.buy += qty; level.delta += qty; }
    else { level.sell += qty; level.delta -= qty; }
    level.total += qty;
    level.trades++;
    level.maxPrint = Math.max(level.maxPrint, qty);

    // Absorption detection at price level
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
      if (midPrice > 0 && range / midPrice < 0.001) {
        level.rejections++;
        candle.rejectionCount++;
      }
    }

    // Bubble detection — aggressive prints
    const bubbleThreshold = this._bubbleThreshold(symbol, price);
    if (notional > bubbleThreshold || qty > 100) {
      const bubble = {
        id: `${symbol}-${time}-${Math.random().toString(36).slice(2, 6)}`,
        symbol,
        source,
        timestamp: time,
        candleTime: bucket,
        price,
        side: side,
        volume: qty,
        notional,
        tradeCount: 1,
        aggressiveness: this._calcAggressiveness(notional, qty, side, candle),
        responseAt3s: null,
        responseAt10s: null,
        responseAt40s: null,
        state: 'PENDING',
        confidence: 0.5
      };

      candle.bubbles.push(bubble);
      candle.bubbleCount++;

      // Track globally
      if (!this.allBubbles.has(symbol)) this.allBubbles.set(symbol, []);
      const allB = this.allBubbles.get(symbol);
      allB.push(bubble);
      if (allB.length > this.maxBubbles) allB.shift();

      // Schedule response evaluations
      this.pendingEvals.push({ bubble, evalAt: time + 3000, field: 'responseAt3s', candle });
      this.pendingEvals.push({ bubble, evalAt: time + 10000, field: 'responseAt10s', candle });
      this.pendingEvals.push({ bubble, evalAt: time + this.intervalMs, field: 'responseAt40s', candle });
    }

    // Burst tracking
    this._trackBursts(candle, side, notional);
  }

  _newCandle(symbol, bucket, price, source) {
    return {
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
      acceptedBuyCount: 0,
      acceptedSellCount: 0,
      absorbedBuyCount: 0,
      absorbedSellCount: 0,
      rejectedBuyCount: 0,
      rejectedSellCount: 0,
      aggressiveBuyBursts: 0,
      aggressiveSellBursts: 0,
      priceMap: new Map(),
      bubbles: [],
      source
    };
  }

  _calcAggressiveness(notional, qty, side, candle) {
    const avgTrade = candle.volume > 0 ? candle.volume / Math.max(1, candle.tradeCount) : 1;
    const sizeRatio = qty / Math.max(1, avgTrade);
    const notionalScore = Math.log10(Math.max(1, notional)) / 6; // 0-1 scale
    const sizeScore = Math.min(1, sizeRatio / 10);
    return Math.min(1, (notionalScore * 0.6 + sizeScore * 0.4));
  }

  _bubbleThreshold(symbol, price) {
    // Dynamic threshold based on price level
    if (price > 10000) return 5000;
    if (price > 1000) return 3000;
    if (price > 100) return 2000;
    if (price > 10) return 1000;
    return 500;
  }

  _trackBursts(candle, side, notional) {
    if (notional > 20000) {
      if (side === 'buy') candle.aggressiveBuyBursts++;
      else candle.aggressiveSellBursts++;
    }
  }

  _evaluatePendingBubbles() {
    const now = Date.now();
    const toProcess = [];
    const remaining = [];

    for (const ev of this.pendingEvals) {
      if (now >= ev.evalAt) toProcess.push(ev);
      else remaining.push(ev);
    }
    this.pendingEvals = remaining;

    for (const ev of toProcess) {
      const { bubble, field, candle } = ev;
      if (!bubble || !candle) continue;

      // Calculate price response
      const currentPrice = candle.close;
      const priceChange = currentPrice - bubble.price;
      const priceChangePct = bubble.price > 0 ? priceChange / bubble.price : 0;

      // Direction: buy expects price up, sell expects price down
      const expectedDirection = bubble.side === 'buy' ? 1 : -1;
      const alignedMove = priceChangePct * expectedDirection;

      bubble[field] = {
        price: currentPrice,
        change: priceChange,
        changePct: priceChangePct,
        aligned: alignedMove > 0,
        magnitude: Math.abs(priceChangePct)
      };

      // Update bubble state based on responses
      this._classifyBubble(bubble, candle);
    }
  }

  _classifyBubble(bubble, candle) {
    if (bubble.state === 'INVALIDATED') return;

    const r3 = bubble.responseAt3s;
    const r10 = bubble.responseAt10s;
    const r40 = bubble.responseAt40s;

    // If no response yet, stay pending
    if (!r3) return;

    const range = candle.high - candle.low;
    const mid = (candle.high + candle.low) / 2;
    const rangeRatio = mid > 0 ? range / mid : 0;

    // ABSORBED: Large volume but price didn't move (tight range, high notional)
    if (r3 && !r3.aligned && r3.magnitude < 0.001 && bubble.notional > 20000) {
      bubble.state = 'ABSORBED';
      bubble.confidence = 0.8;
      if (bubble.side === 'buy') candle.absorbedBuyCount++;
      else candle.absorbedSellCount++;
      return;
    }

    // ABSORBED: Volume entered but range stayed tight
    if (rangeRatio < 0.002 && bubble.notional > 15000) {
      bubble.state = 'ABSORBED';
      bubble.confidence = 0.7;
      if (bubble.side === 'buy') candle.absorbedBuyCount++;
      else candle.absorbedSellCount++;
      return;
    }

    // REJECTED: Price moved against the aggression
    if (r3 && !r3.aligned && r3.magnitude > 0.002) {
      bubble.state = 'REJECTED';
      bubble.confidence = 0.85;
      if (bubble.side === 'buy') candle.rejectedBuyCount++;
      else candle.rejectedSellCount++;
      return;
    }

    // REJECTED by 10s if 3s was neutral
    if (r10 && !r10.aligned && r10.magnitude > 0.003) {
      bubble.state = 'REJECTED';
      bubble.confidence = 0.75;
      if (bubble.side === 'buy') candle.rejectedBuyCount++;
      else candle.rejectedSellCount++;
      return;
    }

    // ACCEPTED: Price moved in the expected direction
    if (r3 && r3.aligned && r3.magnitude > 0.001) {
      bubble.state = 'ACCEPTED';
      bubble.confidence = 0.9;
      if (bubble.side === 'buy') candle.acceptedBuyCount++;
      else candle.acceptedSellCount++;
      return;
    }

    if (r10 && r10.aligned && r10.magnitude > 0.001) {
      bubble.state = 'ACCEPTED';
      bubble.confidence = 0.8;
      if (bubble.side === 'buy') candle.acceptedBuyCount++;
      else candle.acceptedSellCount++;
      return;
    }

    // EXHAUSTED: Weak response, momentum fading
    if (r10 && r10.magnitude < 0.001) {
      bubble.state = 'EXHAUSTED';
      bubble.confidence = 0.6;
      return;
    }

    // After full interval, if still pending → exhausted
    if (r40 && bubble.state === 'PENDING') {
      if (r40.aligned && r40.magnitude > 0.001) {
        bubble.state = 'ACCEPTED';
        bubble.confidence = 0.7;
        if (bubble.side === 'buy') candle.acceptedBuyCount++;
        else candle.acceptedSellCount++;
      } else if (!r40.aligned && r40.magnitude > 0.002) {
        bubble.state = 'REJECTED';
        bubble.confidence = 0.7;
        if (bubble.side === 'buy') candle.rejectedBuyCount++;
        else candle.rejectedSellCount++;
      } else {
        bubble.state = 'EXHAUSTED';
        bubble.confidence = 0.5;
      }
    }
  }

  _closeCandle(symbol, candle) {
    // Final classification for any still-pending bubbles
    for (const bubble of candle.bubbles) {
      if (bubble.state === 'PENDING') {
        this._classifyBubble(bubble, candle);
        if (bubble.state === 'PENDING') {
          bubble.state = 'EXHAUSTED';
          bubble.confidence = 0.4;
        }
      }
    }

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

    for (const fn of this.listeners) {
      fn(closed);
    }
  }

  _rebuildFromBuffer() {
    for (const [symbol, trades] of this.tradeBuffer) {
      this.candles.set(symbol, []);
      if (this.allBubbles.has(symbol)) this.allBubbles.set(symbol, []);
      for (const t of trades) {
        this.processTrade({ symbol, ...t });
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
    if (arr.some(c => c.openTime === candle.openTime)) return;
    arr.push(candle);
    arr.sort((a, b) => a.openTime - b.openTime);
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

  getBubbles(symbol, count = 2000) {
    const arr = this.allBubbles.get(symbol) || [];
    return arr.slice(-count);
  }

  destroy() {
    if (this.evalInterval) clearInterval(this.evalInterval);
  }
}

module.exports = CandleEngine;
